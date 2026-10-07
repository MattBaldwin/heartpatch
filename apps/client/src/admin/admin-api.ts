import {
  AdminAuditResponseSchema,
  AdminInviteResponseSchema,
  AdminLogoutEverywhereResponseSchema,
  AdminLookupResponseSchema,
  AdminMeResponseSchema,
  AdminPatchDetailSchema,
  AdminPatchesResponseSchema,
  AdminPlayerDetailSchema,
  AdminPlayersResponseSchema,
  AdminResetPasswordResponseSchema,
  AdminSignupCodesResponseSchema,
  CreateSignupCodeResponseSchema,
  type AdminCreateSignupCodeRequest,
  type AdminLoginRequest,
  type AdminLookupRequest,
} from '@heartpatch/shared';
import { apiCall, apiCallFor } from '../net/api.js';

// The admin console's calls (#196): `/api/v1/admin/*`, through the shared
// REST client so the CSRF header and error shape match the game's.

/** `?q=&page=` plus extras, dropping empty values. */
function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && value !== false) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const get = <T>(path: string, schema: { parse: (v: unknown) => T }) =>
  apiCallFor(path, { method: 'GET', schema });
const post = <T>(path: string, schema: { parse: (v: unknown) => T }, body?: unknown) =>
  apiCallFor(path, { method: 'POST', schema, ...(body === undefined ? {} : { body }) });
const postEmpty = async (path: string, body?: unknown): Promise<void> => {
  await apiCall(path, { method: 'POST', schema: null, ...(body === undefined ? {} : { body }) });
};

export const adminApi = {
  me: () => get('/admin/me', AdminMeResponseSchema),
  login: (body: AdminLoginRequest) => post('/admin/login', AdminMeResponseSchema, body),
  logout: () => postEmpty('/admin/logout'),

  patches: (q: string, page: number, tutorial: boolean) =>
    get(`/admin/patches${query({ q, page, tutorial })}`, AdminPatchesResponseSchema),
  patch: (mapId: string) => get(`/admin/patches/${mapId}`, AdminPatchDetailSchema),
  revealInvite: (mapId: string) =>
    post(`/admin/patches/${mapId}/invite/reveal`, AdminInviteResponseSchema),
  newInvite: (mapId: string) => post(`/admin/patches/${mapId}/invite`, AdminInviteResponseSchema),
  answer: (mapId: string, requestId: string, answer: 'approve' | 'decline') =>
    postEmpty(`/admin/patches/${mapId}/requests/${requestId}/${answer}`),

  players: (q: string, page: number) =>
    get(`/admin/players${query({ q, page })}`, AdminPlayersResponseSchema),
  player: (userId: string) => get(`/admin/players/${userId}`, AdminPlayerDetailSchema),
  resetPassword: (userId: string) =>
    post(`/admin/players/${userId}/reset-password`, AdminResetPasswordResponseSchema),
  logoutEverywhere: (userId: string) =>
    post(`/admin/players/${userId}/logout-everywhere`, AdminLogoutEverywhereResponseSchema),
  lookup: (body: AdminLookupRequest) => post('/admin/lookup', AdminLookupResponseSchema, body),

  signupCodes: () => get('/admin/signup-codes', AdminSignupCodesResponseSchema),
  createSignupCode: (body: AdminCreateSignupCodeRequest) =>
    post('/admin/signup-codes', CreateSignupCodeResponseSchema, body),
  extendSignupCode: (codeId: string, days: number) =>
    postEmpty(`/admin/signup-codes/${codeId}/extend`, { days }),
  revokeSignupCode: (codeId: string) => postEmpty(`/admin/signup-codes/${codeId}/revoke`),

  audit: (q: string, page: number) =>
    get(`/admin/audit${query({ q, page })}`, AdminAuditResponseSchema),
};
