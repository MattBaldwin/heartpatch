import { z } from 'zod';
import { KeeperConfigSchema } from './data/keepers.js';

// Keeper API schemas (design doc §23; issue #42). The config is checked
// against `KEEPER_DATA` on the server, not only by shape.

/** `GET /api/v1/keeper`: null until the player picks one (right after signup). */
export const KeeperResponseSchema = z.object({ keeper: KeeperConfigSchema.nullable() });
export type KeeperResponse = z.infer<typeof KeeperResponseSchema>;

/** `POST /api/v1/keeper` body: the whole config; changing it is free (§23). */
export const SetKeeperRequestSchema = KeeperConfigSchema;
export type SetKeeperRequest = z.infer<typeof SetKeeperRequestSchema>;

/** `POST /api/v1/keeper` response: the Keeper as stored. */
export const SetKeeperResponseSchema = z.object({ keeper: KeeperConfigSchema });
export type SetKeeperResponse = z.infer<typeof SetKeeperResponseSchema>;
