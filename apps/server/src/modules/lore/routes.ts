import { LorebookResponseSchema } from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import type { LoreService } from './service.js';

export interface LoreRoutesOptions {
  hooks: AuthHooks;
}

/** The Lorebook: `GET /lore`, the pages I've found (account-level). */
export const loreRoutes =
  (service: LoreService, options: LoreRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    app.get(
      '/lore',
      {
        schema: { response: { 200: LorebookResponseSchema } },
        preHandler: options.hooks.requireAuth,
      },
      async (request) => ({ pages: await service.lorebook(requireUser(request)) }),
    );
    done();
  };
