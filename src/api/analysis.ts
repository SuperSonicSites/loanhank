// SHARED PRODUCTION CODE: imported directly by the standalone Worker
// (see AGENTS.md "Shared production code"). A change here ships.
import { buildLoanXRay, compareScenario, decideScenario, scenarioNarrative, type LoanXRay } from '../finance/index.js';
import type { ConfirmedLoan, Extraction, ScenarioRequest } from '../shared/schema.js';
import type { AppConfig } from './env.js';
import type { DocumentExtractor } from './extractor.js';
import type { AnalysisRecord, AnalysisRepository } from './repository.js';
import type { PrivateStorage } from './storage.js';
import {
  confidenceBucket,
  evaluateExtraction,
  needsFallback,
  PublicApiError,
  sanitizeExtraction,
  warningCopy,
} from './security.js';

export class AnalysisService {
  constructor(
    private readonly config: AppConfig,
    private readonly repository: AnalysisRepository,
    private readonly storage: PrivateStorage,
    private readonly extractor: DocumentExtractor,
  ) {}

  async start(record: AnalysisRecord): Promise<AnalysisRecord> {
    if (record.status === 'NEEDS_CONFIRMATION' || record.status === 'READY') return record;
    if (record.status !== 'UPLOADED' || !record.objectPath || !record.contentType) {
      throw new PublicApiError(409, 'INVALID_ANALYSIS_STATE', 'The document must finish uploading before extraction can start.');
    }
    const extracting = await this.repository.transition(record.id, record.accessKeyHash, ['UPLOADED'], {
      status: 'EXTRACTING',
      errorCode: null,
    });
    if (!extracting) {
      const latest = await this.repository.get(record.id, record.accessKeyHash);
      if (latest?.status === 'NEEDS_CONFIRMATION' || latest?.status === 'READY') return latest;
      throw new PublicApiError(409, 'INVALID_ANALYSIS_STATE', 'Document extraction is already in progress or unavailable.');
    }
    try {
      const readUrl = await this.storage.createReadUrl(extracting.objectPath!, Math.min(this.config.SIGNED_URL_TTL_SECONDS, 300));
      let extraction = sanitizeExtraction(await this.extractor.extract(readUrl, extracting.contentType!, extracting.countryCode ?? 'US'));
      let checks = evaluateExtraction(extraction);
      if (needsFallback(extraction, checks)) {
        extraction = sanitizeExtraction(await this.extractor.adjudicate(readUrl, extracting.contentType!, extraction, checks, extracting.countryCode ?? 'US'));
        checks = evaluateExtraction(extraction);
      }
      if (extraction.multiple_loans_detected || (extraction.loan_count ?? 0) > 1) {
        const deletion = await this.deleteRawBestEffort(extracting);
        const failed = await this.repository.transition(record.id, record.accessKeyHash, ['EXTRACTING'], {
          status: 'FAILED',
          extraction: null,
          validationChecks: [],
          documentType: extraction.document_type,
          errorCode: 'MULTIPLE_LOANS_UNSUPPORTED',
          ...deletion,
        });
        if (!failed) throw new PublicApiError(409, 'INVALID_ANALYSIS_STATE', 'The analysis state changed while extraction was running.');
        return failed;
      }
      const resolved = await this.repository.transition(record.id, record.accessKeyHash, ['EXTRACTING'], {
        status: 'NEEDS_CONFIRMATION',
        extraction,
        validationChecks: checks,
        documentType: extraction.document_type,
      });
      if (!resolved) throw new PublicApiError(409, 'INVALID_ANALYSIS_STATE', 'The analysis state changed while extraction was running.');
      return resolved;
    } catch (error) {
      if (error instanceof PublicApiError) throw error;
      const deletion = await this.deleteRawBestEffort(extracting);
      await this.repository.transition(record.id, record.accessKeyHash, ['EXTRACTING'], {
        status: 'FAILED',
        extraction: null,
        validationChecks: [],
        errorCode: 'EXTRACTION_FAILED',
        ...deletion,
      });
      throw new PublicApiError(422, 'EXTRACTION_FAILED', 'We could not reliably read this document. Try a clearer PDF, JPG, or PNG.');
    }
  }

