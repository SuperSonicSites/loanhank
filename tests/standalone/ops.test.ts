import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StaticExtractor } from '../../src/api/extractor.js';
import { createWorker } from '../../standalone/src/worker.js';
import type { StandaloneEnv } from '../../standalone/src/env.js';
import { createFakeSupabase } from './supabase-fake.js';
import { distAssets, executionContext, fixtureExtraction, testEnv } from './fixtures.js';

const ORIGIN = 'https://loanhank.test';

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

function callWith(worker: ReturnType<typeof createWorker>) {
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    const context = executionContext();
    const response = await worker.fetch(new Request(`${ORIGIN}${path}`, init), env, context);
    await context.settle();
    return response;
  };
}

const uploadBody = () => mutation({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ contentType: 'application/pdf', sizeBytes: 2_048, countryCode: 'US' }),
});

const uploadBodyWithToken = (token: string) => mutation({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ contentType: 'application/pdf', sizeBytes: 2_048, countryCode: 'US', turnstileToken: token }),
});

describe('Turnstile upload protection', () => {
  it('is off when no secret is configured, and visible on /health', async () => {
    const worker = createWorker({ createExtractor: () => new StaticExtractor(fixtureExtraction) });
    const call = callWith(worker);
    const health = await (await call('/health')).json() as { uploadProtection: boolean; turnstileSiteKey: string | null };
    expect(health.uploadProtection).toBe(false);
    expect(health.turnstileSiteKey).toBeNull();
    expect((await call('/v1/upload-sessions', uploadBody())).status).toBe(201);
  });

  it('fails closed when enabled: missing 403, invalid 403, outage 503, valid 201', async () => {
    env = { ...env, TURNSTILE_SECRET_KEY: 'secret-key', TURNSTILE_SITE_KEY: 'site-key' };
    let behaviour: 'valid' | 'invalid' | 'outage' = 'valid';
    const worker = createWorker({
      createExtractor: () => new StaticExtractor(fixtureExtraction),
      verifyTurnstile: async () => {
        if (behaviour === 'outage') throw new Error('siteverify unreachable');
        return behaviour === 'valid';
      },
    });
    const call = callWith(worker);

    const health = await (await call('/health')).json() as { uploadProtection: boolean; turnstileSiteKey: string | null };
    expect(health.uploadProtection).toBe(true);
    expect(health.turnstileSiteKey).toBe('site-key');

    const missing = await call('/v1/upload-sessions', uploadBody());
    expect(missing.status).toBe(403);
    expect((await missing.json() as { error: { code: string } }).error.code).toBe('TURNSTILE_REQUIRED');

    behaviour = 'invalid';
    expect((await call('/v1/upload-sessions', uploadBodyWithToken('bad'))).status).toBe(403);

    behaviour = 'outage';
    expect((await call('/v1/upload-sessions', uploadBodyWithToken('any'))).status).toBe(503);

    behaviour = 'valid';
    expect((await call('/v1/upload-sessions', uploadBodyWithToken('good'))).status).toBe(201);
  });
});

describe('global daily extraction quota', () => {
  it('refuses new upload sessions once the daily ceiling is reached', async () => {
    env = { ...env, GLOBAL_DAILY_EXTRACTION_LIMIT: '2' };
    const worker = createWorker({ createExtractor: () => new StaticExtractor(fixtureExtraction) });
    const call = callWith(worker);
    expect((await call('/v1/upload-sessions', uploadBody())).status).toBe(201);
    expect((await call('/v1/upload-sessions', uploadBody())).status).toBe(201);
    const exhausted = await call('/v1/upload-sessions', uploadBody());
    expect(exhausted.status).toBe(429);
    expect((await exhausted.json() as { error: { code: string } }).error.code).toBe('DAILY_CAPACITY_REACHED');
    // Manual entry is unaffected by the extraction quota.
    const manual = await call('/v1/manual-analyses', mutation({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ countryCode: 'US' }),
    }));
    expect(manual.status).toBe(201);
  });

  it('fails closed when the limiter store is unreachable, while reads stay up', async () => {
    const worker = createWorker({ createExtractor: () => new StaticExtractor(fixtureExtraction) });
    const call = callWith(worker);
    supabase.state.failRpc = 'consume_rate_limit';
    const refused = await call('/v1/upload-sessions', uploadBody());
    expect([429, 503]).toContain(refused.status);
    // Read paths opted into failOpen and keep serving.
    expect((await call('/v1/public-rates?country=US')).status).toBe(200);
  });
});

describe('ops summary endpoint', () => {
  it('is invisible without the bearer secret and returns aggregates with it', async () => {
    env = { ...env, ALERT_JOB_SECRET: 'ops-secret' };
    const worker = createWorker({ createExtractor: () => new StaticExtractor(fixtureExtraction) });
    const call = callWith(worker);

    expect((await call('/v1/internal/ops/summary')).status).toBe(404);
    expect((await call('/v1/internal/ops/summary', { headers: { authorization: 'Bearer wrong' } })).status).toBe(404);

    await call('/v1/upload-sessions', uploadBody());
    const response = await call('/v1/internal/ops/summary', { headers: { authorization: 'Bearer ops-secret' } });
    expect(response.status).toBe(200);
    const summary = await response.json() as Record<string, unknown>;
    expect(summary).toHaveProperty('past_raw_deadline');
    expect(summary).toHaveProperty('deliveries_failed_permanently');
    expect(JSON.stringify(summary)).not.toMatch(/analyses\/[0-9a-f-]{36}/);
  });
});
