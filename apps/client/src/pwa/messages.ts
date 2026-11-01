// Messages between the page (register.ts) and the service worker (sw.ts).

export type WorkerRequest =
  /** Become the active worker now. */
  | { type: 'skip-waiting' }
  /** Report the shell version, and whether `path` is in this worker's shell. */
  | { type: 'describe'; path: string };

export interface WorkerDescription {
  version: string;
  cache: string;
  /** Whether the asked-about path is precached by this worker. */
  hasPath: boolean;
}

export function isWorkerDescription(data: unknown): data is WorkerDescription {
  if (typeof data !== 'object' || data === null) return false;
  const { version, cache, hasPath } = data as Record<string, unknown>;
  return typeof version === 'string' && typeof cache === 'string' && typeof hasPath === 'boolean';
}

export function isWorkerRequest(data: unknown): data is WorkerRequest {
  if (typeof data !== 'object' || data === null) return false;
  const { type, path } = data as { type?: unknown; path?: unknown };
  return type === 'skip-waiting' || (type === 'describe' && typeof path === 'string');
}

/**
 * Worker → page (#726): a nudge was tapped while the app was open, so the
 * page should open this patch (`null`: just come to the front).
 */
export interface PageMessage {
  type: 'open-map';
  mapId: string | null;
}

export function isPageMessage(data: unknown): data is PageMessage {
  if (typeof data !== 'object' || data === null) return false;
  const { type, mapId } = data as { type?: unknown; mapId?: unknown };
  return type === 'open-map' && (mapId === null || typeof mapId === 'string');
}
