import { describe, expect, it } from 'vitest';
import type { Extraction } from '../src/shared/schema.js';
import { evaluateExtraction, needsFallback, sanitizeExtraction } from '../src/api/security.js';

function fixture(): Extraction {
  return {
    document_type: 'loan_statement',
    document_date: '2026-08-01',
    loan_count: 1,
    multiple_loans_detected: false,
    sensitive_identifiers_detected: [],
    warnings: [],
    loan: {
      lender_name: { value: null, confidence: 0, evidence: null, page: null },
      loan_purpose: { value: null, confidence: 0, evidence: null, page: null },
      principal_balance_cents: { value: 32_784_000, confidence: 0.99, evidence: '$327,840.00', page: 1 },
      annual_interest_rate_bps: { value: 785, confidence: 0.99, evidence: '7.85%', page: 1 },
      rate_type: { value: 'fixed', confidence: 0.99, evidence: 'fixed', page: 1 },
      payment_amount_cents: { value: 9_865_144, confidence: 0.99, evidence: '$98,651.44', page: 1 },
      payment_frequency: { value: 'annual', confidence: 0.99, evidence: 'annual', page: 1 },
      next_payment_date: { value: null, confidence: 0, evidence: null, page: null },
      maturity_date: { value: '2030-03-01', confidence: 0.99, evidence: 'Maturity', page: 1 },
      remaining_payments: { value: 4, confidence: 0.99, evidence: '4 payments', page: 1 },
      balloon_amount_cents: { value: null, confidence: 0, evidence: null, page: null },
      interest_only: { value: false, confidence: 0.99, evidence: 'amortizing', page: 1 },
      prepayment_penalty: { value: null, confidence: 0, evidence: null, page: null },
      country_code: { value: 'US', confidence: .99, evidence: 'United States', page: 1 },
      currency_code: { value: 'USD', confidence: .99, evidence: 'USD', page: 1 },
      interest_rate_convention: { value: 'nominal_payment_frequency', confidence: .99, evidence: 'annual rate', page: 1 },
    },
  };
}

describe('extraction privacy and consistency gates', () => {
  it('removes every evidence string and redacts retained optional text', () => {
    const extraction = fixture();
    extraction.loan.lender_name.value = 'Jane Doe, jane@example.com, 123 Main Street, account 123456789';
    extraction.loan.loan_purpose.value = 'Call 515-555-1212 about SSN 123-45-6789';
    extraction.loan.prepayment_penalty.value = 'Routing 021000021';
    const sanitized = sanitizeExtraction(extraction);
    expect(JSON.stringify(sanitized)).not.toMatch(/jane@example\.com|123 Main Street|123456789|515-555-1212|123-45-6789|021000021|\$327,840/);
    expect(Object.values(sanitized.loan).every((field) => field.evidence === null)).toBe(true);
    expect(sanitized.sensitive_identifiers_detected).toEqual(expect.arrayContaining(['account_number', 'routing_number', 'ssn']));
    expect(sanitized.warnings).toContain('SENSITIVE_IDENTIFIER_REDACTED');
  });

  it('requires confirmation for an out-of-range rate', () => {
    const extraction = fixture();
    extraction.loan.annual_interest_rate_bps.value = 7_850;
    const checks = evaluateExtraction(extraction);
    expect(checks.some((check) => check.code === 'RATE_OUT_OF_RANGE')).toBe(true);
    expect(needsFallback(extraction, checks)).toBe(true);
  });

  it('checks document, next-payment, and maturity dates', () => {
    const extraction = fixture();
    extraction.loan.next_payment_date.value = '2026-07-01';
    extraction.loan.maturity_date.value = '2026-06-01';
    const checks = evaluateExtraction(extraction);
    expect(checks.filter((check) => check.code === 'DATE_INCONSISTENT')).toHaveLength(3);
  });

  it('flags frequency and remaining-period sanity mismatches', () => {
    const extraction = fixture();
    extraction.loan.remaining_payments.value = 100;
    expect(evaluateExtraction(extraction).some((check) => check.code === 'PAYMENT_FREQUENCY_SANITY')).toBe(true);
  });

  it('flags a payment that conflicts with standard amortization', () => {
    const extraction = fixture();
    extraction.loan.payment_amount_cents.value = 100_000;
    expect(evaluateExtraction(extraction).some((check) => check.code === 'STANDARD_PAYMENT_MISMATCH')).toBe(true);
  });

  it('checks interest-only payment consistency', () => {
    const extraction = fixture();
    extraction.loan.interest_only.value = true;
    extraction.loan.payment_amount_cents.value = 100_000;
    expect(evaluateExtraction(extraction).some((check) => check.code === 'INTEREST_ONLY_PAYMENT_MISMATCH')).toBe(true);
  });

  it('checks explicit balloon reconciliation', () => {
    const extraction = fixture();
    extraction.loan.principal_balance_cents.value = 10_000_000;
    extraction.loan.annual_interest_rate_bps.value = 1_000;
    extraction.loan.payment_amount_cents.value = 3_000_000;
    extraction.loan.remaining_payments.value = 3;
    extraction.loan.balloon_amount_cents.value = 1_000_000;
    expect(evaluateExtraction(extraction).some((check) => check.code === 'BALLOON_RECONCILIATION_FAILED')).toBe(true);
  });

  it('requires a fallback for an unknown payment frequency', () => {
    const extraction = fixture();
    extraction.loan.payment_frequency = { value: 'unknown', confidence: 0.5, evidence: null, page: null };
    const checks = evaluateExtraction(extraction);
    expect(checks.some((check) => check.field === 'payment frequency')).toBe(true);
    expect(needsFallback(extraction, checks)).toBe(true);
  });

  it('does not retry solely because an identifier category was detected', () => {
    const extraction = fixture();
    extraction.sensitive_identifiers_detected = ['account_number'];
    expect(needsFallback(extraction, evaluateExtraction(extraction))).toBe(false);
  });
});
