import {
  AnswerChallengeResponseSchema,
  ChallengeResponseSchema,
  ChallengesResponseSchema,
  FriendlyChallengesResponseSchema,
  type AnswerChallengeResponse,
  type ChallengesResponse,
  type ChallengeView,
} from '@heartpatch/shared';
import { apiCall, apiCallFor } from '../net/api.js';

/** Friendly battles' calls (#29; server: modules/challenges). `key` makes a retry safe. */
export const friendlyApi = {
  /** Who's here now, the asks waiting for me, and the one I sent. */
  view: (mapId: string): Promise<ChallengesResponse> =>
    apiCallFor(`/maps/${mapId}/challenges`, { method: 'GET', schema: ChallengesResponseSchema }),

  /** "Battle me?" to a map-mate who's here. */
  ask: (mapId: string, toUserId: string, key: string): Promise<ChallengeView> =>
    apiCallFor(`/maps/${mapId}/challenges`, {
      method: 'POST',
      body: { toUserId },
      schema: ChallengeResponseSchema,
      headers: { 'idempotency-key': key },
    }).then((res) => res.challenge),

  /** "Battle!" (`yes`) or "Not now!". */
  answer: (
    challengeId: string,
    answer: 'yes' | 'not-now',
    key: string,
  ): Promise<AnswerChallengeResponse> =>
    apiCallFor(`/challenges/${challengeId}/answer`, {
      method: 'POST',
      body: { answer },
      schema: AnswerChallengeResponseSchema,
      headers: { 'idempotency-key': key },
    }),

  /** "Never mind": calls off the ask I sent. */
  cancel: async (challengeId: string, key: string): Promise<void> => {
    await apiCall(`/challenges/${challengeId}/cancel`, {
      method: 'POST',
      schema: null,
      headers: { 'idempotency-key': key },
    });
  },

  /** The patch owner's switch. */
  setFriendly: (mapId: string, friendlyChallenges: boolean): Promise<boolean> =>
    apiCallFor(`/maps/${mapId}/friendly-challenges`, {
      method: 'POST',
      body: { friendlyChallenges },
      schema: FriendlyChallengesResponseSchema,
    }).then((res) => res.friendlyChallenges),
};

export type FriendlyApi = typeof friendlyApi;
