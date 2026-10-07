import {
  CreateSignupCodeResponseSchema,
  InviteResponseSchema,
  JoinMapResponseSchema,
  MapResponseSchema,
  MemberPasswordResetResponseSchema,
  MyMapsResponseSchema,
  MySignupCodesResponseSchema,
  PvpModeResponseSchema,
  type CreateMapRequest,
  type CreateSignupCodeResponse,
  type Invite,
  type MapDetail,
  type MemberPasswordResetResponse,
  type MyJoinRequest,
  type MyMapsResponse,
  type MySignupCodesResponse,
  type PvpMode,
} from '@heartpatch/shared';
import { apiCall, apiCallFor } from '../../net/api.js';

/**
 * The lobby's calls to `/api/v1/maps` (server: modules/maps/routes.ts) and
 * an owner's family codes, `/api/v1/signup-codes` (modules/signup-codes/routes.ts).
 */
export const lobbyApi = {
  myMaps: (): Promise<MyMapsResponse> =>
    apiCallFor('/maps', { method: 'GET', schema: MyMapsResponseSchema }),

  create: async (body: CreateMapRequest): Promise<MapDetail> =>
    (await apiCallFor('/maps', { method: 'POST', body, schema: MapResponseSchema })).map,

  get: async (mapId: string): Promise<MapDetail> =>
    (await apiCallFor(`/maps/${mapId}`, { method: 'GET', schema: MapResponseSchema })).map,

  join: async (code: string): Promise<MyJoinRequest> =>
    (
      await apiCallFor('/maps/join', {
        method: 'POST',
        body: { code },
        schema: JoinMapResponseSchema,
      })
    ).request,

  newInvite: async (mapId: string): Promise<Invite> =>
    (await apiCallFor(`/maps/${mapId}/invite`, { method: 'POST', schema: InviteResponseSchema }))
      .invite,

  revokeInvite: async (mapId: string): Promise<void> => {
    await apiCall(`/maps/${mapId}/invite/revoke`, { method: 'POST', schema: null });
  },

  answer: async (mapId: string, requestId: string, yes: boolean): Promise<void> => {
    const action = yes ? 'approve' : 'deny';
    await apiCall(`/maps/${mapId}/requests/${requestId}/${action}`, {
      method: 'POST',
      schema: null,
    });
  },

  remove: async (mapId: string, userId: string): Promise<void> => {
    await apiCall(`/maps/${mapId}/members/${userId}/remove`, { method: 'POST', schema: null });
  },

  leave: async (mapId: string): Promise<void> => {
    await apiCall(`/maps/${mapId}/leave`, { method: 'POST', schema: null });
  },

  setPvpMode: async (mapId: string, pvpMode: PvpMode): Promise<PvpMode> =>
    (
      await apiCallFor(`/maps/${mapId}/pvp-mode`, {
        method: 'POST',
        body: { pvpMode },
        schema: PvpModeResponseSchema,
      })
    ).pvpMode,

  resetPassword: (mapId: string, userId: string): Promise<MemberPasswordResetResponse> =>
    apiCallFor(`/maps/${mapId}/members/${userId}/reset-password`, {
      method: 'POST',
      schema: MemberPasswordResetResponseSchema,
    }),

  signupCodes: (): Promise<MySignupCodesResponse> =>
    apiCallFor('/signup-codes', { method: 'GET', schema: MySignupCodesResponseSchema }),

  newSignupCode: (label: string): Promise<CreateSignupCodeResponse> =>
    apiCallFor('/signup-codes', {
      method: 'POST',
      body: { label },
      schema: CreateSignupCodeResponseSchema,
    }),

  revokeSignupCode: async (codeId: string): Promise<void> => {
    await apiCall(`/signup-codes/${codeId}/revoke`, { method: 'POST', schema: null });
  },
};
