import 'dotenv/config';
import { z } from 'zod';

const configurationSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_DATA_CONTROLS_VERIFIED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  EXTRACTION_TIMEOUT_MS: z.coerce.number().int().min(15_000).max(180_000).default(75_000),
  PRIMARY_EXTRACTION_MODEL: z.string().min(1).default('gpt-5.6-terra'),
  FALLBACK_EXTRACTION_MODEL: z.string().min(1).default('gpt-5.6-sol'),
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  OBJECT_STORAGE_BUCKET: z.string().min(1).default('loan-documents'),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(7_200).default(600),
  UPLOAD_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(600),
  RAW_FILE_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3_600),
  ANONYMOUS_ANALYSIS_TTL_SECONDS: z.coerce.number().int().min(300).max(604_800).default(86_400),
  LENDER_INTEREST_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  ALLOWED_ORIGIN: z.string().default('http://localhost:5173'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  RATE_LIMIT_SALT: z.string().min(16).default('local-preview-rate-limit-salt'),
});

export type AppConfig = z.infer<typeof configurationSchema>;

export function getConfig(environment = process.env): AppConfig {
  return configurationSchema.parse(environment);
}