  async confirm(record: AnalysisRecord, loan: ConfirmedLoan): Promise<AnalysisRecord> {
    if (record.status === 'READY') {
      if (record.confirmedLoan && canonicalLoan(record.confirmedLoan) === canonicalLoan(loan)) return record;
      throw new PublicApiError(409, 'CONFIRMATION_CONFLICT', 'This analysis was already completed with different confirmed terms.');
    }
    if (record.status !== 'NEEDS_CONFIRMATION') {
      throw new PublicApiError(409, 'INVALID_ANALYSIS_STATE', 'Loan terms can only be confirmed after extraction review.');
    }
    const calculating = await this.repository.transition(record.id, record.accessKeyHash, ['NEEDS_CONFIRMATION'], {
      status: 'CALCULATING',
      confirmedLoan: loan,
    });
    if (!calculating) {
      const latest = await this.repository.get(record.id, record.accessKeyHash);
      if (latest?.status === 'READY' && latest.confirmedLoan && canonicalLoan(latest.confirmedLoan) === canonicalLoan(loan)) {
        return latest;
      }
      throw new PublicApiError(409, 'CONFIRMATION_CONFLICT', 'The analysis was confirmed concurrently with different or still-processing terms.');
    }
    const asOfDate = calculating.createdAt.slice(0, 10);
    const xray = buildLoanXRay(loan, asOfDate);
    const deletion = await this.deleteRawBestEffort(calculating);
    const ready = await this.repository.transition(record.id, record.accessKeyHash, ['CALCULATING'], {
      status: 'READY',
      confirmedLoan: loan,
      xray,
      extraction: null,
      validationChecks: [],
      errorCode: null,
      ...deletion,
    });
    if (!ready) throw new PublicApiError(409, 'INVALID_ANALYSIS_STATE', 'The analysis state changed while calculations were running.');
    return ready;
  }

  scenario(record: AnalysisRecord, request: ScenarioRequest) {
    if (record.status !== 'READY' || !record.confirmedLoan || !record.xray) {
      throw new PublicApiError(409, 'INVALID_ANALYSIS_STATE', 'Confirm the loan terms before testing a scenario.');
    }
    const xray = record.xray as LoanXRay;
    const scenario = compareScenario(xray.current, record.confirmedLoan, request, xray.asOfDate);
    const decisionState = decideScenario(xray.current, record.confirmedLoan, xray.asOfDate, scenario);
    return { scenario, decisionState, narrative: scenarioNarrative(scenario, record.confirmedLoan.currencyCode ?? 'USD'), asOfDate: xray.asOfDate };
  }

  summary(record: AnalysisRecord) {
    const base = {
      id: record.id,
      status: record.status,
      expiresAt: record.expiresAt,
      documentType: record.documentType,
      rawFileDeleteAt: record.rawDeleteAt,
      errorCode: record.errorCode,
    };
    if (record.status === 'NEEDS_CONFIRMATION' && record.extraction) {
      return { ...base, extraction: confirmationPayload(record.extraction, record.validationChecks, record.countryCode ?? 'US') };
    }
    if (record.status === 'READY') {
      return { ...base, confirmedLoan: record.confirmedLoan, xray: record.xray };
    }
    return base;
  }

  private async deleteRawBestEffort(record: AnalysisRecord): Promise<Partial<AnalysisRecord>> {
    if (!record.objectPath || record.objectDeletedAt) return {};
    try {
      await this.storage.remove(record.objectPath);
      return { objectPath: null, objectDeletedAt: new Date().toISOString(), rawDeleteAt: null };
    } catch {
      return { rawDeleteAt: new Date().toISOString() };
    }
  }
}

function canonicalLoan(loan: ConfirmedLoan): string {
  const keys = Object.keys(loan).sort() as Array<keyof ConfirmedLoan>;
  return JSON.stringify(Object.fromEntries(keys.map((key) => [key, loan[key]])));
}

