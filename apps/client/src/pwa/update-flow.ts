import type { WorkerDescription, WorkerRequest } from './messages.js';
import type { UpdateHold } from './update-hold.js';

// How a new version reaches a running app (issue #26). A new service worker
// installs in the background, then waits; this decides when it takes over.
// Pure orchestration over `UpdateEnv`, so Vitest can drive it with fakes.

/** The parts of a ServiceWorker this uses. */
export interface WorkerLike extends EventTarget {
  readonly state: ServiceWorkerState;
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
}

export interface RegistrationLike extends EventTarget {
  readonly installing: WorkerLike | null;
  readonly waiting: WorkerLike | null;
  update(): Promise<unknown>;
}

export interface UpdateEnv {
  /** The worker controlling this page, if any (none on a first visit). */
  controller(): WorkerLike | null;
  /** Fires when the controlling worker changes. */
  onControllerChange(listener: () => void): void;
  register(): Promise<RegistrationLike>;
  /** Asks a worker for its version; null if it doesn't answer. */
  describe(worker: WorkerLike, path: string): Promise<WorkerDescription | null>;
  /** This page's own entry bundle, e.g. `/assets/index-abc123.js`. */
  runningPath: string;
  reload(): void;
  now(): number;
  every(ms: number, task: () => void): void;
  onVisibilityChange(listener: (visible: boolean) => void): void;
  /** A new version is ready; `apply` switches to it and reloads. */
  onUpdateReady(apply: () => void): void;
  /** No reload while this is held (e.g. a recovery code on screen; update-hold.ts). */
  hold: Pick<UpdateHold, 'held' | 'whenReleased'>;
}

export interface UpdateTiming {
  /** How often a long-running app checks for a new version. */
  checkIntervalMs: number;
  /** Coming back to the app checks again, but not more often than this. */
  checkMinGapMs: number;
  /** Away at least this long, a waiting version is applied on return without asking. */
  applyAfterHiddenMs: number;
}

export async function startUpdates(env: UpdateEnv, timing: UpdateTiming): Promise<void> {
  let reloadOnSwitch = false;
  env.onControllerChange(() => {
    // The first install also changes the controller (clients.claim), with
    // nothing to reload for; only reload when we switched versions on purpose.
    if (!reloadOnSwitch) return;
    reloadOnSwitch = false;
    env.reload();
  });

  /**
   * Activates `worker`; reloads unless the page already runs its version.
   * A reload waits until nothing holds updates, so a screen that can't be
   * shown again (a new recovery code) is never reloaded away.
   */
  const activate = (worker: WorkerLike, reload: boolean) => {
    if (!reload) {
      reloadOnSwitch = false;
      worker.postMessage({ type: 'skip-waiting' });
      return;
    }
    env.hold.whenReleased(() => {
      reloadOnSwitch = true;
      worker.postMessage({ type: 'skip-waiting' });
    });
  };

  let waiting: WorkerLike | null = null;
  const seen = new WeakSet<WorkerLike>();
  const offer = async (worker: WorkerLike, atLaunch: boolean) => {
    // No controller means a first install: there's no old version to replace.
    if (!env.controller() || seen.has(worker)) return;
    seen.add(worker);
    const description = await env.describe(worker, env.runningPath);
    if (description?.hasPath) {
      // Page loads are network-first, so after a relaunch the page often
      // already runs the new version under the old worker. Just catch up.
      activate(worker, false);
    } else if (atLaunch) {
      // It finished installing while the app was closed, and the page has
      // only just loaded: switch now rather than ask.
      activate(worker, true);
    } else {
      waiting = worker;
      env.onUpdateReady(() => {
        activate(worker, true);
      });
    }
  };
  const track = (worker: WorkerLike) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') void offer(worker, false);
    });
  };

  const registration = await env.register();
  if (registration.waiting) await offer(registration.waiting, true);
  if (registration.installing) track(registration.installing);
  registration.addEventListener('updatefound', () => {
    if (registration.installing) track(registration.installing);
  });

  let lastCheck = env.now();
  const check = () => {
    lastCheck = env.now();
    // Offline: try again on the next check.
    registration.update().catch(() => undefined);
  };
  env.every(timing.checkIntervalMs, check);

  let hiddenAt: number | null = null;
  env.onVisibilityChange((visible) => {
    if (!visible) {
      hiddenAt = env.now();
      return;
    }
    const awayMs = hiddenAt === null ? 0 : env.now() - hiddenAt;
    hiddenAt = null;
    // An installed app can stay in memory for days, so the old version must
    // not run against a new server forever: apply a waiting version when the
    // player comes back after a real break, when there's nothing to lose.
    if (waiting && awayMs >= timing.applyAfterHiddenMs) {
      // Held (a recovery code on screen): it applies once that's put away.
      activate(waiting, true);
      waiting = null;
      return;
    }
    if (env.now() - lastCheck >= timing.checkMinGapMs) check();
  });
}
