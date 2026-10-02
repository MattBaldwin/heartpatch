import { HealthResponseSchema, type HealthResponse } from '@heartpatch/shared';

/** Fetches server liveness and validates it with the shared schema. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch('/api/v1/health', signal ? { signal } : {});
  if (!res.ok) throw new Error(`health check failed: ${res.status}`);
  return HealthResponseSchema.parse(await res.json());
}
