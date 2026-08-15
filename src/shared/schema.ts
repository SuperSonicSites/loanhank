// SHARED PRODUCTION CODE: imported directly by the standalone Worker
// (see AGENTS.md "Shared production code"). A change here ships.
import { z } from 'zod';

export const analysisStatuses = [
  'CREATED',
  'UPLOADING',
  'UPLOADED',
  'EXTRACTING',
  'NEEDS_CONFIRMATION',
  'CALCULATING',
  'READY',
  'FAILED',
  'DELETED',
] as const;
export const analysisStatusSchema = z.enum(analysisStatuses);

export const documentTypes = [
  'loan_statement',
  'amortization_schedule',
  'payoff_quote',
  'promissory_note',
  'line_of_credit_statement',
  'unknown',
] as const;
export const documentTypeSchema = z.enum(documentTypes);

export const rateTypes = ['fixed', 'variable', 'unknown'] as const;
export const rateTypeSchema = z.enum(rateTypes);
export const countryCodes = ['US', 'CA'] as const;
export const countryCodeSchema = z.enum(countryCodes);
export type CountryCode = z.infer<typeof countryCodeSchema>;
export const currencyCodes = ['USD', 'CAD'] as const;
export const currencyCodeSchema = z.enum(currencyCodes);
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;
export const interestRateConventions = [
  'nominal_payment_frequency',
  'nominal_semiannual',
  'effective_annual',
  'unknown',
] as const;
export const interestRateConventionSchema = z.enum(interestRateConventions);
export type InterestRateConvention = z.infer<typeof interestRateConventionSchema>;
export const paymentFrequencies = [
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
  'irregular',
  'unknown',
] as const;
export const paymentFrequencySchema = z.enum(paymentFrequencies);
export const regularPaymentFrequencySchema = z.enum([
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
]);

export const provenanceSchema = z.enum([
  'KNOWN',
  'ESTIMATED',
  'SCENARIO',
  'EXTERNAL_REFERENCE',
]);
export type Provenance = z.infer<typeof provenanceSchema>;

export const decisionStateSchema = z.enum([
  'MATURITY_OR_BALLOON_SOON',
  'SAME_TERM_RATE_SAVINGS_POSSIBLE',
  'CASH_FLOW_RELIEF_WITH_HIGHER_LIFETIME_COST',
  'CASH_FLOW_AND_TOTAL_COST_IMPROVEMENT',
  'NO_SCENARIO_TESTED_YET',
  'CURRENT_LOAN_REASONABLE',
  'VARIABLE_RATE_EXPOSURE',
  'LIMITED_ANALYSIS_MISSING_INPUT',
  'REVOLVING_LINE_LIMITED_ANALYSIS',
]);
export type DecisionState = z.infer<typeof decisionStateSchema>;

export const fieldSchema = <T extends z.ZodType>(value: T) =>
  z.object({
    value: value.nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().max(240).nullable(),
    page: z.number().int().positive().nullable(),
  });

export const extractionWarningCodes = [
  'AMBIGUOUS_PAYMENT_TERMS',
  'BALLOON_RECONCILIATION_FAILED',
  'DOCUMENT_QUALITY_LOW',
  'INTEREST_ONLY_PAYMENT_MISMATCH',
  'MULTIPLE_LOANS_DETECTED',
  'PAYMENT_FREQUENCY_UNUSUAL',
  'SENSITIVE_IDENTIFIER_REDACTED',
  'STANDARD_PAYMENT_MISMATCH',
] as const;
export const extractionWarningCodeSchema = z.enum(extractionWarningCodes);
export type ExtractionWarningCode = z.infer<typeof extractionWarningCodeSchema>;

export const extractionSchema = z.object({
  document_type: documentTypeSchema,
  document_date: z.string().date().nullable(),
  loan_count: z.number().int().min(0).max(100).nullable(),
  multiple_loans_detected: z.boolean(),
  loan: z.object({
    lender_name: fieldSchema(z.string().max(120)),
    loan_purpose: fieldSchema(z.string().max(120)),
    principal_balance_cents: fieldSchema(z.number().int().positive().max(9_000_000_000_000_000)),
    annual_interest_rate_bps: fieldSchema(z.number().int().min(0).max(10_000)),
    rate_type: fieldSchema(rateTypeSchema),
    payment_amount_cents: fieldSchema(z.number().int().positive().max(9_000_000_000_000_000)),
    payment_frequency: fieldSchema(paymentFrequencySchema),
    next_payment_date: fieldSchema(z.string().date()),
    maturity_date: fieldSchema(z.string().date()),
    remaining_payments: fieldSchema(z.number().int().positive().max(1_200)),
    balloon_amount_cents: fieldSchema(z.number().int().positive().max(9_000_000_000_000_000)),
    interest_only: fieldSchema(z.boolean()),
    prepayment_penalty: fieldSchema(z.string().max(160)),
    country_code: fieldSchema(countryCodeSchema),
    currency_code: fieldSchema(currencyCodeSchema),
    interest_rate_convention: fieldSchema(interestRateConventionSchema),
  }),
  sensitive_identifiers_detected: z.array(z.enum(['account_number', 'ssn', 'tin', 'routing_number'])),
  warnings: z.array(extractionWarningCodeSchema).max(20),
});
export type Extraction = z.infer<typeof extractionSchema>;

