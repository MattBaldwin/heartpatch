import { createECDH } from 'node:crypto';
import { ShortCommitSchema } from '@heartpatch/shared';
import { z } from 'zod';

/** An unset build arg reaches the image as an empty string: treat it as unset. */
const unsetIfEmpty = (value: unknown) => (value === '' ? undefined : value);

/** A comma-separated list of usernames (a feature switch's testers), lower-cased, blanks dropped. */
const usernameList = () =>
  z
    .string()
    .default('')
    .transform((list) =>
      list
        .split(',')
        .map((name) => name.trim().toLowerCase())
        .filter((name) => name.length > 0),
    );

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
  // The Keeper's house (#381) feature switch: `off` hides it from everyone
  // (every house route is NOT_FOUND and `HomeResponse.house` is left out),
  // `testers` shows it only to `HP_HOUSE_TESTERS`, `on` to every player.
  // Off by default until the owner's Oct 27 go/no-go (coordinator, 2026-10-11).
  HP_HOUSE: z.enum(['off', 'testers', 'on']).default('off'),
  // Usernames who see the house while `HP_HOUSE=testers`, comma-separated
  // (case doesn't matter). Lets the owner try it on prod while kids don't.
  HP_HOUSE_TESTERS: usernameList(),
  // Wild Isle (#621) feature switch: `off` refuses `wild-isle` patches for
  // everyone (creating one is FORBIDDEN and the lobby hides the choice),
  // `testers` lets only `HP_WILD_ISLE_TESTERS` make one, `on` every player.
  // Off by default; production sets `on` in docker-compose.prod.yml (#752).
  HP_WILD_ISLE: z.enum(['off', 'testers', 'on']).default('off'),
  // Usernames who can make a Wild Isle while `HP_WILD_ISLE=testers`,
  // comma-separated (case doesn't matter), as `HP_HOUSE_TESTERS`.
  HP_WILD_ISLE_TESTERS: usernameList(),
  // The Long Night (#727) feature switch: `off` runs every nightfall as an
  // ordinary night and leaves the Long Night out of every reply, `testers`
  // runs it only on patches with an `HP_LONG_NIGHT_TESTERS` member (the
  // whole patch sees it there), `on` everywhere. Off until the client PR (#727e) merges, so a rollback never
  // strands a client.
  HP_LONG_NIGHT: z.enum(['off', 'testers', 'on']).default('off'),
  // Usernames who see the Long Night while `HP_LONG_NIGHT=testers`,
  // comma-separated (case doesn't matter), as `HP_HOUSE_TESTERS`.
  HP_LONG_NIGHT_TESTERS: usernameList(),
  // Push nudges (#726) feature switch: `off` answers every `/push` route
  // NOT_FOUND and sends nothing, `testers` subscribes and nudges only
  // `HP_PUSH_TESTERS` (each account decides for itself, not its patch), `on`
  // every player. Off by default; the prod compose file doesn't turn it on.
  HP_PUSH: z.enum(['off', 'testers', 'on']).default('off'),
  // Usernames who get nudges while `HP_PUSH=testers`, comma-separated (case
  // doesn't matter), as `HP_HOUSE_TESTERS`.
  HP_PUSH_TESTERS: usernameList(),
  // The VAPID pair (RFC 8292) push services check every nudge against,
  // base64url as `web-push`'s `generateVAPIDKeys()` makes them: the public
  // key is the 65-byte uncompressed P-256 point, the private key its 32-byte
  // scalar. `deploy.sh` generates them on the first deploy (owner answer 4,
  // #726). Changing them ends every phone's subscription. Required (and must
  // match) whenever `HP_PUSH` isn't `off`. Never commit or log the private key.
  HP_VAPID_PUBLIC_KEY: z.preprocess(
    unsetIfEmpty,
    z
      .string()
      .regex(/^B[A-Za-z0-9_-]{86}$/, 'a base64url uncompressed P-256 public key')
      .optional(),
  ),
  HP_VAPID_PRIVATE_KEY: z.preprocess(
    unsetIfEmpty,
    z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/, 'a base64url 32-byte P-256 private key')
      .optional(),
  ),
  // Who the push services can contact about our nudges: a `mailto:` or an
  // `https:` URL. Unset uses `PUBLIC_ORIGIN`.
  HP_VAPID_SUBJECT: z.preprocess(
    unsetIfEmpty,
    z
      .string()
      .regex(/^(?:mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/, 'a mailto: or https: URL')
      .optional(),
  ),
  // Branching evolution (#32): the secret salt evolution rolls are seeded
  // with, so a player who knows a squishy's id can't work out its roll.
  // Required in production; development and tests fall back to a fixed dev
  // salt. Never commit a real value.
  HP_EVOLUTION_SALT: z.string().trim().min(16).max(256).optional(),
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
  // Dev/test only: a live battle's turn time and away-grace in seconds (#29),
  // so e2e can try a timeout and a disconnect without waiting 30 s and 60 s.
  // Never in production.
  HP_DEV_LIVE_TURN_SECONDS: z.coerce.number().int().min(1).max(600).optional(),
  HP_DEV_LIVE_GRACE_SECONDS: z.coerce.number().int().min(0).max(600).optional(),
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
  .refine((c) => c.NODE_ENV !== 'production' || c.HP_EVOLUTION_SALT !== undefined, {
    path: ['HP_EVOLUTION_SALT'],
    message: 'required in production (evolution rolls)',
  })
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
  .refine((c) => c.NODE_ENV !== 'production' || c.HP_DEV_LIVE_TURN_SECONDS === undefined, {
    path: ['HP_DEV_LIVE_TURN_SECONDS'],
    message: 'development and tests only',
  })
  .refine((c) => c.NODE_ENV !== 'production' || c.HP_DEV_LIVE_GRACE_SECONDS === undefined, {
    path: ['HP_DEV_LIVE_GRACE_SECONDS'],
    message: 'development and tests only',
  })
  .refine((c) => c.NODE_ENV !== 'production' || !c.HP_SEED_ALLOW_REMOTE, {
    path: ['HP_SEED_ALLOW_REMOTE'],
    message: 'development and tests only',
  })
  // Push (#726, owner answer 4): a switch that's on with no keys could never
  // send, so the server refuses to start rather than fail on every nudge.
  // In every environment: a dev or test server with push on needs keys too.
  .refine((c) => (c.HP_VAPID_PUBLIC_KEY === undefined) === (c.HP_VAPID_PRIVATE_KEY === undefined), {
    path: ['HP_VAPID_PRIVATE_KEY'],
    message: 'set both VAPID keys or neither',
  })
  .refine((c) => c.HP_PUSH === 'off' || c.HP_VAPID_PRIVATE_KEY !== undefined, {
    path: ['HP_VAPID_PUBLIC_KEY'],
    message: 'required while HP_PUSH is not off (deploy.sh generates them)',
  })
  .refine((c) => vapidPairMatches(c.HP_VAPID_PUBLIC_KEY, c.HP_VAPID_PRIVATE_KEY), {
    path: ['HP_VAPID_PUBLIC_KEY'],
    message: "isn't the public half of HP_VAPID_PRIVATE_KEY",
  });

/**
 * True when the public key is the private key's own (or either is unset):
 * a mismatched pair would sign every nudge with a key no phone subscribed
 * to, and every one would fail. Never reports the keys.
 */
function vapidPairMatches(publicKey: string | undefined, privateKey: string | undefined): boolean {
  if (publicKey === undefined || privateKey === undefined) return true;
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    return ecdh.getPublicKey().toString('base64url') === publicKey;
  } catch {
    // Not a valid scalar on the curve (zero, or past the group order).
    return false;
  }
}

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
