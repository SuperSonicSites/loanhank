// Upload gates and extraction sanitising, carried from the ancestor with its
// tests. security.ts is what stands between /extract and a bill.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import type { Extraction, ExtractionWarningCode, UploadContentType } from '../shared/schema.js';
import { calculatePaymentCents, periodsPerYear, projectCurrentLoan } from '../finance/index.js';

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
/**
 * One decode reads up to four photos of the same paper, merged into one
 * extraction call. The per-image size law above is unchanged; this is the
 * ceiling on how many images one decode may carry, and breaching it is a 413.
 */
export const MAX_PHOTOS_PER_DECODE = 4;
export const allowedContentTypes = new Set<UploadContentType>(['application/pdf', 'image/jpeg', 'image/png']);

export type ValidationCheck = {
  code:
    | 'BALLOON_RECONCILIATION_FAILED'
    | 'DATE_INCONSISTENT'
    | 'INTEREST_ONLY_PAYMENT_MISMATCH'
    | 'INCONSISTENT_LOAN_TERMS'
    | 'MISSING_CRITICAL_FIELD'
    | 'PAYMENT_FREQUENCY_SANITY'
    | 'RATE_OUT_OF_RANGE'
    | 'STANDARD_PAYMENT_MISMATCH';
  field?: string;
  message: string;
};

export const warningCopy: Record<ExtractionWarningCode, string> = {
  AMBIGUOUS_PAYMENT_TERMS: 'The payment terms need a closer check.',
  BALLOON_RECONCILIATION_FAILED: 'The payment, term, and balloon do not reconcile.',
  DOCUMENT_QUALITY_LOW: 'The document image may be too unclear for a reliable read.',
  INTEREST_ONLY_PAYMENT_MISMATCH: 'The stated payment does not match the interest-only terms.',
  MULTIPLE_LOANS_DETECTED: 'This file appears to contain more than one loan.',
  PAYMENT_FREQUENCY_UNUSUAL: 'The payment timing needs confirmation.',
  SENSITIVE_IDENTIFIER_REDACTED: 'Sensitive identifiers were detected and discarded.',
  STANDARD_PAYMENT_MISMATCH: 'The stated payment does not match a standard amortization.',
};

export function createAnalysisCredentials(): { analysisId: string; accessKey: string; accessKeyHash: string } {
  const accessKey = randomBytes(32).toString('base64url');
  return { analysisId: randomUUID(), accessKey, accessKeyHash: hashAccessKey(accessKey) };
}

export function hashAccessKey(accessKey: string): string {
  return createHash('sha256').update(accessKey).digest('hex');
}

export function safeObjectPath(analysisId: string, contentType: string): string {
  const extension = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
  }[contentType];
  if (!extension) throw new Error('Unsupported content type.');
  return `analyses/${analysisId}/source.${extension}`;
}

export function assertUploadAllowed(contentType: string, sizeBytes: number): asserts contentType is UploadContentType {
  if (!allowedContentTypes.has(contentType as UploadContentType)) {
    throw new PublicApiError(415, 'UNSUPPORTED_FILE_TYPE', 'Upload a PDF, JPG, or PNG loan document.');
  }
  if (sizeBytes <= 0 || sizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new PublicApiError(413, 'FILE_TOO_LARGE', 'This file is larger than the 20 MB upload limit.');
  }
}

