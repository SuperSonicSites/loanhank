import { createHash } from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { getConfig, type AppConfig } from './env.js';
import { AnalysisService } from './analysis.js';
import { OpenAIExtractor, type DocumentExtractor } from './extractor.js';
import { PublicRateService } from './public-rates.js';
import { PostgresRepository, type AnalysisRecord, type AnalysisRepository } from './repository.js';
import { SupabasePrivateStorage, type PrivateStorage } from './storage.js';
import {
  analyticsEventSchema,
  confirmedLoanSchema,
  scenarioRequestSchema,
  uploadSessionRequestSchema,
} from '../shared/schema.js';
import {
  assertUploadAllowed,
  assertUploadBytes,
  createAnalysisCredentials,
  hashAccessKey,
  PublicApiError,
  safeObjectPath,
} from './security.js';

export interface AppDependencies {
  config: AppConfig;
  repository: AnalysisRepository;
  storage: PrivateStorage;
  extractor: DocumentExtractor;
  rates: PublicRateService;
}

export function createDependencies(config = getConfig()): AppDependencies {
  const repository = new PostgresRepository(config);
  return {
    config,
    repository,
    storage: new SupabasePrivateStorage(config),
    extractor: new OpenAIExtractor(config),
    rates: new PublicRateService(repository),
  };
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  const analysisService = new AnalysisService(
    dependencies.config,
    dependencies.repository,
    dependencies.storage,
    dependencies.extractor,
  );
  app.disable('x-powered-by');
  app.set('trust proxy', dependencies.config.TRUST_PROXY_HOPS > 0 ? dependencies.config.TRUST_PROXY_HOPS : false);
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  }));
  app.use(cors({
    origin: dependencies.config.ALLOWED_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['content-type', 'x-analysis-key'],
  }));

  const uploadSessionLimiter = createRateLimiter(dependencies.config, 10, 60 * 60_000);
  const processingLimiter = createRateLimiter(dependencies.config, 10, 60 * 60_000);
  const readScenarioLimiter = createRateLimiter(dependencies.config, 60, 15 * 60_000);
  const analyticsLimiter = createRateLimiter(dependencies.config, 120, 15 * 60_000);

  app.use(express.json({ limit: '64kb', type: 'application/json' }));

  app.get('/health', (_request, response) => response.json({
    ok: true,
    service: 'farm-loan-xray-api',
    documentProcessingReady: dependencies.config.OPENAI_DATA_CONTROLS_VERIFIED,
  }));

  app.post('/v1/upload-sessions', uploadSessionLimiter, asyncRoute(async (request, response) => {
    if (!dependencies.config.OPENAI_DATA_CONTROLS_VERIFIED) {
      throw new PublicApiError(503, 'DOCUMENT_PROCESSING_NOT_READY', 'Private document processing is not enabled for this preview.');
    }
    const input = uploadSessionRequestSchema.parse(request.body);
    assertUploadAllowed(input.contentType, input.sizeBytes);
    const credentials = createAnalysisCredentials();
    const now = Date.now();
    const objectPath = safeObjectPath(credentials.analysisId, input.contentType);
    const rawDeleteAt = new Date(now + dependencies.config.RAW_FILE_TTL_SECONDS * 1_000).toISOString();
    const sessionExpiresAt = new Date(Math.min(
      now + dependencies.config.UPLOAD_SESSION_TTL_SECONDS * 1_000,
      Date.parse(rawDeleteAt),
    )).toISOString();
    const record: AnalysisRecord = {
      id: credentials.analysisId,
      accessKeyHash: credentials.accessKeyHash,
      status: 'CREATED',
      objectPath,
      contentType: input.contentType,
      declaredSizeBytes: input.sizeBytes,
      uploadSessionExpiresAt: sessionExpiresAt,
      documentType: null,
      extraction: null,
      validationChecks: [],
      confirmedLoan: null,
      xray: null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + dependencies.config.ANONYMOUS_ANALYSIS_TTL_SECONDS * 1_000).toISOString(),
      rawDeleteAt,
      objectDeletedAt: null,
      errorCode: null,
      countryCode: input.countryCode,
      saveIntentHash: null,
      saveIntentExpiresAt: null,
    };
    await dependencies.repository.create(record);
    response.status(201).json({
      analysisId: credentials.analysisId,
      analysisKey: credentials.accessKey,
      uploadEndpoint: `/v1/analyses/${credentials.analysisId}/document`,
      sessionExpiresAt,
      rawFileDeleteAt: rawDeleteAt,
    });
  }));

  app.put(
    '/v1/analyses/:id/document',
    processingLimiter,
    requireAnalysis(dependencies.repository),
    express.raw({ type: () => true, limit: '20mb' }),
    asyncRoute(async (request, response) => {
      const analysis = request.analysis!;
      if (
        !analysis.uploadSessionExpiresAt
        || Date.parse(analysis.uploadSessionExpiresAt) <= Date.now()
        || !analysis.rawDeleteAt
        || Date.parse(analysis.rawDeleteAt) <= Date.now()
      ) {
        throw new PublicApiError(410, 'UPLOAD_EXPIRED', 'This private upload session has expired. Start a new one.');
      }
      if (analysis.status !== 'CREATED' || !analysis.objectPath || !analysis.contentType || !analysis.declaredSizeBytes) {
        throw new PublicApiError(409, 'INVALID_ANALYSIS_STATE', 'This private upload session cannot accept another document.');
      }
      const contentType = request.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
      if (contentType !== analysis.contentType) {
        throw new PublicApiError(415, 'MIME_SIGNATURE_MISMATCH', 'The upload type does not match the private session.');
      }
      if (!Buffer.isBuffer(request.body)) {
        throw new PublicApiError(400, 'INVALID_REQUEST', 'A raw PDF, JPG, or PNG body is required.');
      }
      assertUploadBytes(contentType, request.body, analysis.declaredSizeBytes);
      const uploading = await dependencies.repository.transition(analysis.id, analysis.accessKeyHash, ['CREATED'], {
        status: 'UPLOADING',
      });
      if (!uploading) throw new PublicApiError(409, 'INVALID_ANALYSIS_STATE', 'This document upload was already started.');
      try {
        await dependencies.storage.upload(uploading.objectPath!, request.body, contentType);
        const uploaded = await dependencies.repository.transition(analysis.id, analysis.accessKeyHash, ['UPLOADING'], {
          status: 'UPLOADED',
        });
        if (!uploaded) {
          await dependencies.storage.remove(uploading.objectPath!);
          throw new PublicApiError(409, 'INVALID_ANALYSIS_STATE', 'The upload state changed before completion.');
        }
        response.status(204).end();
      } catch (error) {
        let cleanup: Partial<AnalysisRecord> = { rawDeleteAt: new Date().toISOString() };
        try {
          await dependencies.storage.remove(uploading.objectPath!);
          cleanup = { objectPath: null, objectDeletedAt: new Date().toISOString(), rawDeleteAt: null };
        } catch {
          // The original object path and immediate raw-file deadline stay reaper-visible.
        }
        await dependencies.repository.transition(analysis.id, analysis.accessKeyHash, ['UPLOADING'], {
          status: 'FAILED',
          errorCode: 'UPLOAD_FAILED',
          ...cleanup,
        });
        if (error instanceof PublicApiError) throw error;
        throw new PublicApiError(502, 'UPLOAD_FAILED', 'The private document could not be stored. Start a new upload session.');
      }
    }),
  );

  app.post('/v1/analyses/:id/start', processingLimiter, requireAnalysis(dependencies.repository), asyncRoute(async (request, response) => {
    const analysis = request.analysis!;
    assertAnalysisAvailable(analysis);
    const started = await analysisService.start(analysis);
    response.json(analysisService.summary(started));
  }));

  app.get('/v1/analyses/:id', readScenarioLimiter, requireAnalysis(dependencies.repository), asyncRoute(async (request, response) => {
    const analysis = request.analysis!;
    assertAnalysisAvailable(analysis);
    response.json(analysisService.summary(analysis));
  }));

  app.post('/v1/analyses/:id/confirm', requireAnalysis(dependencies.repository), asyncRoute(async (request, response) => {
    const analysis = request.analysis!;
    assertAnalysisAvailable(analysis);
    const loan = confirmedLoanSchema.parse(request.body);
    const ready = await analysisService.confirm(analysis, loan);
    response.json(analysisService.summary(ready));
  }));

  app.post('/v1/analyses/:id/scenarios', readScenarioLimiter, requireAnalysis(dependencies.repository), asyncRoute(async (request, response) => {
    const analysis = request.analysis!;
    assertAnalysisAvailable(analysis);
    response.json(analysisService.scenario(analysis, scenarioRequestSchema.parse(request.body)));
  }));

  app.get('/v1/public-rates', readScenarioLimiter, asyncRoute(async (_request, response) => {
    const context = await dependencies.rates.getContext();
    response.json({
      rates: context,
      disclaimer: 'Public reference only — not a borrower-specific rate, quote, approval, or qualification result.',
    });
  }));

  app.post('/v1/analyses/:id/lender-interest', requireAnalysis(dependencies.repository), asyncRoute(async (request, response) => {
    if (!dependencies.config.LENDER_INTEREST_ENABLED) {
      throw new PublicApiError(403, 'LENDER_INTEREST_DISABLED', 'Lender sharing is not enabled for this preview. No document or summary was sent.');
    }
    const analysis = request.analysis!;
    if (analysis.status !== 'READY' || !analysis.confirmedLoan) {
      throw new PublicApiError(409, 'INVALID_ANALYSIS_STATE', 'Complete the analysis before recording lender interest.');
    }
    const input = z.object({ goal: z.enum(['annual_debt_service', 'total_cost', 'maturity_risk']), consent: z.literal(true) }).parse(request.body);
    response.status(202).json({ accepted: true, goal: input.goal, scope: 'structured_summary_only', rawDocumentSent: false });
  }));

  app.delete('/v1/analyses/:id', requireAnalysis(dependencies.repository), asyncRoute(async (request, response) => {
    const analysis = request.analysis!;
    if (analysis.objectPath && !analysis.objectDeletedAt) await dependencies.storage.remove(analysis.objectPath);
    await dependencies.repository.remove(analysis.id, analysis.accessKeyHash);
    response.status(204).end();
  }));

  app.post('/v1/events', analyticsLimiter, asyncRoute(async (request, response) => {
    const event = analyticsEventSchema.parse(request.body);
    await dependencies.repository.recordSafeEvent(
      event.event,
      createHash('sha256').update(event.sessionId).digest('hex'),
      event.properties,
    );
    response.status(204).end();
  }));

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      return response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'One or more submitted values are invalid.' } });
    }
    if (error instanceof PublicApiError) {
      return response.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    if (typeof error === 'object' && error && 'type' in error && error.type === 'entity.too.large') {
      return response.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'This file is larger than the 20 MB upload limit.' } });
    }
    return response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The analysis could not be completed safely. Please try again.' } });
  });
  return app;
}

