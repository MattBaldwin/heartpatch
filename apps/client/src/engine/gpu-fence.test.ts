import { describe, expect, it } from 'vitest';
import {
  FencePoller,
  GPU_WINDOW,
  MAX_PENDING_FENCES,
  webglFenceOps,
  type FenceOps,
} from './gpu-fence.js';

/** Fences the test passes by hand, like a GPU finishing frames in order. */
function fakeGpu(): FenceOps<number> & {
  made: number;
  freed: number[];
  passUpTo(id: number): void;
} {
  let next = 0;
  let passedUpTo = -1;
  return {
    made: 0,
    freed: [],
    create() {
      this.made++;
      return next++;
    },
    passed: (fence) => fence <= passedUpTo,
    delete(fence) {
      this.freed.push(fence);
    },
    passUpTo(id) {
      passedUpTo = id;
    },
  };
}

describe('FencePoller', () => {
  it('reads nothing until a fence has passed', () => {
    const gpu = fakeGpu();
    const poller = new FencePoller(gpu);
    poller.frame(0);
    poller.frame(16);
    expect(poller.latency).toBeNull();
  });

  it('times a fence from the frame that queued it to the frame that saw it pass', () => {
    const gpu = fakeGpu();
    const poller = new FencePoller(gpu);
    poller.frame(0); // fence 0
    gpu.passUpTo(0);
    poller.frame(16); // sees 0 passed; queues 1
    expect(poller.latency).toEqual({ lastMs: 16, avgMs: 16, maxMs: 16, pending: 1, passed: 1 });
    expect(gpu.freed).toEqual([0]);
  });

  it('a GPU that falls behind reads several frames of latency', () => {
    const gpu = fakeGpu();
    const poller = new FencePoller(gpu);
    poller.frame(0); // 0
    poller.frame(100); // 1
    poller.frame(200); // 2
    gpu.passUpTo(0);
    poller.frame(300); // 0 passed after 300 ms; queues 3
    gpu.passUpTo(2);
    poller.frame(400); // 1 (300 ms) and 2 (200 ms) pass, in order
    expect(poller.latency).toMatchObject({ lastMs: 200, maxMs: 300, pending: 2, passed: 3 });
    expect(poller.latency?.avgMs).toBeCloseTo((300 + 300 + 200) / 3);
    expect(gpu.freed).toEqual([0, 1, 2]);
  });

  it('stops at the first pending fence, even if a later one reads passed', () => {
    const ops: FenceOps<number> = {
      create: (() => {
        let n = 0;
        return () => n++;
      })(),
      passed: (f) => f === 1,
      delete: () => {},
    };
    const poller = new FencePoller(ops);
    poller.frame(0);
    poller.frame(10);
    poller.frame(20);
    expect(poller.latency).toBeNull();
  });

  it('resolves between frames on poll, finer than a frame', () => {
    const gpu = fakeGpu();
    const poller = new FencePoller(gpu);
    poller.frame(0);
    poller.poll(20);
    expect(poller.pending).toBe(1);
    gpu.passUpTo(0);
    poller.poll(40); // a 1 fps frame, but the GPU was done in 40 ms
    expect(poller.latency).toMatchObject({ lastMs: 40, pending: 0 });
    poller.frame(1000);
    expect(poller.latency?.lastMs).toBe(40);
    expect(poller.pending).toBe(1);
  });

  it(`keeps at most ${String(MAX_PENDING_FENCES)} fences in flight`, () => {
    const gpu = fakeGpu();
    const poller = new FencePoller(gpu);
    for (let i = 0; i < 10; i++) poller.frame(i * 16);
    expect(gpu.made).toBe(MAX_PENDING_FENCES);
    gpu.passUpTo(0);
    poller.frame(200);
    expect(gpu.made).toBe(MAX_PENDING_FENCES + 1);
    expect(poller.latency?.pending).toBe(MAX_PENDING_FENCES);
  });

  it(`averages over the last ${String(GPU_WINDOW)} fences`, () => {
    const gpu = fakeGpu();
    const poller = new FencePoller(gpu);
    let now = 0;
    // A slow stretch, then a long fast one that pushes it out of the window.
    for (let i = 0; i < 5; i++) {
      poller.frame(now);
      gpu.passUpTo(i);
      now += 500;
    }
    for (let i = 5; i < 5 + GPU_WINDOW + 1; i++) {
      poller.frame(now);
      gpu.passUpTo(i);
      now += 10;
    }
    poller.frame(now);
    expect(poller.latency?.maxMs).toBe(10);
    expect(poller.latency?.avgMs).toBe(10);
    expect(poller.latency?.passed).toBe(5 + GPU_WINDOW + 1);
  });

  it('carries on without fences when the context makes none', () => {
    const poller = new FencePoller<number>({
      create: () => null,
      passed: () => true,
      delete: () => {},
    });
    poller.frame(0);
    poller.frame(16);
    expect(poller.latency).toBeNull();
  });

  it('frees every fence in flight on dispose', () => {
    const gpu = fakeGpu();
    const poller = new FencePoller(gpu);
    poller.frame(0);
    poller.frame(16);
    poller.dispose();
    expect(gpu.freed).toEqual([0, 1]);
  });
});

describe('webglFenceOps', () => {
  const sync = {} as WebGLSync;
  function gl(status: number) {
    const calls: unknown[][] = [];
    return {
      calls,
      SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
      ALREADY_SIGNALED: 0x911a,
      CONDITION_SATISFIED: 0x911c,
      fenceSync: (...args: unknown[]) => (calls.push(['fenceSync', ...args]), sync),
      clientWaitSync: (...args: unknown[]) => (calls.push(['clientWaitSync', ...args]), status),
      deleteSync: (...args: unknown[]) => void calls.push(['deleteSync', ...args]),
    };
  }

  it('queues a GPU-commands fence and polls it with a zero timeout, never waiting', () => {
    const fake = gl(0x911b); // TIMEOUT_EXPIRED
    const ops = webglFenceOps(fake);
    expect(ops.create()).toBe(sync);
    expect(ops.passed(sync)).toBe(false);
    ops.delete(sync);
    expect(fake.calls).toEqual([
      ['fenceSync', 0x9117, 0],
      ['clientWaitSync', sync, 0, 0],
      ['deleteSync', sync],
    ]);
  });

  it('reads already-signaled and condition-satisfied as passed', () => {
    expect(webglFenceOps(gl(0x911a)).passed(sync)).toBe(true);
    expect(webglFenceOps(gl(0x911c)).passed(sync)).toBe(true);
    expect(webglFenceOps(gl(0x911d)).passed(sync)).toBe(false); // WAIT_FAILED
  });
});