export function assertUploadBytes(
  contentType: string,
  body: Uint8Array,
  declaredSizeBytes: number,
): asserts contentType is UploadContentType {
  assertUploadAllowed(contentType, body.byteLength);
  if (body.byteLength !== declaredSizeBytes) {
    throw new PublicApiError(400, 'UPLOAD_SIZE_MISMATCH', 'The received file size does not match the upload session.');
  }
  const signatures: Record<UploadContentType, number[]> = {
    'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
    'image/jpeg': [0xff, 0xd8, 0xff],
    'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  };
  const expected = signatures[contentType];
  if (body.byteLength < expected.length || expected.some((value, index) => body[index] !== value)) {
    throw new PublicApiError(415, 'MIME_SIGNATURE_MISMATCH', 'The file contents do not match the declared PDF, JPG, or PNG type.');
  }
}

const textPatterns = {
  ssn: /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/gi,
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  phone: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
  routing: /\b(?:routing|aba)\s*(?:number|no\.?|#|:)?\s*\d{9}\b/gi,
  account: /\b(?:account|acct)\s*(?:number|no\.?|#|:)?\s*[A-Z0-9-]{6,}\b/gi,
  tin: /\b(?:tin|tax\s*(?:id|identifier))\s*(?:number|no\.?|#|:)?\s*\d{2,3}[- ]?\d{6,7}\b/gi,
  address: /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|highway|hwy|route|rt|boulevard|blvd)\.?\b/gi,
  longIdentifier: /\b\d{6,}\b/g,
};

function redactText(value: string | null, identifiers: Set<Extraction['sensitive_identifiers_detected'][number]>): string | null {
  if (value === null) return null;
  let result = value;
  if (textPatterns.ssn.test(result)) identifiers.add('ssn');
  textPatterns.ssn.lastIndex = 0;
  if (textPatterns.routing.test(result)) identifiers.add('routing_number');
  textPatterns.routing.lastIndex = 0;
  if (textPatterns.account.test(result)) identifiers.add('account_number');
  textPatterns.account.lastIndex = 0;
  if (textPatterns.tin.test(result)) identifiers.add('tin');
  textPatterns.tin.lastIndex = 0;
  for (const pattern of Object.values(textPatterns)) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[redacted]');
  }
  return result.trim().slice(0, 160) || null;
}

export function sanitizeExtraction(input: Extraction): Extraction {
  const extraction = structuredClone(input);
  const identifiers = new Set(extraction.sensitive_identifiers_detected);
  extraction.loan.lender_name.value = redactText(extraction.loan.lender_name.value, identifiers);
  extraction.loan.loan_purpose.value = redactText(extraction.loan.loan_purpose.value, identifiers);
  extraction.loan.prepayment_penalty.value = redactText(extraction.loan.prepayment_penalty.value, identifiers);
  for (const field of Object.values(extraction.loan)) field.evidence = null;
  extraction.sensitive_identifiers_detected = [...identifiers].sort();
  extraction.warnings = [...new Set(extraction.warnings)];
  if (identifiers.size > 0 && !extraction.warnings.includes('SENSITIVE_IDENTIFIER_REDACTED')) {
    extraction.warnings.push('SENSITIVE_IDENTIFIER_REDACTED');
  }
  return extraction;
}

export function evaluateExtraction(extraction: Extraction): ValidationCheck[] {
  const { loan } = extraction;
  const checks: ValidationCheck[] = [];
  const critical = [
    ['principal balance', loan.principal_balance_cents],
    ['interest rate', loan.annual_interest_rate_bps],
    ['payment frequency', loan.payment_frequency],
  ] as const;
  for (const [label, field] of critical) {
    if (field.value === null || field.confidence < 0.8) {
      checks.push({ code: 'MISSING_CRITICAL_FIELD', field: label, message: `${label} requires confirmation.` });
    }
  }
  const hasPayment = loan.payment_amount_cents.value !== null;
  const hasTerm = loan.remaining_payments.value !== null || loan.maturity_date.value !== null;
  if ((!hasPayment && !hasTerm) || (hasPayment && loan.payment_amount_cents.confidence < 0.8)) {
    checks.push({ code: 'MISSING_CRITICAL_FIELD', field: 'payment or term', message: 'A payment amount or enough remaining-term detail is required.' });
  }
  if (loan.principal_balance_cents.value !== null && loan.principal_balance_cents.value <= 0) {
    checks.push({ code: 'INCONSISTENT_LOAN_TERMS', field: 'principal balance', message: 'Principal balance must be greater than zero.' });
  }
  if (loan.annual_interest_rate_bps.value !== null && loan.annual_interest_rate_bps.value > 3_000) {
    checks.push({ code: 'RATE_OUT_OF_RANGE', field: 'interest rate', message: 'The stated rate is outside the default 0–30% review range.' });
  }

  const datePairs: Array<[string, string | null, string, string | null]> = [
    ['document date', extraction.document_date, 'next payment date', loan.next_payment_date.value],
    ['document date', extraction.document_date, 'maturity date', loan.maturity_date.value],
    ['next payment date', loan.next_payment_date.value, 'maturity date', loan.maturity_date.value],
  ];
  for (const [earlierLabel, earlier, laterLabel, later] of datePairs) {
    if (earlier && later && later < earlier) {
      checks.push({ code: 'DATE_INCONSISTENT', field: laterLabel, message: `${laterLabel} is earlier than ${earlierLabel}.` });
    }
  }

  const frequency = loan.payment_frequency.value;
  if (
    extraction.document_date
    && loan.maturity_date.value
    && loan.remaining_payments.value
    && frequency
    && frequency in periodsPerYear
  ) {
    const elapsedDays = (Date.parse(`${loan.maturity_date.value}T00:00:00Z`) - Date.parse(`${extraction.document_date}T00:00:00Z`)) / 86_400_000;
    const expectedPeriods = Math.max(0, elapsedDays / 365.2425 * periodsPerYear[frequency as keyof typeof periodsPerYear]);
    const tolerance = Math.max(2, expectedPeriods * 0.15);
    if (Math.abs(expectedPeriods - loan.remaining_payments.value) > tolerance) {
      checks.push({ code: 'PAYMENT_FREQUENCY_SANITY', field: 'remaining payments', message: 'The payment count, frequency, and maturity date do not align.' });
    }
  }

  if (
    loan.principal_balance_cents.value
    && loan.annual_interest_rate_bps.value !== null
    && loan.payment_amount_cents.value
    && frequency
    && frequency in periodsPerYear
  ) {
    const k = periodsPerYear[frequency as keyof typeof periodsPerYear];
    if (loan.interest_only.value) {
      const expected = new Decimal(loan.principal_balance_cents.value)
        .mul(loan.annual_interest_rate_bps.value)
        .div(10_000)
        .div(k)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .toNumber();
      if (Math.abs(expected - loan.payment_amount_cents.value) > Math.max(500, expected * 0.02)) {
        checks.push({ code: 'INTEREST_ONLY_PAYMENT_MISMATCH', field: 'payment amount', message: 'The payment does not match the stated interest-only terms.' });
      }
    } else if (loan.balloon_amount_cents.value === null && loan.remaining_payments.value) {
      const expected = calculatePaymentCents(
        loan.principal_balance_cents.value,
        loan.annual_interest_rate_bps.value,
        frequency as keyof typeof periodsPerYear,
        loan.remaining_payments.value,
      );
      if (Math.abs(expected - loan.payment_amount_cents.value) > Math.max(500, expected * 0.03)) {
        checks.push({ code: 'STANDARD_PAYMENT_MISMATCH', field: 'payment amount', message: 'The payment does not match a standard amortization.' });
      }
    } else if (loan.balloon_amount_cents.value && loan.remaining_payments.value) {
      const projection = projectCurrentLoan({
        principalBalanceCents: loan.principal_balance_cents.value,
        annualInterestRateBps: loan.annual_interest_rate_bps.value,
        rateType: loan.rate_type.value ?? 'unknown',
        paymentAmountCents: loan.payment_amount_cents.value,
        paymentFrequency: frequency,
        remainingPayments: loan.remaining_payments.value,
        balloonAmountCents: loan.balloon_amount_cents.value,
        interestOnly: false,
        loanType: 'term_loan',
      }, extraction.document_date ?? '1970-01-01');
      if (projection.mode === 'LIMITED') {
        checks.push({ code: 'BALLOON_RECONCILIATION_FAILED', field: 'balloon amount', message: projection.limitedReason ?? 'The balloon terms do not reconcile.' });
      }
    }
  }
  return checks;
}

export function needsFallback(extraction: Extraction, checks: ValidationCheck[]): boolean {
  return checks.length > 0
    || extraction.loan.principal_balance_cents.confidence < 0.95
    || extraction.loan.annual_interest_rate_bps.confidence < 0.95;
}

export function confidenceBucket(extraction: Extraction): 'high' | 'needs_check' | 'missing' {
  const critical = [
    extraction.loan.principal_balance_cents,
    extraction.loan.annual_interest_rate_bps,
    extraction.loan.payment_frequency,
  ];
  if (critical.some((field) => field.value === null || field.confidence < 0.8)) return 'missing';
  if (critical.some((field) => field.confidence < 0.95)) return 'needs_check';
  return 'high';
}

export class PublicApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PublicApiError';
  }
}
