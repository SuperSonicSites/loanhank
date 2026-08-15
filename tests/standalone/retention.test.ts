import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runRetention } from '../../standalone/src/jobs.js';
import { SupabaseAnalysisRepository } from '../../standalone/src/supabase/analysis-repository.js';
import { SupabasePrivateStorage } from '../../standalone/src/supabase/storage.js';
import { serviceContext } from '../../standalone/src/supabase/rest.js';
import type { StandaloneEnv } from '../../standalone/src/env.js';
import type { AnalysisRecord } from '../../src/api/repository.js';
import { createFakeSupabase } from './supabase-fake.js';
import { distAssets, pdfBytes, testEnv } from './fixtures.js';

let supabase: ReturnType<typeof createFakeSupabase>;
let restore: () => void;
let env: StandaloneEnv;

beforeEach(() => {
  supabase = createFakeSupabase();
  restore = supabase.install();
  env = testEnv(distAssets());
});

afterEach(() => restore());

function record(overrides: Partial<AnalysisRecord> = {}): AnalysisRecord {
  const id = crypto.randomUUID();
  const now = Date.now();
  return {
    id,
    accessKeyHash: 'hash',
    status: 'UPLOADED',
    objectPath: `analyses/${id}/source.pdf`,
    contentType: 'application/pdf',
    declaredSizeBytes: 2_048,
    uploadSessionExpiresAt: new Date(now + 600_000).toISOString(),
    documentType: null,
    extraction: null,
    validationChecks: [],
    confirmedLoan: null,
    xray: null,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 86_400_000).toISOString(),
    rawDeleteAt: new Date(now + 3_600_000).toISOString(),
    objectDeletedAt: null,
    errorCode: null,
    countryCode: 'US',
    ...overrides,
  };
}

async function seed(overrides: Partial<AnalysisRecord> = {}): Promise<AnalysisRecord> {
  const context = serviceContext(env);
  const repository = new SupabaseAnalysisRepository(context);
  const storage = new SupabasePrivateStorage(context, env);
  const analysis = record(overrides);
  await repository.create(analysis);
  if (analysis.objectPath) await storage.upload(analysis.objectPath, pdfBytes(), 'application/pdf');
  return analysis;
}

describe('retention', () => {
  it('removes a raw document once its deletion deadline passes', async () => {
    await seed({ rawDeleteAt: new Date(Date.now() - 1_000).toISOString() });
    expect(supabase.state.objects.size).toBe(1);

    const result = await runRetention(env);

    expect(result.rawDeleted).toBe(1);
    expect(supabase.state.objects.size).toBe(0);
    const row = supabase.table('analyses')[0]!;
    expect(row.object_path).toBeNull();
    expect(row.object_deleted_at).toBeTruthy();
    // An upload that never reached confirmation is terminal, not silently reusable.
    expect(row.status).toBe('FAILED');
    expect(row.error_code).toBe('UPLOAD_EXPIRED');
  });

  it('leaves a document alone while it is still within its window', async () => {
    await seed();
    const result = await runRetention(env);
    expect(result.rawDeleted).toBe(0);
    expect(supabase.state.objects.size).toBe(1);
  });

  it('deletes the analysis row and its object when the analysis itself expires', async () => {
    await seed({ expiresAt: new Date(Date.now() - 1_000).toISOString() });
    const result = await runRetention(env);
    expect(result.analysesDeleted).toBeGreaterThanOrEqual(1);
    expect(supabase.table('analyses')).toHaveLength(0);
    expect(supabase.state.objects.size).toBe(0);
  });

  it('keeps the metadata row when the object cannot be removed, so the next run retries', async () => {
    const analysis = await seed({ rawDeleteAt: new Date(Date.now() - 1_000).toISOString() });
    // Simulate a storage outage by pointing the row at an object that is gone
    // from storage but whose delete call fails.
    supabase.state.objects.delete(analysis.objectPath!);
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.method === 'DELETE' && request.url.includes('/storage/v1/object/')) {
        return new Response('{}', { status: 500 });
      }
      return original(input as RequestInfo, init);
    }) as typeof fetch;

    const result = await runRetention(env);
    globalThis.fetch = original;

    expect(result.cleanupFailures).toBe(1);
    expect(supabase.table('analyses')[0]!.object_path).toBe(analysis.objectPath);
  });

  it('reports what the database-side sweep removed', async () => {
    await seed({ expiresAt: new Date(Date.now() - 1_000).toISOString(), objectPath: null });
    const result = await runRetention(env);
    expect(result).toMatchObject({
      pkceStatesDeleted: expect.any(Number),
      sessionsDeleted: expect.any(Number),
      rateLimitsDeleted: expect.any(Number),
      analyticsDeleted: expect.any(Number),
    });
  });
});
