import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, type AppDependencies } from '../src/api/server.js';
import { StaticExtractor } from '../src/api/extractor.js';
import { InMemoryRepository } from '../src/api/repository.js';
import { InMemoryPrivateStorage } from '../src/api/storage.js';
import { PublicRateService } from '../src/api/public-rates.js';
import { reapExpiredData } from '../src/api/reaper.js';
import type { AppConfig } from '../src/api/env.js';
import type { Extraction } from '../src/shared/schema.js';

const config: AppConfig = {
  OPENAI_API_KEY: 'test',
  OPENAI_DATA_CONTROLS_VERIFIED: true,
  EXTRACTION_TIMEOUT_MS: 75_000,
  PRIMARY_EXTRACTION_MODEL: 'test',
  FALLBACK_EXTRACTION_MODEL: 'test',
  DATABASE_URL: 'https://db.test',
  SUPABASE_URL: 'https://storage.test',
  SUPABASE_SECRET_KEY: 'test',
  OBJECT_STORAGE_BUCKET: 'loan-documents',
  SIGNED_URL_TTL_SECONDS: 600,
  UPLOAD_SESSION_TTL_SECONDS: 600,
  RAW_FILE_TTL_SECONDS: 3_600,
  ANONYMOUS_ANALYSIS_TTL_SECONDS: 86_400,
  LENDER_INTEREST_ENABLED: false,
  API_PORT: 8787,
  ALLOWED_ORIGIN: 'http://localhost:5173',
  TRUST_PROXY_HOPS: 0,
  RATE_LIMIT_SALT: 'test-rate-limit-salt-1234',
};
const extraction: Extraction = {
  document_type: 'loan_statement',
  document_date: '2026-08-01',
  loan_count: 1,
  multiple_loans_detected: false,
  sensitive_identifiers_detected: ['account_number'],
  warnings: [],
  loan: {
    lender_name: { value: 'Example Farm Bank person@example.com', confidence: .99, evidence: 'Account 123456789 and SSN 123-45-6789', page: 1 },
    loan_purpose: { value: 'farm equipment', confidence: .9, evidence: 'purpose', page: 1 },
    principal_balance_cents: { value: 32_784_000, confidence: .99, evidence: 'current principal', page: 1 },
    annual_interest_rate_bps: { value: 785, confidence: .99, evidence: 'interest rate', page: 1 },
    rate_type: { value: 'fixed', confidence: .99, evidence: 'fixed', page: 1 },
    payment_amount_cents: { value: 9_865_144, confidence: .99, evidence: 'annual payment', page: 1 },
    payment_frequency: { value: 'annual', confidence: .99, evidence: 'annual', page: 1 },
    next_payment_date: { value: null, confidence: 0, evidence: null, page: null },
    maturity_date: { value: '2030-03-01', confidence: .99, evidence: 'maturity', page: 1 },
    remaining_payments: { value: 4, confidence: .99, evidence: 'four payments', page: 1 },
    balloon_amount_cents: { value: null, confidence: 0, evidence: null, page: null },
    interest_only: { value: false, confidence: .99, evidence: 'amortizing', page: 1 },
    prepayment_penalty: { value: null, confidence: 0, evidence: null, page: null },
    country_code: { value: 'US', confidence: .99, evidence: 'United States', page: 1 },
    currency_code: { value: 'USD', confidence: .99, evidence: 'USD', page: 1 },
    interest_rate_convention: { value: 'nominal_payment_frequency', confidence: .99, evidence: 'annual rate', page: 1 },
  },
};
const pdf = Buffer.from('%PDF-1.4\n% synthetic loan document\n');

function setup(extractionResult = extraction, delayMs = 0, configOverrides: Partial<AppConfig> = {}) {
  const repository = new InMemoryRepository();
  const storage = new InMemoryPrivateStorage();
  const dependencies: AppDependencies = {
    config: { ...config, ...configOverrides },
    repository,
    storage,
    extractor: new StaticExtractor(extractionResult, delayMs),
    rates: new PublicRateService(repository, { fetch: async () => { throw new Error('offline'); } }),
  };
  return { app: createApp(dependencies), repository, storage };
}

