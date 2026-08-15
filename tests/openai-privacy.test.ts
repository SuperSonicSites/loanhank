import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/api/env.js';
import { OpenAIExtractor } from '../src/api/extractor.js';
import type { Extraction } from '../src/shared/schema.js';

const config: AppConfig = {
  OPENAI_API_KEY: 'test', OPENAI_DATA_CONTROLS_VERIFIED: true, EXTRACTION_TIMEOUT_MS: 75_000,
  PRIMARY_EXTRACTION_MODEL: 'test-primary', FALLBACK_EXTRACTION_MODEL: 'test-fallback',
  DATABASE_URL: 'https://db.test', SUPABASE_URL: 'https://storage.test', SUPABASE_SECRET_KEY: 'test',
  OBJECT_STORAGE_BUCKET: 'loan-documents', SIGNED_URL_TTL_SECONDS: 600, UPLOAD_SESSION_TTL_SECONDS: 600,
  RAW_FILE_TTL_SECONDS: 3_600, ANONYMOUS_ANALYSIS_TTL_SECONDS: 86_400, LENDER_INTEREST_ENABLED: false,
  API_PORT: 8787, ALLOWED_ORIGIN: 'http://localhost:5173', TRUST_PROXY_HOPS: 0,
  RATE_LIMIT_SALT: 'test-rate-limit-salt-1234',
};

function extraction(): Extraction {
  const field = <T>(value: T | null) => ({ value, confidence: value === null ? 0 : .99, evidence: value === null ? null : 'SSN 123-45-6789 account 123456789', page: value === null ? null : 1 });
  return {
    document_type: 'loan_statement', document_date: '2026-08-01', loan_count: 1, multiple_loans_detected: false,
    sensitive_identifiers_detected: [], warnings: [],
    loan: {
      lender_name: field('person@example.com'), loan_purpose: field('123 Main Street'),
      principal_balance_cents: field(10_000_000), annual_interest_rate_bps: field(600),
      rate_type: field<'fixed'>('fixed'), payment_amount_cents: field(1_200_000),
      payment_frequency: field<'annual'>('annual'), next_payment_date: field<string>(null),
      maturity_date: field('2036-08-01'), remaining_payments: field(10), balloon_amount_cents: field<number>(null),
      interest_only: field(false), prepayment_penalty: field<string>(null),
      country_code: field<'US'>('US'), currency_code: field<'USD'>('USD'),
      interest_rate_convention: field<'nominal_payment_frequency'>('nominal_payment_frequency'),
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI extraction privacy boundary', () => {
  it('sets store:false and returns only normalized structured output', async () => {
    const calls: unknown[] = [];
    const client = {
      responses: {
        parse: vi.fn(async (body: unknown) => {
          calls.push(body);
          return { output_parsed: extraction() };
        }),
      },
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('%PDF-1.4 synthetic'), { status: 200 })));
    const result = await new OpenAIExtractor(config, client as never).extract('https://storage.test/file', 'application/pdf');
    expect(calls[0]).toMatchObject({ model: 'test-primary', store: false });
    expect(JSON.stringify(result)).not.toMatch(/123-45-6789|123456789|person@example\.com|123 Main Street/);
    expect(Object.values(result.loan).every((field) => field.evidence === null)).toBe(true);
  });

  it('passes only sanitized first-pass data to fallback adjudication', async () => {
    let requestBody: unknown;
    const client = { responses: { parse: vi.fn(async (body: unknown) => { requestBody = body; return { output_parsed: extraction() }; }) } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('%PDF-1.4 synthetic'), { status: 200 })));
    await new OpenAIExtractor(config, client as never).adjudicate(
      'https://storage.test/file',
      'application/pdf',
      extraction(),
      [{ code: 'MISSING_CRITICAL_FIELD', field: 'interest rate', message: 'Do not include this free-form message.' }],
    );
    const serialized = JSON.stringify(requestBody);
    expect(serialized).toContain('MISSING_CRITICAL_FIELD:interest rate');
    expect(serialized).not.toMatch(/123-45-6789|123456789|person@example\.com|123 Main Street|Do not include this free-form message/);
    expect(requestBody).toMatchObject({ model: 'test-fallback', store: false });
  });
});
