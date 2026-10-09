import {
  DevFindLoreRequestSchema,
  LorebookResponseSchema,
  LoreReadRequestSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { LORE_RATE_LIMITS } from './limits.js';
import type { LoreService } from './service.js';

export interface LoreRoutesOptions {
  hooks: AuthHooks;
  /** Dev and test builds (`HP_DEV_SQUISHY_GRANTS`): `POST /lore/dev/find`. */
  devTools?: boolean;
}

/**
 * The Lorebook (account-level): `GET /lore` (the book: found pages in full,
 * the rest as hints) and `POST /lore/read` (pages read in the book, #307).
 * The post is idempotent by nature, so it needs no `Idempotency-Key`. Dev
 * builds add `POST /lore/dev/find { pageId }` (find a page now).
 */
export const loreRoutes =
  (service: LoreService, options: LoreRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const rateLimit = playerRateLimit(fastify, 'lore', LORE_RATE_LIMITS);
    app.get(
      '/lore',
      { schema: { response: { 200: LorebookResponseSchema } }, preHandler: requireAuth },
      async (request) => service.lorebook(requireUser(request)),
    );
    app.post(
      '/lore/read',
      {
        schema: { body: LoreReadRequestSchema, response: { 200: LorebookResponseSchema } },
        preHandler: [requireAuth, rateLimit('read')],
      },
      async (request) => service.markRead(requireUser(request), request.body.ids),
    );
    if (options.devTools) {
      app.post(
        '/lore/dev/find',
        {
          schema: { body: DevFindLoreRequestSchema, response: { 200: LorebookResponseSchema } },
          preHandler: [requireAuth, rateLimit('read')],
        },
        async (request) => service.devFind(requireUser(request), request.body.pageId),
      );
    }
    done();
  };
