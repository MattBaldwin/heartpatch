import { describe, expect, it } from 'vitest';
import type { WorkerDescription, WorkerRequest } from './messages.js';
import { startUpdates, type UpdateEnv, type WorkerLike } from './update-flow.js';

class FakeWorker extends EventTarget implements WorkerLike {
  state: ServiceWorkerState = 'installing';
  messages: WorkerRequest[] = [];
  readonly shell: readonly string[];
  constructor(shell: readonly string[] = []) {
    super();
    this.shell = shell;
  }
  postMessage(message: WorkerRequest): void {
    this.messages.push(message);
  }
  install(): void {
    this.state = 'installed';
    this.dispatchEvent(new Event('statechange'));
  }
  get skipped(): boolean {
    return this.messages.some((m) => m.type === 'skip-waiting');
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  updates = 0;
  update(): Promise<void> {
    this.updates++;
    return Promise.resolve();
  }
  /** A new version starts installing. */
  found(worker: FakeWorker): void {
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
  }
}

const RUNNING = '/assets/index-old.js';
const timing = { checkIntervalMs: 1000, checkMinGapMs: 100, applyAfterHiddenMs: 5000 };

function setup({ controlled = true, waiting = null as FakeWorker | null } = {}) {
  const registration = new FakeRegistration();
  registration.waiting = waiting;
  let time = 0;
  const controllerListeners: (() => void)[] = [];
  const visibilityListeners: ((visible: boolean) => void)[] = [];
  const offers: (() => void)[] = [];
  let reloads = 0;
  const env: UpdateEnv = {
    controller: () => (controlled ? new FakeWorker() : null),
    onControllerChange: (listener) => controllerListeners.push(listener),
    register: () => Promise.resolve(registration),
    describe: (worker, path) =>
      Promise.resolve<WorkerDescription>({
        version: 'v',
        cache: 'c',
        hasPath: (worker as FakeWorker).shell.includes(path),
      }),
    runningPath: RUNNING,
    reload: () => {
      reloads++;
    },
    now: () => time,
    every: () => undefined,
    onVisibilityChange: (listener) => visibilityListeners.push(listener),
    onUpdateReady: (apply) => offers.push(apply),
  };
  return {
    registration,
    offers,
    start: () => startUpdates(env, timing),
    reloads: () => reloads,
    /** The browser switches controller after skip-waiting. */
    switchController: () => {
      for (const listener of controllerListeners) listener();
    },
    away: (ms: number) => {
      for (const listener of visibilityListeners) listener(false);
      time += ms;
      for (const listener of visibilityListeners) listener(true);
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('startUpdates', () => {
  it('a first install offers nothing and never reloads', async () => {
    const t = setup({ controlled: false });
    await t.start();
    const worker = new FakeWorker();
    t.registration.found(worker);
    worker.install();
    await settle();
    t.switchController(); // clients.claim()
    expect(t.offers).toHaveLength(0);
    expect(worker.skipped).toBe(false);
    expect(t.reloads()).toBe(0);
  });

  it('offers a new version once, and reloads only after the player applies it', async () => {
    const t = setup();
    await t.start();
    const worker = new FakeWorker(['/assets/index-new.js']);
    t.registration.found(worker);
    worker.install();
    worker.install(); // repeated events don't offer twice
    await settle();
    expect(t.offers).toHaveLength(1);
    expect(worker.skipped).toBe(false);

    t.offers[0]!();
    expect(worker.skipped).toBe(true);
    t.switchController();
    expect(t.reloads()).toBe(1);
  });

  it('switches at launch to a version that installed while the app was closed', async () => {
    const waiting = new FakeWorker(['/assets/index-new.js']);
    waiting.state = 'installed';
    const t = setup({ waiting });
    await t.start();
    expect(waiting.skipped).toBe(true);
    expect(t.offers).toHaveLength(0);
    t.switchController();
    expect(t.reloads()).toBe(1);
  });

  it("doesn't ask about a version the page is already running", async () => {
    const t = setup();
    await t.start();
    const worker = new FakeWorker([RUNNING]);
    t.registration.found(worker);
    worker.install();
    await settle();
    expect(t.offers).toHaveLength(0);
    expect(worker.skipped).toBe(true);
    t.switchController();
    expect(t.reloads()).toBe(0);
  });

  it('applies an ignored update after the player has been away a while', async () => {
    const t = setup();
    await t.start();
    const worker = new FakeWorker(['/assets/index-new.js']);
    t.registration.found(worker);
    worker.install();
    await settle();

    t.away(1000); // a quick look at another app: keep asking
    expect(worker.skipped).toBe(false);
    t.away(5000);
    expect(worker.skipped).toBe(true);
    t.switchController();
    expect(t.reloads()).toBe(1);
  });

  it('checks for updates when the player comes back', async () => {
    const t = setup();
    await t.start();
    t.away(50); // too soon since the last check
    expect(t.registration.updates).toBe(0);
    t.away(200);
    expect(t.registration.updates).toBe(1);
  });
});