async function createSession(app: ReturnType<typeof createApp>, body = pdf) {
  const response = await request(app).post('/v1/upload-sessions').send({ contentType: 'application/pdf', sizeBytes: body.length }).expect(201);
  return { response, id: response.body.analysisId as string, key: response.body.analysisKey as string };
}

function upload(app: ReturnType<typeof createApp>, id: string, key: string, body = pdf) {
  return request(app).put(`/v1/analyses/${id}/document`).set('x-analysis-key', key).set('content-type', 'application/pdf').send(body);
}

async function uploadedSession(app: ReturnType<typeof createApp>) {
  const session = await createSession(app);
  await upload(app, session.id, session.key).expect(204);
  return session;
}

describe('private API vertical slice', () => {
  it('uses a server-mediated upload and completes the full deterministic flow', async () => {
    const { app, storage, repository } = setup();
    const session = await createSession(app);
    expect(session.response.body).toMatchObject({
      analysisId: expect.any(String),
      analysisKey: expect.any(String),
      uploadEndpoint: `/v1/analyses/${session.id}/document`,
      sessionExpiresAt: expect.any(String),
      rawFileDeleteAt: expect.any(String),
    });
    expect(session.response.body).not.toHaveProperty('uploadUrl');
    expect(session.response.body).not.toHaveProperty('uploadToken');
    expect(session.response.body).not.toHaveProperty('objectPath');
    await upload(app, session.id, session.key).expect(204);
    const extracted = await request(app).post(`/v1/analyses/${session.id}/start`).set('x-analysis-key', session.key).send({}).expect(200);
    expect(extracted.body.status).toBe('NEEDS_CONFIRMATION');
    expect(extracted.body.extraction.fields).toHaveLength(8);
    expect(JSON.stringify(extracted.body)).not.toMatch(/123-45-6789|123456789|person@example\.com|evidence/i);
    const persisted = repository.analyses.get(session.id)!;
    expect(JSON.stringify(persisted.extraction)).not.toMatch(/123-45-6789|123456789|person@example\.com/);
    const repeatedStart = await request(app).post(`/v1/analyses/${session.id}/start`).set('x-analysis-key', session.key).send({}).expect(200);
    expect(repeatedStart.body.status).toBe('NEEDS_CONFIRMATION');
    const ready = await request(app).post(`/v1/analyses/${session.id}/confirm`).set('x-analysis-key', session.key).send(extracted.body.extraction.defaults).expect(200);
    const asOfDate = new Date().toISOString().slice(0, 10);
    expect(ready.body).toMatchObject({ status: 'READY', xray: { decisionState: 'NO_SCENARIO_TESTED_YET', asOfDate } });
    expect(ready.body.xray.current.calculationDisclosure).toMatchObject({ asOfDate, periodsPerYear: 1 });
    expect(storage.deleted).toHaveLength(1);
    const repeatedConfirm = await request(app).post(`/v1/analyses/${session.id}/confirm`).set('x-analysis-key', session.key).send(extracted.body.extraction.defaults).expect(200);
    expect(repeatedConfirm.body.status).toBe('READY');
    await request(app).post(`/v1/analyses/${session.id}/confirm`).set('x-analysis-key', session.key).send({ ...extracted.body.extraction.defaults, annualInterestRateBps: 700 }).expect(409);
    const scenario = await request(app).post(`/v1/analyses/${session.id}/scenarios`).set('x-analysis-key', session.key).send({ candidateAnnualRateBps: 685, remainingPeriods: 4, paymentFrequency: 'annual', feesCents: 0, feeTreatment: 'cash' }).expect(200);
    expect(scenario.body.scenario.calculationDisclosure.asOfDate).toBe(asOfDate);
    expect(scenario.body.narrative).toMatch(/applies only to the tested/i);
    await request(app).post(`/v1/analyses/${session.id}/lender-interest`).set('x-analysis-key', session.key).send({ goal: 'total_cost', consent: true }).expect(403);
    await request(app).delete(`/v1/analyses/${session.id}`).set('x-analysis-key', session.key).expect(204);
    await request(app).get(`/v1/analyses/${session.id}`).set('x-analysis-key', session.key).expect(404);
  });

  it('fails closed when OpenAI data controls are not attested and exposes only readiness', async () => {
    const { app } = setup(extraction, 0, { OPENAI_DATA_CONTROLS_VERIFIED: false });
    const health = await request(app).get('/health').expect(200);
    expect(health.body).toEqual({ ok: true, service: 'farm-loan-xray-api', documentProcessingReady: false });
    expect(JSON.stringify(health.body)).not.toMatch(/openai|retention|monitoring/i);
    await request(app).post('/v1/upload-sessions').send({ contentType: 'application/pdf', sizeBytes: pdf.length }).expect(503);
  });

  it('rejects MIME spoofing and actual oversized bodies before storage', async () => {
    const { app, storage } = setup();
    const spoof = await createSession(app);
    await upload(app, spoof.id, spoof.key, Buffer.from('\xff\xd8\xff not a pdf')).expect(400);
    expect(storage.objects.size).toBe(0);

    const oversized = await createSession(app, Buffer.alloc(1));
    await upload(app, oversized.id, oversized.key, Buffer.alloc(20 * 1024 * 1024 + 1, 0x25)).expect(413);
    expect(storage.objects.size).toBe(0);
  });

  it('rejects MIME/signature mismatches without persisting a body', async () => {
    const { app, storage } = setup();
    const session = await createSession(app);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    const mismatch = await request(app).put(`/v1/analyses/${session.id}/document`)
      .set('x-analysis-key', session.key)
      .set('content-type', 'application/pdf')
      .send(jpeg)
      .expect(400);
    expect(mismatch.body.error.code).toBe('UPLOAD_SIZE_MISMATCH');
    expect(storage.objects.size).toBe(0);

    const correctlySized = await createSession(app, jpeg);
    const signature = await request(app).put(`/v1/analyses/${correctlySized.id}/document`)
      .set('x-analysis-key', correctlySized.key)
      .set('content-type', 'application/pdf')
      .send(jpeg)
      .expect(415);
    expect(signature.body.error.code).toBe('MIME_SIGNATURE_MISMATCH');
    expect(storage.objects.size).toBe(0);
  });

  it('rejects expired uploads and upload-after-delete', async () => {
    const { app, repository } = setup();
    const expired = await createSession(app);
    const record = repository.analyses.get(expired.id)!;
    record.uploadSessionExpiresAt = '2026-01-01T00:00:00.000Z';
    repository.analyses.set(record.id, record);
    await upload(app, expired.id, expired.key).expect(410);

    const deleted = await createSession(app);
    await request(app).delete(`/v1/analyses/${deleted.id}`).set('x-analysis-key', deleted.key).expect(204);
    await upload(app, deleted.id, deleted.key).expect(404);
  });

  it('enforces every public state boundary and disallows re-upload', async () => {
    const { app } = setup();
    const session = await createSession(app);
    const headers = { 'x-analysis-key': session.key };
    await request(app).post(`/v1/analyses/${session.id}/start`).set(headers).send({}).expect(409);
    await request(app).post(`/v1/analyses/${session.id}/confirm`).set(headers).send({}).expect(400);
    await request(app).post(`/v1/analyses/${session.id}/scenarios`).set(headers).send({ candidateAnnualRateBps: 500, remainingPeriods: 4, paymentFrequency: 'annual' }).expect(409);
    await upload(app, session.id, session.key).expect(204);
    await upload(app, session.id, session.key).expect(409);
  });

  it('makes concurrent starts and same-payload confirmations idempotent', async () => {
    const { app } = setup(extraction, 25);
    const session = await uploadedSession(app);
    const startCalls = await Promise.all([
      request(app).post(`/v1/analyses/${session.id}/start`).set('x-analysis-key', session.key).send({}),
      request(app).post(`/v1/analyses/${session.id}/start`).set('x-analysis-key', session.key).send({}),
    ]);
    expect(startCalls.map((result) => result.status).sort()).toEqual([200, 409]);
    const confirmation = startCalls.find((result) => result.status === 200)!.body.extraction.defaults;
    const confirmCalls = await Promise.all([
      request(app).post(`/v1/analyses/${session.id}/confirm`).set('x-analysis-key', session.key).send(confirmation),
      request(app).post(`/v1/analyses/${session.id}/confirm`).set('x-analysis-key', session.key).send(confirmation),
    ]);
    expect(confirmCalls.every((result) => result.status === 200)).toBe(true);
    expect(confirmCalls.every((result) => result.body.status === 'READY')).toBe(true);
  });

  it('round-trips an extracted next payment date through the confirmable defaults', async () => {
    // It anchors the payment calendar, so it has to survive the confirm hop —
    // without becoming a ninth field the farmer is asked to review.
    const { app } = setup({
      ...extraction,
      loan: {
        ...extraction.loan,
        next_payment_date: { value: '2026-09-01', confidence: .97, evidence: 'next payment due', page: 1 },
      },
    });
    const session = await uploadedSession(app);
    const extracted = await request(app).post(`/v1/analyses/${session.id}/start`).set('x-analysis-key', session.key).send({}).expect(200);
    expect(extracted.body.extraction.defaults.nextPaymentDate).toBe('2026-09-01');
    expect(extracted.body.extraction.fields).toHaveLength(8);
    expect(extracted.body.extraction.fields.map((field: { key: string }) => field.key)).not.toContain('nextPaymentDate');
    const ready = await request(app).post(`/v1/analyses/${session.id}/confirm`).set('x-analysis-key', session.key).send(extracted.body.extraction.defaults).expect(200);
    expect(ready.body.confirmedLoan.nextPaymentDate).toBe('2026-09-01');
  });

  it('uses structured multi-loan detection and immediately discards the file', async () => {
    const { app, storage } = setup({ ...extraction, loan_count: 2, multiple_loans_detected: true, warnings: [] });
    const session = await uploadedSession(app);
    const result = await request(app).post(`/v1/analyses/${session.id}/start`).set('x-analysis-key', session.key).send({}).expect(200);
    expect(result.body).toMatchObject({ status: 'FAILED', errorCode: 'MULTIPLE_LOANS_UNSUPPORTED' });
    expect(storage.deleted).toHaveLength(1);
  });

  it('retains failed cleanup paths for the reaper and retries safely', async () => {
    const { app, storage, repository } = setup();
    const session = await uploadedSession(app);
    const extracted = await request(app).post(`/v1/analyses/${session.id}/start`).set('x-analysis-key', session.key).send({}).expect(200);
    storage.failNextRemove = true;
    await request(app).post(`/v1/analyses/${session.id}/confirm`).set('x-analysis-key', session.key).send(extracted.body.extraction.defaults).expect(200);
    const retained = repository.analyses.get(session.id)!;
    expect(retained.status).toBe('READY');
    expect(retained.objectPath).toBeTruthy();
    expect(retained.rawDeleteAt).toBeTruthy();
    const outcome = await reapExpiredData(repository, storage, new Date(Date.now() + 1_000));
    expect(outcome).toMatchObject({ rawDeleted: 1, cleanupFailures: 0 });
    expect(repository.analyses.get(session.id)?.objectPath).toBeNull();
  });

  it('keeps upload failures reaper-visible when immediate cleanup also fails', async () => {
    const { app, storage, repository } = setup();
    const session = await createSession(app);
    storage.failNextUpload = true;
    storage.failNextRemove = true;
    await upload(app, session.id, session.key).expect(502);
    const failed = repository.analyses.get(session.id)!;
    expect(failed).toMatchObject({ status: 'FAILED', objectPath: expect.any(String), errorCode: 'UPLOAD_FAILED' });
    const outcome = await reapExpiredData(repository, storage, new Date(Date.now() + 1_000));
    expect(outcome.rawDeleted).toBe(1);
  });

  it('records only allow-listed analytics properties', async () => {
    const { app, repository } = setup();
    await request(app).post('/v1/events').send({
      event: 'scenario_completed',
      sessionId: '95aa1f48-7ae9-4841-b4b5-3ca522c48060',
      properties: { scenarioCount: 1, balance: 32_784_000, rate: 785, email: 'person@example.com' },
    }).expect(204);
    expect(repository.events[0]?.properties).toEqual({ scenarioCount: 1 });
    expect(JSON.stringify(repository.events)).not.toContain('person@example.com');
  });
});
