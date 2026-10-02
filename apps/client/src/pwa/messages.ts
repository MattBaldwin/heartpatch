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

export function isWorkerRequest(data: unknown): data is WorkerRequest {
  if (typeof data !== 'object' || data === null) return false;
  const { type, path } = data as { type?: unknown; path?: unknown };
  return type === 'skip-waiting' || (type === 'describe' && typeof path === 'string');
}
