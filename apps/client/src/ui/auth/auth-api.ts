import {
  MeResponseSchema,
  RecoveryCodeResponseSchema,
  SessionResponseSchema,
  type LoginRequest,
  type PublicUser,
  type RecoverRequest,
  type RecoveryCodeResponse,
  type SignupRequest,
} from '@heartpatch/shared';
import { apiCall, apiCallFor } from '../../net/api.js';
import { PUSH_LOGOUT_TIMEOUT_MS } from '../../pwa/config.js';
import { pushClient } from '../../pwa/push-client.js';

export const authApi = {
  me: async (): Promise<PublicUser | null> =>
    (await apiCallFor('/me', { method: 'GET', schema: MeResponseSchema })).user,

  signup: (body: SignupRequest): Promise<RecoveryCodeResponse> =>
    apiCallFor('/auth/signup', { method: 'POST', body, schema: RecoveryCodeResponseSchema }),

  login: async (body: LoginRequest): Promise<PublicUser> =>
    (await apiCallFor('/auth/login', { method: 'POST', body, schema: SessionResponseSchema })).user,

  recover: (body: RecoverRequest): Promise<RecoveryCodeResponse> =>
    apiCallFor('/auth/recover', { method: 'POST', body, schema: RecoveryCodeResponseSchema }),

  logout: async (): Promise<void> => {
    // Stop this device's nudges first (#726): best effort and time-boxed, so
    // it never holds up or fails the logout. The server deletes the row with
    // the session either way.
    await pushClient.forgetDevice(PUSH_LOGOUT_TIMEOUT_MS);
    await apiCall('/auth/logout', { method: 'POST', schema: null });
  },
};
