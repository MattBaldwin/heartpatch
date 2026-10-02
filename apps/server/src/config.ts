import { z } from 'zod';

const ConfigSchema = z.object({
  // Defaults to production so a misconfigured image never loads dev-only tooling.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PUBLIC_ORIGIN: z.url().default('http://localhost:5173'),
  APP_VERSION: z.string().min(1).default('dev'),
  // Required, so a missing value stops the server rather than failing on first query.
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // Behind Caddy, trust one proxy hop so request.ip is the player's IP (per-IP rate limits).
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Parses and validates environment variables (tech spec §10). Throws with
 * every problem listed, so the server refuses to start on bad config.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return result.data;
}
