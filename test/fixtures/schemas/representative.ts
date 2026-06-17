import { z } from 'zod';

// Mirrors example-consumer constructs: coerce, transform, default, optional, enum, superRefine wrap, PEM.
const Base = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development').describe('Runtime mode'),
  LOG_LEVEL: z.string().default('info').describe('Pino log level'),
  PORT: z.coerce.number().int().positive().default(3001).describe('HTTP listen port'),
  FEATURE_X_ENABLED: z.coerce.boolean().default(false).describe('Toggle feature X'),
  CORS_ORIGINS: z
    .string()
    .transform((s) => s.split(','))
    .describe('Comma-separated allowlist'),
  OPTIONAL_FLAG: z.string().optional().describe('Set if present'),
  JWT_PRIVATE_KEY: z.string().optional().describe('Ed25519 PEM'),
  NO_DESCRIPTION_KEY: z.string().default('x'),
});

export const RepresentativeSchema = Base.superRefine((_val, _ctx) => {
  // cross-field rule placeholder; the walker must unwrap past this.
});

export const WebLikeSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:3001').describe('API base URL'),
  LOG_LEVEL: z.string().default('debug').describe('Web log level'), // shared key, divergent default
});