function createRateLimiter(config: AppConfig, limit: number, windowMs: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (request) => createHash('sha256')
      .update(config.RATE_LIMIT_SALT)
      .update(ipKeyGenerator(request.ip ?? 'unknown'))
      .digest('hex'),
    handler: (_request, response) => response.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Wait before trying again.' },
    }),
  });
}

function requireAnalysis(repository: AnalysisRepository) {
  return (request: Request, _response: Response, next: NextFunction) => {
    void (async () => {
      const accessKey = request.header('x-analysis-key');
      if (!accessKey) throw new PublicApiError(401, 'ANALYSIS_ACCESS_REQUIRED', 'This private analysis requires its session key.');
      const analysisId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
      if (!analysisId) throw new PublicApiError(404, 'ANALYSIS_EXPIRED', 'This private analysis is unavailable or has expired.');
      const analysis = await repository.get(analysisId, hashAccessKey(accessKey));
      if (!analysis) throw new PublicApiError(404, 'ANALYSIS_EXPIRED', 'This private analysis is unavailable or has expired.');
      request.analysis = analysis;
      next();
    })().catch(next);
  };
}

function asyncRoute(handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>) {
  return (request: Request, response: Response, next: NextFunction) => { void handler(request, response, next).catch(next); };
}

function assertAnalysisAvailable(record: AnalysisRecord): void {
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    throw new PublicApiError(410, 'ANALYSIS_EXPIRED', 'This analysis has expired. Start a new private upload.');
  }
}

declare global {
  namespace Express {
    interface Request { analysis?: AnalysisRecord; }
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) {
  const dependencies = createDependencies();
  const app = createApp(dependencies);
  app.listen(dependencies.config.API_PORT, () => {
    console.info(`Farm Loan X-Ray API listening on ${dependencies.config.API_PORT}`);
  });
}
