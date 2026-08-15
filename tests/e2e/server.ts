import { createApp, type AppDependencies } from '../../src/api/server.js';
import { StaticExtractor } from '../../src/api/extractor.js';
import { InMemoryRepository } from '../../src/api/repository.js';
import { InMemoryPrivateStorage } from '../../src/api/storage.js';
import { PublicRateService } from '../../src/api/public-rates.js';
import type { AppConfig } from '../../src/api/env.js';
import type { Extraction } from '../../src/shared/schema.js';

const config: AppConfig = {
  OPENAI_API_KEY: 'synthetic', OPENAI_DATA_CONTROLS_VERIFIED: true, EXTRACTION_TIMEOUT_MS: 75_000,
  PRIMARY_EXTRACTION_MODEL: 'synthetic', FALLBACK_EXTRACTION_MODEL: 'synthetic', DATABASE_URL: 'https://db.test',
  SUPABASE_URL: 'https://storage.test', SUPABASE_SECRET_KEY: 'synthetic', OBJECT_STORAGE_BUCKET: 'loan-documents',
  SIGNED_URL_TTL_SECONDS: 600, UPLOAD_SESSION_TTL_SECONDS: 600, RAW_FILE_TTL_SECONDS: 3_600,
  ANONYMOUS_ANALYSIS_TTL_SECONDS: 86_400, LENDER_INTEREST_ENABLED: false, API_PORT: 8787,
  ALLOWED_ORIGIN: 'http://127.0.0.1:5173', TRUST_PROXY_HOPS: 0, RATE_LIMIT_SALT: 'e2e-rate-limit-salt-12345',
};
const field = <T>(value: T | null, confidence = value === null ? 0 : .99) => ({ value, confidence, evidence: value === null ? null : 'synthetic evidence', page: value === null ? null : 1 });
const extraction: Extraction = {
  document_type: 'loan_statement', document_date: '2026-08-01', loan_count: 1, multiple_loans_detected: false,
  sensitive_identifiers_detected: [], warnings: ['AMBIGUOUS_PAYMENT_TERMS'],
  loan: {
    lender_name: field('Synthetic Farm Bank'), loan_purpose: field('operating loan'),
    principal_balance_cents: field(32_784_000), annual_interest_rate_bps: field(785, .9),
    rate_type: field<'fixed'>('fixed'), payment_amount_cents: field(9_865_144),
    payment_frequency: field<'annual'>('annual', .9), next_payment_date: field<string>(null),
    maturity_date: field('2030-03-01'), remaining_payments: field(4), balloon_amount_cents: field<number>(null),
    interest_only: field(false), prepayment_penalty: field<string>(null),
    country_code: field<'US'>('US'), currency_code: field<'USD'>('USD'),
    interest_rate_convention: field<'nominal_payment_frequency'>('nominal_payment_frequency'),
  },
};
const repository = new InMemoryRepository();
const dependencies: AppDependencies = {
  config,
  repository,
  storage: new InMemoryPrivateStorage(),
  extractor: new StaticExtractor(extraction),
  rates: new PublicRateService(repository, { fetch: async () => { throw new Error('synthetic offline'); } }),
};
createApp(dependencies).listen(config.API_PORT, '127.0.0.1', () => console.info(`Synthetic E2E API listening on ${config.API_PORT}`));