export const confirmedLoanSchema = z.object({
  countryCode: countryCodeSchema.default('US'),
  currencyCode: currencyCodeSchema.default('USD'),
  interestRateConvention: interestRateConventionSchema.default('nominal_payment_frequency'),
  principalBalanceCents: z.number().int().positive().max(9_000_000_000_000_000),
  annualInterestRateBps: z.number().int().min(0).max(10_000),
  rateType: rateTypeSchema,
  paymentAmountCents: z.number().int().positive().max(9_000_000_000_000_000).optional(),
  paymentFrequency: paymentFrequencySchema,
  documentDate: z.string().date().optional(),
  nextPaymentDate: z.string().date().optional(),
  maturityDate: z.string().date().optional(),
  remainingPayments: z.number().int().positive().max(1_200).optional(),
  balloonAmountCents: z.number().int().positive().max(9_000_000_000_000_000).optional(),
  interestOnly: z.boolean().default(false),
  loanType: z.enum(['term_loan', 'line_of_credit']).default('term_loan'),
  loanPurpose: z.string().max(120).optional(),
  lenderName: z.string().max(120).optional(),
  /** How the confirmed terms entered the system. The zod default keeps every
   * previously stored payload valid. */
  termsSource: z.enum(['document', 'manual']).default('document'),
}).superRefine((loan, context) => {
  // No conversion or cross-currency comparison is ever performed, so a
  // US/CAD or CA/USD pairing is always a data error, never a feature.
  const expected = loan.countryCode === 'CA' ? 'CAD' : 'USD';
  if (loan.currencyCode !== expected) {
    context.addIssue({
      code: 'custom',
      path: ['currencyCode'],
      message: `A ${loan.countryCode} loan must be denominated in ${expected}.`,
    });
  }
  // A next payment falling after the note matures is a transcription error,
  // never a schedule: the payment calendar would have to back-count through
  // maturity to place it. ISO `YYYY-MM-DD` strings compare chronologically.
  if (loan.nextPaymentDate && loan.maturityDate && loan.nextPaymentDate > loan.maturityDate) {
    context.addIssue({
      code: 'custom',
      path: ['nextPaymentDate'],
      message: 'The next payment date is after the maturity date.',
    });
  }
});
export type ConfirmedLoan = z.input<typeof confirmedLoanSchema>;

export const scenarioRequestSchema = z.object({
  candidateAnnualRateBps: z.number().int().min(0).max(10_000),
  termYears: z.number().positive().max(100).optional(),
  remainingPeriods: z.number().int().positive().max(1_200).optional(),
  paymentFrequency: regularPaymentFrequencySchema,
  feesCents: z.number().int().min(0).max(100_000_000_000).default(0),
  feeTreatment: z.enum(['cash', 'financed']).default('cash'),
}).refine((value) => value.termYears !== undefined || value.remainingPeriods !== undefined, {
  message: 'Provide either termYears or remainingPeriods.',
});
export type ScenarioRequest = z.infer<typeof scenarioRequestSchema>;

export const uploadSessionRequestSchema = z.object({
  contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
  countryCode: countryCodeSchema.default('US'),
  /** Cloudflare Turnstile response token; required when the deployment has
   * upload protection enabled. */
  turnstileToken: z.string().min(1).max(4_096).optional(),
});
export type UploadSessionRequest = z.infer<typeof uploadSessionRequestSchema>;
export type UploadContentType = UploadSessionRequest['contentType'];

/** Manual entry: an analysis record created with no document and no extraction. */
export const manualAnalysisRequestSchema = z.object({
  countryCode: countryCodeSchema.default('US'),
});
export type ManualAnalysisRequest = z.infer<typeof manualAnalysisRequestSchema>;

export const asOfDateSchema = z.string().date();

export const analyticsEventSchema = z.object({
  event: z.enum([
    'landing_view',
    'analysis_start',
    'manual_entry_started',
    'upload_started',
    'upload_completed',
    'extraction_completed',
    'confirmation_viewed',
    'confirmation_completed',
    'analysis_ready',
    'result_viewed',
    'show_math_opened',
    'scenario_started',
    'scenario_completed',
    'lender_interest_opened',
    'lender_interest_submitted',
    'analysis_deleted',
    'analysis_error',
  ]),
  sessionId: z.string().uuid(),
  properties: z.object({
    documentType: documentTypeSchema.optional(),
    confidenceBucket: z.enum(['high', 'needs_check', 'missing']).optional(),
    elapsedBucket: z.enum(['under_10s', 'under_30s', 'under_2m', 'over_2m']).optional(),
    deviceClass: z.enum(['mobile', 'desktop', 'tablet']).optional(),
    decisionState: decisionStateSchema.optional(),
    scenarioCount: z.number().int().min(0).max(100).optional(),
    errorCode: z.enum([
      'UNSUPPORTED_FILE_TYPE', 'FILE_TOO_LARGE', 'UPLOAD_EXPIRED', 'DOCUMENT_UNREADABLE',
      'MULTIPLE_LOANS_UNSUPPORTED', 'MISSING_CRITICAL_FIELD', 'INCONSISTENT_LOAN_TERMS',
      'LIMITED_ANALYSIS_ONLY', 'PUBLIC_DATA_UNAVAILABLE', 'EXTRACTION_FAILED', 'ANALYSIS_EXPIRED',
    ]).optional(),
  }).default({}),
});

