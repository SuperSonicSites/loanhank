import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Extraction } from '../../src/shared/schema.js';
import type { StandaloneEnv } from '../../standalone/src/env.js';

export const FAKE_SUPABASE_URL = 'https://fake.supabase.co';

/** Fixture A from context/05 and context/12: the annual fixed-rate acceptance loan. */
export const fixtureExtraction: Extraction = {
  document_type: 'loan_statement',
  document_date: '2026-08-01',
  loan_count: 1,
  multiple_loans_detected: false,
  sensitive_identifiers_detected: [],
  warnings: [],
  loan: {
    lender_name: { value: 'Example Farm Bank', confidence: 0.99, evidence: 'lender', page: 1 },
    loan_purpose: { value: 'farm equipment', confidence: 0.9, evidence: 'purpose', page: 1 },
    principal_balance_cents: { value: 32_784_000, confidence: 0.99, evidence: 'balance', page: 1 },
    annual_interest_rate_bps: { value: 785, confidence: 0.99, evidence: 'rate', page: 1 },
    rate_type: { value: 'fixed', confidence: 0.99, evidence: 'fixed', page: 1 },
    payment_amount_cents: { value: 9_865_144, confidence: 0.99, evidence: 'payment', page: 1 },
    payment_frequency: { value: 'annual', confidence: 0.99, evidence: 'annual', page: 1 },
    next_payment_date: { value: null, confidence: 0, evidence: null, page: null },
    maturity_date: { value: '2030-03-01', confidence: 0.99, evidence: 'maturity', page: 1 },
    remaining_payments: { value: 4, confidence: 0.99, evidence: 'four', page: 1 },
    balloon_amount_cents: { value: null, confidence: 0, evidence: null, page: null },
    interest_only: { value: false, confidence: 0.99, evidence: 'amortizing', page: 1 },
    prepayment_penalty: { value: null, confidence: 0, evidence: null, page: null },
    country_code: { value: 'US', confidence: 0.99, evidence: 'US', page: 1 },
    currency_code: { value: 'USD', confidence: 0.99, evidence: 'USD', page: 1 },
    interest_rate_convention: { value: 'nominal_payment_frequency', confidence: 0.95, evidence: 'convention', page: 1 },
  },
};

/** Fixture B: a Canadian note whose document states the semiannual convention. */
export const fixtureExtractionCA: Extraction = {
  ...fixtureExtraction,
  loan: {
    ...fixtureExtraction.loan,
    lender_name: { value: 'Example Prairie Credit', confidence: 0.99, evidence: 'lender', page: 1 },
    country_code: { value: 'CA', confidence: 0.99, evidence: 'CA', page: 1 },
    currency_code: { value: 'CAD', confidence: 0.99, evidence: 'CAD', page: 1 },
    interest_rate_convention: { value: 'nominal_semiannual', confidence: 0.95, evidence: 'compounded semi-annually', page: 1 },
  },
};

/** Fixture C: a Canadian note that does not state its compounding convention. */
export const fixtureExtractionCAUnstated: Extraction = {
  ...fixtureExtractionCA,
  loan: {
    ...fixtureExtractionCA.loan,
    interest_rate_convention: { value: null, confidence: 0, evidence: null, page: null },
  },
};

/** Smallest byte sequence that satisfies the PDF magic-signature check. */
export function pdfBytes(size = 2_048): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(size));
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37], 0);
  bytes.fill(0x20, 8);
  return bytes;
}

export function testEnv(assets: StandaloneEnv['ASSETS']): StandaloneEnv {
  return {
    ASSETS: assets,
    SUPABASE_URL: FAKE_SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    DOCUMENT_BUCKET: 'loanhank-documents',
    SESSION_ENCRYPTION_KEY: 'session-encryption-key-for-tests-0123456789',
    CSRF_SECRET: 'csrf-secret-for-tests-0123456789',
    RATE_LIMIT_SALT: 'rate-limit-salt-for-tests-0123456789',
    ACCOUNT_DATA_ENCRYPTION_KEY: 'account-data-key-for-tests-0123456789',
    OPENAI_DATA_CONTROLS_VERIFIED: 'false',
    PUBLIC_SITE_ORIGIN: 'https://loanhank.test',
  };
}

const DIST = path.resolve(process.cwd(), 'standalone/dist/client');

/**
 * Serves the built client the way the Cloudflare assets binding does, so tests
 * exercise the same asset paths production will.
 */
export function distAssets(): StandaloneEnv['ASSETS'] {
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (relative.length === 0 || relative.includes('..')) return new Response(null, { status: 404 });
      try {
        const body = await readFile(path.join(DIST, relative));
        return new Response(body, { status: 200, headers: { 'content-type': contentType(relative) } });
      } catch {
        return new Response(null, { status: 404 });
      }
    },
  };
}

function contentType(file: string): string {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json') || file.endsWith('.webmanifest')) return 'application/json; charset=utf-8';
  if (file.endsWith('.woff2')) return 'font/woff2';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

export function executionContext() {
  const pending: Array<Promise<unknown>> = [];
  return {
    waitUntil(promise: Promise<unknown>) { pending.push(promise.catch(() => undefined)); },
    passThroughOnException() { /* no-op in tests */ },
    async settle() { await Promise.all(pending); },
  };
}