function confirmationPayload(extraction: Extraction, checks: unknown[], requestedCountry: 'US' | 'CA') {
  const fields = [
    { key: 'principalBalanceCents', label: 'Current balance', field: extraction.loan.principal_balance_cents },
    { key: 'annualInterestRateBps', label: 'Annual interest rate', field: extraction.loan.annual_interest_rate_bps },
    { key: 'paymentAmountCents', label: 'Scheduled payment', field: extraction.loan.payment_amount_cents },
    { key: 'paymentFrequency', label: 'Payment frequency', field: extraction.loan.payment_frequency },
    { key: 'remainingPayments', label: 'Remaining payments', field: extraction.loan.remaining_payments },
    { key: 'maturityDate', label: 'Maturity date', field: extraction.loan.maturity_date },
    { key: 'rateType', label: 'Rate type', field: extraction.loan.rate_type },
    { key: 'balloonAmountCents', label: 'Balloon amount', field: extraction.loan.balloon_amount_cents },
  ].slice(0, 8).map(({ key, label, field }) => ({
    key,
    label,
    value: field.value,
    confidence: field.confidence,
    status: field.value === null || field.confidence < 0.8 ? 'Missing' : field.confidence < 0.95 ? 'Please check' : 'Confirmed automatically',
  }));
  const deterministicWarnings = checks.map((check) => (
    typeof check === 'object' && check && 'message' in check
      ? String(check.message)
      : 'Please review the highlighted fields.'
  ));
  const extractedCountry = extraction.loan.country_code?.value;
  const extractedCurrency = extraction.loan.currency_code?.value;
  if (extractedCountry && extractedCountry !== requestedCountry) {
    deterministicWarnings.push(
      `You picked ${requestedCountry === 'CA' ? 'Canada' : 'the United States'}, but the document reads as a ${extractedCountry === 'CA' ? 'Canadian' : 'U.S.'} loan. Confirm which country applies.`,
    );
  } else if (extractedCurrency && extractedCurrency !== (requestedCountry === 'CA' ? 'CAD' : 'USD')) {
    deterministicWarnings.push(
      `The document appears to be denominated in ${extractedCurrency}, which does not match the selected country. Confirm which country applies.`,
    );
  }
  const modelWarnings = extraction.warnings.map((code) => warningCopy[code]);
  return {
    documentType: extraction.document_type,
    documentDate: extraction.document_date,
    fields,
    warnings: [...new Set([...deterministicWarnings, ...modelWarnings])],
    confidenceBucket: confidenceBucket(extraction),
    defaults: {
      principalBalanceCents: extraction.loan.principal_balance_cents.value ?? undefined,
      annualInterestRateBps: extraction.loan.annual_interest_rate_bps.value ?? undefined,
      paymentAmountCents: extraction.loan.payment_amount_cents.value ?? undefined,
      paymentFrequency: extraction.loan.payment_frequency.value ?? 'unknown',
      remainingPayments: extraction.loan.remaining_payments.value ?? undefined,
      // Not one of the eight fields the confirm screen asks the farmer to
      // review, but it is carried through as an editable default: it anchors
      // the payment calendar and the reminder schedule when it is present.
      nextPaymentDate: extraction.loan.next_payment_date.value ?? undefined,
      maturityDate: extraction.loan.maturity_date.value ?? undefined,
      rateType: extraction.loan.rate_type.value ?? 'unknown',
      balloonAmountCents: extraction.loan.balloon_amount_cents.value ?? undefined,
      interestOnly: extraction.loan.interest_only.value ?? false,
      loanType: extraction.document_type === 'line_of_credit_statement' ? 'line_of_credit' : 'term_loan',
      loanPurpose: extraction.loan.loan_purpose.value ?? undefined,
      lenderName: extraction.loan.lender_name.value ?? undefined,
      documentDate: extraction.document_date ?? undefined,
      countryCode: extraction.loan.country_code?.value ?? requestedCountry,
      currencyCode: extraction.loan.currency_code?.value ?? (requestedCountry === 'CA' ? 'CAD' : 'USD'),
      interestRateConvention: extraction.loan.interest_rate_convention?.value
        ?? (requestedCountry === 'CA' ? 'unknown' : 'nominal_payment_frequency'),
    },
  };
}
