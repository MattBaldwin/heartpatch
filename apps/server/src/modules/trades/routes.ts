import {
  MapIdParamsSchema,
  OfferParamsSchema,
  PickupRequestSchema,
  PostAtRequestSchema,
  SendOfferRequestSchema,
  SetTradingRequestSchema,
  ShelfParamsSchema,
  TradeShelfResponseSchema,
  TradesResponseSchema,
  TradingResponseSchema,
} from '@heartpatch/shared';
import type { FastifyPluginCallback } from 'fastify';
import type { Idempotency } from '../../lib/idempotency.js';
import { playerRateLimit } from '../../lib/rate-limit.js';
import type { ZodTypeProvider } from '../../lib/zod.js';
import { requireUser, type AuthHooks } from '../auth/hooks.js';
import { TRADE_RATE_LIMITS } from './limits.js';
import type { TradesService } from './service.js';

export interface TradesRoutesOptions {
  hooks: AuthHooks;
  /** `Idempotency-Key` support (`registerIdempotency`). */
  idempotency: (fastify: Parameters<FastifyPluginCallback>[0]) => Idempotency;
  /**
   * `HP_DEV_SQUISHY_GRANTS`: also register the dev route that joins my land
   * to the nearest trading post (e2e and phone testing). Never in production.
   */
  devTools?: boolean;
}

/** Trades, gifts and the mailbox at the trading posts (#271). */
export const tradesRoutes =
  (service: TradesService, options: TradesRoutesOptions): FastifyPluginCallback =>
  (fastify, _options, done) => {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    const { requireAuth } = options.hooks;
    const idempotency = options.idempotency(fastify);
    const rateLimit = playerRateLimit(fastify, 'trades', TRADE_RATE_LIMITS);
    const command = (action: keyof typeof TRADE_RATE_LIMITS) => ({
      preHandler: [requireAuth, rateLimit(action), idempotency.preHandler],
      onSend: idempotency.onSend,
    });

    app.get(
      '/maps/:mapId/trades',
      {
        schema: { params: MapIdParamsSchema, response: { 200: TradesResponseSchema } },
        preHandler: requireAuth,
      },
      async (request) => ({
        trades: await service.view(requireUser(request), request.params.mapId),
      }),
    );

    app.get(
      '/maps/:mapId/trades/shelf/:userId',
      {
        schema: { params: ShelfParamsSchema, response: { 200: TradeShelfResponseSchema } },
        preHandler: [requireAuth, rateLimit('read')],
      },
      async (request) => {
        const { mapId, userId } = request.params;
        return { shelf: await service.shelf(requireUser(request), mapId, userId) };
      },
    );

    app.post(
      '/maps/:mapId/trades',
      {
        schema: {
          params: MapIdParamsSchema,
          body: SendOfferRequestSchema,
          response: { 201: TradesResponseSchema },
        },
        ...command('send'),
      },
      async (request, reply) => {
        const trades = await service.send(requireUser(request), request.params.mapId, request.body);
        return reply.code(201).send({ trades });
      },
    );

    app.post(
      '/maps/:mapId/trades/:offerId/accept',
      {
        schema: {
          params: OfferParamsSchema,
          body: PostAtRequestSchema,
          response: { 200: TradesResponseSchema },
        },
        ...command('answer'),
      },
      async (request) => {
        const { mapId, offerId } = request.params;
        return {
          trades: await service.accept(requireUser(request), mapId, offerId, request.body),
        };
      },
    );

    for (const answer of ['decline', 'cancel'] as const) {
      app.post(
        `/maps/:mapId/trades/:offerId/${answer}`,
        {
          schema: { params: OfferParamsSchema, response: { 200: TradesResponseSchema } },
          ...command('answer'),
        },
        async (request) => {
          const { mapId, offerId } = request.params;
          return { trades: await service[answer](requireUser(request), mapId, offerId) };
        },
      );
    }

    app.post(
      '/maps/:mapId/mailbox/pickup',
      {
        schema: {
          params: MapIdParamsSchema,
          body: PickupRequestSchema,
          response: { 200: TradesResponseSchema },
        },
        ...command('answer'),
      },
      async (request) => ({
        trades: await service.pickup(requireUser(request), request.params.mapId, request.body),
      }),
    );

    app.post(
      '/maps/:mapId/trading',
      {
        schema: {
          params: MapIdParamsSchema,
          body: SetTradingRequestSchema,
          response: { 200: TradingResponseSchema },
        },
        preHandler: [requireAuth, rateLimit('owner')],
      },
      async (request) => ({
        tradingEnabled: await service.setTrading(
          requireUser(request),
          request.params.mapId,
          request.body.tradingEnabled,
        ),
      }),
    );

    if (options.devTools) {
      app.post(
        '/maps/:mapId/dev/posts/connect',
        {
          schema: { params: MapIdParamsSchema, response: { 200: PostAtRequestSchema } },
          preHandler: [requireAuth, rateLimit('owner')],
        },
        async (request) => service.devConnect(requireUser(request), request.params.mapId),
      );
    }

    done();
  };
