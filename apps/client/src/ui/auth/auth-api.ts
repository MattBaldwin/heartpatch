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
    await apiCall('/auth/logout', { method: 'POST', schema: null });
  },
};
