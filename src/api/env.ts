import { z } from 'zod';

// Worker configuration. Non-secret values come from wrangler.jsonc `vars`;
// every credential is a Worker secret. Nothing here reaches for a database
// URL: D1 and R2 arrive as bindings on the Worker `env`, not as strings.
const configurationSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_DATA_CONTROLS_VERIFIED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  EXTRACTION_TIMEOUT_MS: z.coerce.number().int().min(15_000).max(180_000).default(75_000),
  PRIMARY_EXTRACTION_MODEL: z.string().min(1).default('gpt-5.6-terra'),
  FALLBACK_EXTRACTION_MODEL: z.string().min(1).default('gpt-5.6-sol'),
  RAW_FILE_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3_600),
  TURNSTILE_SITE_KEY: z.string().default(''),
  TURNSTILE_SECRET_KEY: z.string().default(''),
  RATE_LIMIT_SALT: z.string().min(16).default('local-preview-rate-limit-salt'),
});

export type AppConfig = z.infer<typeof configurationSchema>;

export function getConfig(environment: Record<string, unknown>): AppConfig {
  return configurationSchema.parse(environment);
}
