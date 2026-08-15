import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StaticExtractor } from '../../src/api/extractor.js';
import { projectCurrentLoan } from '../../src/finance/index.js';
import type { ConfirmedLoan } from '../../src/shared/schema.js';
import { createSession, csrfTokenFor, resolveSession } from '../../standalone/src/session.js';
import { createWorker } from '../../standalone/src/worker.js';
import type { StandaloneEnv } from '../../standalone/src/env.js';
import { createFakeSupabase } from './supabase-fake.js';
import {
  distAssets,
  executionContext,
  fixtureExtractionCA,
  fixtureExtractionCAUnstated,
  pdfBytes,
  testEnv,
} from './fixtures.js';

const ORIGIN = 'https://loanhank.test';
const USER_ID = '11111111-1111-4111-8111-111111111111';

let supabase: ReturnType<typeof createFakeSupabase>;
let restore: () => void;
let env: StandaloneEnv;

beforeEach(() => {
  supabase = createFakeSupabase();
  restore = supabase.install();
  env = testEnv(distAssets());
});

afterEach(() => restore());

function mutation(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', ...(init.headers as Record<string, string> | undefined) },
  };
}

function workerCall(worker: ReturnType<typeof createWorker>) {
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    const context = executionContext();
    const response = await worker.fetch(new Request(`${ORIGIN}${path}`, init), env, context);
    await context.settle();
    return response;
  };
}

const CA_LOAN: ConfirmedLoan = {
  countryCode: 'CA',
  currencyCode: 'CAD',
  interestRateConvention: 'nominal_semiannual',
  principalBalanceCents: 32_784_000,
  annualInterestRateBps: 785,
  rateType: 'fixed',
  paymentFrequency: 'annual',
  remainingPayments: 4,
  maturityDate: '2030-03-01',
  interestOnly: false,
  loanType: 'term_loan',
};

async function uploadToConfirmable(worker: ReturnType<typeof createWorker>, countryCode: 'US' | 'CA') {
  const call = workerCall(worker);
  const created = await call('/v1/upload-sessions', mutation({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contentType: 'application/pdf', sizeBytes: 2_048, countryCode }),
  }));
  expect(created.status).toBe(201);
  const session = await created.json() as { analysisId: string; analysisKey: string; uploadEndpoint: string };
  await call(session.uploadEndpoint, mutation({
    method: 'PUT',
    headers: { 'content-type': 'application/pdf', 'x-analysis-key': session.analysisKey },
    body: pdfBytes(),
  }));
  const started = await call(`/v1/analyses/${session.analysisId}/start`, mutation({
    method: 'POST',
    headers: { 'x-analysis-key': session.analysisKey },
  }));
  return { call, session, started: await started.json() as { status: string; extraction: { warnings: string[]; defaults: ConfirmedLoan } } };
}

describe('Canadian document flow', () => {
  it('confirms a semiannual-convention note and matches the engine to the cent', async () => {
    const worker = createWorker({ createExtractor: () => new StaticExtractor(fixtureExtractionCA) });
    const { call, session, started } = await uploadToConfirmable(worker, 'CA');
    expect(started.status).toBe('NEEDS_CONFIRMATION');
    expect(started.extraction.defaults.countryCode).toBe('CA');
    expect(started.extraction.defaults.currencyCode).toBe('CAD');
    expect(started.extraction.defaults.interestRateConvention).toBe('nominal_semiannual');

    const confirmed = await call(`/v1/analyses/${session.analysisId}/confirm`, mutation({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-analysis-key': session.analysisKey },
      body: JSON.stringify(CA_LOAN),
    }));
    expect(confirmed.status).toBe(200);
    const body = await confirmed.json() as {
      status: string;
      xray: { known: { countryCode: string; currencyCode: string }; current: { mode: string; annualizedDebtServiceCents: number } };
    };
    expect(body.status).toBe('READY');
    expect(body.xray.known.countryCode).toBe('CA');
    expect(body.xray.known.currencyCode).toBe('CAD');
    expect(body.xray.current.mode).toBe('FULL');
    // The engine is the single source of truth for the semiannual conversion.
    const expected = projectCurrentLoan(CA_LOAN, new Date().toISOString().slice(0, 10));
    expect(body.xray.current.annualizedDebtServiceCents).toBe(expected.annualizedDebtServiceCents);
  });

  it('gives a limited X-Ray, never a guess, when the convention stays unstated', async () => {
    const worker = createWorker({ createExtractor: () => new StaticExtractor(fixtureExtractionCAUnstated) });
    const { call, session, started } = await uploadToConfirmable(worker, 'CA');
    expect(started.extraction.defaults.interestRateConvention).toBe('unknown');

    const confirmed = await call(`/v1/analyses/${session.analysisId}/confirm`, mutation({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-analysis-key': session.analysisKey },
      body: JSON.stringify({ ...CA_LOAN, interestRateConvention: 'unknown' }),
    }));
    const body = await confirmed.json() as {
      status: string;
      xray: { current: { mode: string; requiredFields?: string[] } };
    };
    expect(body.status).toBe('READY');
    expect(body.xray.current.mode).toBe('LIMITED');
    expect(body.xray.current.requiredFields).toContain('interestRateConvention');
  });

  it('warns when the picked country conflicts with the document', async () => {
    const worker = createWorker({ createExtractor: () => new StaticExtractor(fixtureExtractionCA) });
    const { started } = await uploadToConfirmable(worker, 'US');
    expect(started.extraction.warnings.join(' ')).toMatch(/reads as a Canadian loan/i);
    // Extraction wins as the default; the client surfaces the choice.
    expect(started.extraction.defaults.countryCode).toBe('CA');
  });
});

