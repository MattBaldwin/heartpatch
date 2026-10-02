import {
  ApiErrorSchema,
  DEFAULT_ERROR_MESSAGES,
  MeResponseSchema,
  RecoveryCodeResponseSchema,
  SessionResponseSchema,
  type ErrorCode,
  type LoginRequest,
  type PublicUser,
  type RecoverRequest,
  type RecoveryCodeResponse,
  type SignupRequest,
} from '@heartpatch/shared';

/** Any shared zod schema; structural, so the client needs no direct zod import. */
interface Schema<T> {
  parse: (value: unknown) => T;
}

const OFFLINE_MESSAGE = "We can't reach the patch right now. Check your connection and try again!";

/** A failed call, with a message that's safe to show a player. */
export class ApiRequestError extends Error {
  readonly code: ErrorCode | 'OFFLINE';

  constructor(code: ErrorCode | 'OFFLINE', message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

/**
 * Calls `/api/v1` with the session cookie and the CSRF header (tech spec §5),
 * and validates the reply with the shared schema.
 */
export async function apiCall<T>(
  path: string,
  options: { method: 'GET' | 'POST'; body?: unknown; schema: Schema<T> | null },
  fetchImpl: typeof fetch = fetch,
): Promise<T | null> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/v1${path}`, {
      method: options.method,
      credentials: 'same-origin',
      headers: {
        'x-requested-with': 'heartpatch',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new ApiRequestError('OFFLINE', OFFLINE_MESSAGE);
  }
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(await res.json().catch(() => null));
    if (parsed.success)
      throw new ApiRequestError(parsed.data.error.code, parsed.data.error.message);
    throw new ApiRequestError('INTERNAL', DEFAULT_ERROR_MESSAGES.INTERNAL);
  }
  if (options.schema === null) return null;
  return options.schema.parse(await res.json());
}

async function required<T>(promise: Promise<T | null>): Promise<T> {
  const value = await promise;
  if (value === null) throw new ApiRequestError('INTERNAL', DEFAULT_ERROR_MESSAGES.INTERNAL);
  return value;
}

export const authApi = {
  me: async (): Promise<PublicUser | null> =>
    (await required(apiCall('/me', { method: 'GET', schema: MeResponseSchema }))).user,

  signup: (body: SignupRequest): Promise<RecoveryCodeResponse> =>
    required(apiCall('/auth/signup', { method: 'POST', body, schema: RecoveryCodeResponseSchema })),

  login: async (body: LoginRequest): Promise<PublicUser> =>
    (
      await required(
        apiCall('/auth/login', { method: 'POST', body, schema: SessionResponseSchema }),
      )
    ).user,

  recover: (body: RecoverRequest): Promise<RecoveryCodeResponse> =>
    required(
      apiCall('/auth/recover', { method: 'POST', body, schema: RecoveryCodeResponseSchema }),
    ),

  logout: async (): Promise<void> => {
    await apiCall('/auth/logout', { method: 'POST', schema: null });
  },
};
