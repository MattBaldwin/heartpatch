import {
  AccountHelpersResponseSchema,
  HelperCandidatesResponseSchema,
  MemberPasswordResetResponseSchema,
  NewRecoveryCodeResponseSchema,
  type AccountHelpersResponse,
  type HelperCandidate,
  type MemberPasswordResetResponse,
} from '@heartpatch/shared';
import { apiCallFor } from '../../net/api.js';

// Grown-up helpers and new recovery codes (#197).

const links = (path: string): Promise<AccountHelpersResponse> =>
  apiCallFor(path, { method: 'POST', schema: AccountHelpersResponseSchema });

export const accountApi = {
  helpers: (): Promise<AccountHelpersResponse> =>
    apiCallFor('/account/helpers', { method: 'GET', schema: AccountHelpersResponseSchema }),

  candidates: async (): Promise<HelperCandidate[]> =>
    (
      await apiCallFor('/account/helpers/candidates', {
        method: 'GET',
        schema: HelperCandidatesResponseSchema,
      })
    ).candidates,

  ask: (helperId: string): Promise<AccountHelpersResponse> =>
    apiCallFor('/account/helpers', {
      method: 'POST',
      body: { helperId },
      schema: AccountHelpersResponseSchema,
    }),

  removeHelper: (helperId: string) => links(`/account/helpers/${helperId}/remove`),
  accept: (playerId: string) => links(`/account/helping/${playerId}/accept`),
  decline: (playerId: string) => links(`/account/helping/${playerId}/decline`),
  stopHelping: (playerId: string) => links(`/account/helping/${playerId}/remove`),

  resetPassword: (playerId: string): Promise<MemberPasswordResetResponse> =>
    apiCallFor(`/account/helping/${playerId}/reset-password`, {
      method: 'POST',
      schema: MemberPasswordResetResponseSchema,
    }),

  newRecoveryCode: async (password: string): Promise<string> =>
    (
      await apiCallFor('/auth/recovery-code', {
        method: 'POST',
        body: { password },
        schema: NewRecoveryCodeResponseSchema,
      })
    ).recoveryCode,
};