describe('manual analyses', () => {
  it('creates, confirms, and stores nothing in object storage', async () => {
    const worker = createWorker({ createExtractor: () => new StaticExtractor(fixtureExtractionCA) });
    const call = workerCall(worker);
    const created = await call('/v1/manual-analyses', mutation({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ countryCode: 'CA' }),
    }));
    expect(created.status).toBe(201);
    const session = await created.json() as { analysisId: string; analysisKey: string };

    const confirmed = await call(`/v1/analyses/${session.analysisId}/confirm`, mutation({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-analysis-key': session.analysisKey },
      body: JSON.stringify({ ...CA_LOAN, termsSource: 'manual' }),
    }));
    expect(confirmed.status).toBe(200);
    const body = await confirmed.json() as { status: string; confirmedLoan: { termsSource: string } };
    expect(body.status).toBe('READY');
    expect(body.confirmedLoan.termsSource).toBe('manual');
    expect(supabase.state.objects.size).toBe(0);
  });

  it('stays available while document processing is gated off', async () => {
    // No injected extractor and no operator attestation: uploads fail closed,
    // but typing your own terms involves no model call at all.
    const worker = createWorker();
    const call = workerCall(worker);
    const upload = await call('/v1/upload-sessions', mutation({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'application/pdf', sizeBytes: 2_048, countryCode: 'US' }),
    }));
    expect(upload.status).toBe(503);
    const manual = await call('/v1/manual-analyses', mutation({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ countryCode: 'US' }),
    }));
    expect(manual.status).toBe(201);
  });
});

describe('watch series country guard', () => {
  it('rejects a US series on a Canadian loan and accepts CORRA', async () => {
    const worker = createWorker({ createExtractor: () => new StaticExtractor(fixtureExtractionCA) });
    const call = workerCall(worker);
    const { cookie } = await createSession(env, {
      accessToken: 'access-token-test',
      refreshToken: 'refresh-token-test',
      expiresInSeconds: 3_600,
      userId: USER_ID,
    });
    const resolved = await resolveSession(env, new Request(`${ORIGIN}/v1/me`, { headers: { cookie } }));
    expect(resolved).not.toBeNull();
    const csrf = await csrfTokenFor(env, resolved!.recordId);

    const loanId = '22222222-2222-4222-8222-222222222222';
    supabase.table('saved_loans').push({
      id: loanId,
      user_id: USER_ID,
      nickname: 'North quarter',
      country_code: 'CA',
      currency_code: 'CAD',
      confirmed_loan: CA_LOAN,
      xray: null,
      saved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const authed = (body: unknown) => mutation({
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
      body: JSON.stringify(body),
    });
    const rejected = await call(`/v1/account/loans/${loanId}/alerts`, authed({
      kind: 'public_rate_threshold',
      benchmarkSeries: 'SOFR',
      thresholdBps: 450,
      direction: 'at_or_below',
    }));
    expect(rejected.status).toBe(400);

    const accepted = await call(`/v1/account/loans/${loanId}/alerts`, authed({
      kind: 'public_rate_threshold',
      benchmarkSeries: 'CORRA',
      thresholdBps: 450,
      direction: 'at_or_below',
    }));
    expect(accepted.status).toBe(201);
  });

  it('creates a payment reminder with a chosen lead time on a Canadian loan', async () => {
    const worker = createWorker({ createExtractor: () => new StaticExtractor(fixtureExtractionCA) });
    const call = workerCall(worker);
    const { cookie } = await createSession(env, {
      accessToken: 'access-token-test',
      refreshToken: 'refresh-token-test',
      expiresInSeconds: 3_600,
      userId: USER_ID,
    });
    const resolved = await resolveSession(env, new Request(`${ORIGIN}/v1/me`, { headers: { cookie } }));
    const csrf = await csrfTokenFor(env, resolved!.recordId);

    const loanId = '33333333-3333-4333-8333-333333333333';
    supabase.table('saved_loans').push({
      id: loanId,
      user_id: USER_ID,
      nickname: 'South quarter',
      country_code: 'CA',
      currency_code: 'CAD',
      confirmed_loan: CA_LOAN,
      xray: null,
      saved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const authed = (body: unknown) => mutation({
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
      body: JSON.stringify(body),
    });

    const created = await call(`/v1/account/loans/${loanId}/alerts`, authed({ kind: 'payment_due', leadDays: 21 }));
    expect(created.status).toBe(201);
    const { alert } = await created.json() as { alert: { kind: string; leadDays?: number } };
    expect(alert.kind).toBe('payment_due');
    expect(alert.leadDays).toBe(21);

    // A lead time is meaningless without a payment schedule to measure it
    // against, so the route refuses to store one on another kind of watch.
    const misplaced = await call(`/v1/account/loans/${loanId}/alerts`, authed({ kind: 'maturity', leadDays: 21 }));
    expect(misplaced.status).toBe(400);
  });
});