export const publicRateRecordSchema = z.object({
  source: z.string().url(),
  series: z.string().min(1),
  valueBps: z.number().int().min(0).nullable(),
  asOf: z.string().date(),
  retrievedAt: z.string().datetime(),
  status: z.enum(['fresh', 'cached', 'stale', 'unavailable']),
  sourceUrl: z.string().url(),
  label: z.string(),
});
export type PublicRateRecord = z.infer<typeof publicRateRecordSchema>;

export const accountProfileSchema = z.object({
  accountId: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1).max(160),
  defaultCountryCode: countryCodeSchema,
  timezone: z.string().min(1).max(80),
  emailAlertsEnabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AccountProfile = z.infer<typeof accountProfileSchema>;

export const savedScenarioSchema = z.object({
  id: z.string().uuid(),
  loanId: z.string().uuid(),
  name: z.string().min(1).max(80),
  input: scenarioRequestSchema,
  result: z.unknown(),
  createdAt: z.string().datetime(),
});
export type SavedScenario = z.infer<typeof savedScenarioSchema>;
export const createSavedScenarioSchema = z.object({
  name: z.string().trim().min(1).max(80),
  input: scenarioRequestSchema,
});

export const savedLoanSchema = z.object({
  id: z.string().uuid(),
  nickname: z.string().min(1).max(80),
  countryCode: countryCodeSchema,
  currencyCode: currencyCodeSchema,
  confirmedLoan: confirmedLoanSchema,
  xray: z.unknown(),
  latestScenario: savedScenarioSchema.optional(),
  activeWatchCount: z.number().int().min(0),
  savedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SavedLoan = z.infer<typeof savedLoanSchema>;

export const alertKinds = ['maturity', 'annual_recheck', 'public_rate_threshold', 'payment_due'] as const;
export const alertKindSchema = z.enum(alertKinds);

export const alertRuleSchema = z.object({
  id: z.string().uuid(),
  loanId: z.string().uuid(),
  kind: alertKindSchema,
  benchmarkSeries: z.enum(['SOFR', 'TREASURY_5Y', 'CORRA', 'CANADA_5Y']).optional(),
  thresholdBps: z.number().int().min(0).max(10_000).optional(),
  direction: z.enum(['at_or_below', 'at_or_above']).optional(),
  leadDays: z.number().int().min(1).max(60).optional(),
  emailEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  active: z.boolean(),
  nextDueAt: z.string().datetime().nullable(),
  lastNotifiedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AlertRule = z.infer<typeof alertRuleSchema>;

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const accountNotificationSchema = z.object({
  id: z.string().uuid(),
  loanId: z.string().uuid().nullable(),
  kind: alertKindSchema,
  title: z.string().max(120),
  body: z.string().max(240),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type AccountNotification = z.infer<typeof accountNotificationSchema>;

export const updateProfileSchema = z.object({
  defaultCountryCode: countryCodeSchema.optional(),
  timezone: z.string().min(1).max(80).optional(),
  emailAlertsEnabled: z.boolean().optional(),
});

export const saveLoanSchema = z.object({ nickname: z.string().trim().min(1).max(80) });
export const createAlertRuleSchema = z.object({
  kind: alertKindSchema,
  benchmarkSeries: z.enum(['SOFR', 'TREASURY_5Y', 'CORRA', 'CANADA_5Y']).optional(),
  thresholdBps: z.number().int().min(0).max(10_000).optional(),
  direction: z.enum(['at_or_below', 'at_or_above']).optional(),
  leadDays: z.number().int().min(1).max(60).optional(),
  emailEnabled: z.boolean().default(false),
  pushEnabled: z.boolean().default(false),
}).superRefine((value, context) => {
  if (value.kind === 'public_rate_threshold' && (!value.benchmarkSeries || value.thresholdBps === undefined || !value.direction)) {
    context.addIssue({ code: 'custom', message: 'Benchmark, threshold, and direction are required for a rate watch.' });
  }
  // A lead time only means something against a payment schedule. Accepting it
  // on another kind would store a number nothing reads, which later looks like
  // a setting the user chose and the product ignored.
  if (value.leadDays !== undefined && value.kind !== 'payment_due') {
    context.addIssue({ code: 'custom', path: ['leadDays'], message: 'A lead time applies to a payment reminder only.' });
  }
});
