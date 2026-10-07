import { ShortCommitSchema } from '@heartpatch/shared';
import { z } from 'zod';

/** An unset build arg reaches the image as an empty string: treat it as unset. */
const unsetIfEmpty = (value: unknown) => (value === '' ? undefined : value);

const ConfigSchema = z.object({
  // Defaults to production so a misconfigured image never loads dev-only tooling.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PUBLIC_ORIGIN: z.url().default('http://localhost:5173'),
  APP_VERSION: z.string().min(1).default('dev'),
  // The build number (commits on main) and short sha the image was built from
  // (#198), set by the deploy as build args; unset for local runs.
  APP_BUILD: z.preprocess(unsetIfEmpty, z.coerce.number().int().positive().optional()),
  // A full or short sha; kept as its first 7 hex digits, as the client build does
  // (tooling/version/build-info.ts), so one build arg serves both images.
  APP_COMMIT: z.preprocess(
    unsetIfEmpty,
    z
      .string()
      .regex(/^[0-9a-f]{7,40}$/)
      .transform((sha) => sha.slice(0, 7))
      .pipe(ShortCommitSchema)
      .optional(),
  ),
  // Required, so a missing value stops the server rather than failing on first query.
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // Behind Caddy, trust one proxy hop so request.ip is the player's IP (per-IP rate limits).
  // `buildApp` turns `true` into "trust one private-network hop", never "trust every hop".
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Family-only signup (decision D): creating an account needs this code.
  // Unset closes signups; the server refuses to start without it in production.
  HP_SIGNUP_CODE: z.string().trim().min(8).max(128).optional(),
  // Tutorial gate (decision A): when true, creating or joining a map needs a
  // finished tutorial. Code default off (dev, e2e); production sets it on
  // (owner decision 2026-10-04, infra/compose/.env.prod.example).
  HP_TUTORIAL_REQUIRED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Keeper gate (issue #42): creating or joining a map needs a Keeper, so
  // other players always see who's who. On unless set to false (testing).
  HP_KEEPER_REQUIRED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Dev time override (tech spec §7): the clock starts here. Never in production.
  HP_DEV_NOW: z.iso.datetime({ offset: true }).optional(),
  // Signups per IP per window (auth limits.ts), raised for e2e: every Playwright
  // device project signs up fresh players from one IP. Never in production.
  HP_DEV_SIGNUP_LIMIT_PER_IP: z.coerce.number().int().min(1).max(10_000).optional(),
  // Patches made per IP per window (maps limits.ts), raised for e2e: every
  // Playwright device project makes patches from one IP. Never in production.
  HP_DEV_MAP_CREATE_LIMIT_PER_IP: z.coerce.number().int().min(1).max(10_000).optional(),
  // Dev/test only: registers routes that hand a player squishies, items,
  // clothing and coins, start a battle against a chosen wild squishy, make
  // night fall and jump tutorial steps, for e2e and phone testing. Never in
  // production.
  HP_DEV_SQUISHY_GRANTS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Dev/test only: every found-clothing drop table's chance, in percent (#43),
  // so a find can be tried without gathering a hundred times. Never in production.
  HP_DEV_DROP_CHANCE: z.coerce.number().int().min(0).max(100).optional(),
  // `pnpm db:seed` only: lets the seed write to a database that isn't on this
  // computer (db/seed.ts, `seedTargetRefusal`). Never in production.
  HP_SEED_ALLOW_REMOTE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

/** Settings only the HTTP server needs; tools like `db/cli.ts` skip these checks. */
const ServerConfigSchema = ConfigSchema.refine(
  (c) => c.NODE_ENV !== 'production' || c.HP_SIGNUP_CODE !== undefined,
  { path: ['HP_SIGNUP_CODE'], message: 'required in production (family-only signup)' },
)
  .refine((c) => c.NODE_ENV !== 'production' || c.HP_DEV_NOW === undefined, {
    path: ['HP_DEV_NOW'],
    message: 'development and tests only',
  })
  .refine((c) => c.NODE_ENV !== 'production' || c.HP_DEV_SIGNUP_LIMIT_PER_IP === undefined, {
    path: ['HP_DEV_SIGNUP_LIMIT_PER_IP'],
    message: 'development and tests only',
  })
  .refine((c) => c.NODE_ENV !== 'production' || c.HP_DEV_MAP_CREATE_LIMIT_PER_IP === undefined, {
    path: ['HP_DEV_MAP_CREATE_LIMIT_PER_IP'],
    message: 'development and tests only',
  })
  .refine((c) => c.NODE_ENV !== 'production' || !c.HP_DEV_SQUISHY_GRANTS, {
    path: ['HP_DEV_SQUISHY_GRANTS'],
    message: 'development and tests only',
  })
  .refine((c) => c.NODE_ENV !== 'production' || c.HP_DEV_DROP_CHANCE === undefined, {
    path: ['HP_DEV_DROP_CHANCE'],
    message: 'development and tests only',
  })
  .refine((c) => c.NODE_ENV !== 'production' || !c.HP_SEED_ALLOW_REMOTE, {
    path: ['HP_SEED_ALLOW_REMOTE'],
    message: 'development and tests only',
  });

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Parses and validates environment variables (tech spec §10). Throws with
 * every problem listed, so the server refuses to start on bad config.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return parse(ConfigSchema, env);
}

/** `loadConfig` plus the checks the HTTP server needs to start (`src/index.ts`). */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return parse(ServerConfigSchema, env);
}

function parse(schema: z.ZodType<Config>, env: NodeJS.ProcessEnv): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return result.data;
}
