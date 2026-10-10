import { AnswerChallengeResponseSchema, type PlayerBattle } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** "Defend now?" (#29-C; server: modules/challenges/routes.ts, answered by the battles service). */
export const defenseApi = {
  /** "Defend!" (`yes`: the battle, from my side) or "Not now" (`null`). */
  answer: (
    challengeId: string,
    answer: 'yes' | 'not-now',
    key: string,
  ): Promise<PlayerBattle | null> =>
    apiCallFor(`/challenges/${challengeId}/answer`, {
      method: 'POST',
      body: { answer },
      schema: AnswerChallengeResponseSchema,
      headers: { 'idempotency-key': key },
    }).then((res) => res.battle),
};

export type DefenseApi = typeof defenseApi;
