import {
  ApiErrorSchema,
  DEFAULT_ERROR_MESSAGES,
  HealthResponseSchema,
  type ErrorCode,
  type HealthResponse,
} from '@heartpatch/shared';

// The REST client (tech spec §5): every `/api/v1` call goes through `apiCall`.

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
 * and validates the reply with the shared schema. `schema: null` is for
 * replies with no body (204).
 */
export async function apiCall<T>(
  path: string,
  options: {
    method: 'GET' | 'POST';
    body?: unknown;
    schema: Schema<T> | null;
    signal?: AbortSignal;
    /** Extra request headers, e.g. `Idempotency-Key` (tech spec §5) on a retried command. */
    headers?: Record<string, string>;
  },
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
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
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
  if (options.schema === null) {
    // Read the (empty) body out anyway: a reply left unread is cancelled when
    // its Response is collected, and Chromium logs that as net::ERR_ABORTED.
    await res.arrayBuffer();
    return null;
  }
  return options.schema.parse(await res.json());
}

/** `apiCall` for replies that always have a body. */
export async function apiCallFor<T>(
  path: string,
  options: {
    method: 'GET' | 'POST';
    body?: unknown;
    schema: Schema<T>;
    signal?: AbortSignal;
    headers?: Record<string, string>;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const value = await apiCall(path, options, fetchImpl);
  if (value === null) throw new ApiRequestError('INTERNAL', DEFAULT_ERROR_MESSAGES.INTERNAL);
  return value;
}

/** Fetches server liveness and validates it with the shared schema. */
export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiCallFor('/health', {
    method: 'GET',
    schema: HealthResponseSchema,
    ...(signal ? { signal } : {}),
  });
}
