import { GAME_EVENTS, type TutorialState, type WsEventMessage } from '@heartpatch/shared';
import { ApiRequestError } from '../net/api.js';
import type { WsClient, WsClientOptions } from '../net/ws-client.js';
import { messageOf } from '../ui/dom.js';
import type { TutorialApi } from './tutorial-api.js';
import { stepView, type StepView } from './step-view.js';

// The tutorial's state on the client (tech spec §7 "Tutorial step engine").
// The server owns progress: this only shows the step the server says, tells
// it when a talk-only step was read, and follows `tutorial.advanced` over
// live sync. No DOM or Babylon here, so the flow is unit-tested.

/** No `tutorial.advanced` this long after a tap: ask the server where we are. */
export const ADVANCE_CHECK_MS = 3_000; // TUNE: guess
export const ADVANCE_CHECK_MAX_MS = 15_000; // TUNE: guess
/** Checks without an answer before Sprout offers to try again. */
export const ADVANCE_CHECKS_BEFORE_RETRY = 4; // TUNE: guess

/** Shown when the server never moved on (its step engine may be busy). */
export const STUCK_MESSAGE = 'Hmm, Sprout got a little lost. Try again!';

/**
 * - `closed`: not on screen.
 * - `loading`: starting, resuming or replaying a run.
 * - `step`: showing the current step.
 * - `waiting`: a talk-only step was read; waiting for the server to move on.
 * - `error`: something failed; `message` says what, and the player can retry.
 */
export type TutorialPhase = 'closed' | 'loading' | 'step' | 'waiting' | 'error';

/** What the player picked at graduation (design doc §26 step 13). */
export type GraduationChoice = 'create' | 'join';

export interface TutorialView {
  readonly phase: TutorialPhase;
  readonly state: TutorialState | null;
  readonly step: StepView | null;
  /** Which of the step's bubbles is showing. */
  readonly line: number;
  readonly message: string | null;
  /** Skipping is allowed once the tutorial was finished once (design doc §26). */
  readonly canSkip: boolean;
  /**
   * The player may put the tutorial away for now. Always, unless the server
   * requires it before multiplayer (`HP_TUTORIAL_REQUIRED`, decision A).
   */
  readonly canLeave: boolean;
}

export interface TutorialControllerOptions {
  api: Pick<TutorialApi, 'state' | 'start' | 'replay' | 'skip' | 'acknowledge'>;
  /** The live socket for the run's map (made when a run opens). */
  createWs: (options: WsClientOptions) => Pick<WsClient, 'subscribe' | 'close' | 'status'>;
  onChange: (view: TutorialView) => void;
  /** The run ended: finished (with the graduation choice, if any) or skipped. */
  onDone: (choice: GraduationChoice | null) => void;
  setTimer?: (task: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface TutorialControllerDebug {
  readonly phase: TutorialPhase;
  readonly status: TutorialState['status'] | null;
  readonly stepId: string | null;
  readonly line: number;
  readonly mapId: string | null;
  readonly following: string | null;
}

const AdvancedSchema = GAME_EVENTS['tutorial.advanced'].public;

export class TutorialController {
  private phase: TutorialPhase = 'closed';
  private state: TutorialState | null = null;
  private line = 0;
  private message: string | null = null;
  /** Retried by `retry()` after an error. */
  private retryAction: (() => void) | null = null;
  private choice: GraduationChoice | null = null;
  /** Bumped on every open and close, so a slow answer can't reopen a closed run. */
  private generation = 0;
  private ws: Pick<WsClient, 'subscribe' | 'close' | 'status'> | null = null;
  private followedMapId: string | null = null;
  private checkTimer: unknown = undefined;
  private checks = 0;
  private readonly options: TutorialControllerOptions;
  private readonly setTimer: (task: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(options: TutorialControllerOptions) {
    this.options = options;
    this.setTimer = options.setTimer ?? ((task, ms) => setTimeout(task, ms));
    this.clearTimer =
      options.clearTimer ??
      ((handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      });
  }

  get view(): TutorialView {
    const state = this.state;
    const running = this.phase !== 'closed' && state?.status === 'in-progress';
    return {
      phase: this.phase,
      state,
      step: running && state.stepId ? stepView(state.stepId) : null,
      line: this.line,
      message: this.message,
      canSkip: running && state.completedAt !== null,
      canLeave: state === null || !state.required || state.completedAt !== null,
    };
  }

  get debug(): TutorialControllerDebug {
    return {
      phase: this.phase,
      status: this.state?.status ?? null,
      stepId: this.state?.stepId ?? null,
      line: this.line,
      mapId: this.state?.mapId ?? null,
      following: this.followedMapId,
    };
  }

  /** The last state the server reported, or null before the first check. */
  get known(): TutorialState | null {
    return this.state;
  }

  get isOpen(): boolean {
    return this.phase !== 'closed';
  }

  /** Asks the server where the player is (after login, and on return to the app). */
  async check(): Promise<TutorialState> {
    const at = this.generation;
    const state = await this.options.api.state();
    if (at === this.generation) this.adopt(state);
    return state;
  }

  /** Resumes the run going, or starts the first one. */
  open(): Promise<void> {
    return this.load(async () => {
      const current = await this.options.api.state();
      return current.status === 'in-progress' ? current : this.options.api.start();
    });
  }

  /** A fresh run from the first step (Settings, design doc §26). */
  replay(): Promise<void> {
    return this.load(() => this.options.api.replay());
  }

  /** Puts the tutorial away; the server keeps the player's place. */
  close(): void {
    this.generation += 1;
    this.stopWaiting();
    this.unfollow();
    this.phase = 'closed';
    this.message = null;
    this.retryAction = null;
    this.emit();
  }

  /** Taps through Sprout's bubbles. */
  nextLine(): void {
    const step = this.view.step;
    if (this.phase !== 'step' || !step || this.line >= step.lines.length - 1) return;
    this.line += 1;
    this.emit();
  }

  /** The player read a talk-only step ("Got it!", or a graduation choice). */
  acknowledge(choice: GraduationChoice | null = null): void {
    const state = this.state;
    const step = this.view.step;
    if (this.phase !== 'step' || !state?.stepId || !step?.talkOnly) return;
    // Sprout finishes talking first.
    if (this.line < step.lines.length - 1) return;
    const stepId = state.stepId;
    const at = this.generation;
    this.choice = choice;
    this.phase = 'waiting';
    this.checks = 0;
    this.emit();
    this.armCheck(ADVANCE_CHECK_MS);
    this.options.api.acknowledge(stepId).catch((err: unknown) => {
      if (at !== this.generation || this.state?.stepId !== stepId) return;
      // CONFLICT: the server already moved on (a double tap, another device).
      if (err instanceof ApiRequestError && err.code === 'CONFLICT') {
        void this.recheck(at);
        return;
      }
      this.fail(messageOf(err), () => {
        this.phase = 'step';
        this.acknowledge(choice);
      });
    });
  }

  /** Ends the run (only offered once the tutorial was finished before). */
  skip(): void {
    if (!this.view.canSkip) return;
    const at = this.generation;
    this.phase = 'loading';
    this.stopWaiting();
    this.emit();
    this.options.api.skip().then(
      (state) => {
        // Not in progress anymore, so this finishes the run.
        if (at === this.generation) this.adopt(state);
      },
      (err: unknown) => {
        if (at !== this.generation) return;
        this.fail(messageOf(err), () => {
          this.phase = 'step';
          this.skip();
        });
      },
    );
  }

  /** Asks the server where the player is now (Sprout's "Check again"). */
  recheckNow(): void {
    if (this.phase === 'closed') return;
    void this.recheck(this.generation);
  }

  /** Tries the failed action again. */
  retry(): void {
    const action = this.retryAction;
    if (this.phase !== 'error' || !action) return;
    this.retryAction = null;
    this.message = null;
    action();
  }

  /** ws-client `onEvent`: one event on the followed map, in seq order. */
  event(event: WsEventMessage): void {
    const state = this.state;
    if (event.type !== 'tutorial.advanced' || !state || event.mapId !== state.mapId) return;
    const parsed = AdvancedSchema.safeParse(event.data);
    // Only an advance from the step on screen counts: following from the start
    // of the run replays the earlier ones first.
    if (!parsed.success || parsed.data.completedStepId !== state.stepId) return;
    if (parsed.data.stepId === null) {
      void this.recheck(this.generation);
      return;
    }
    this.adopt({ ...state, stepId: parsed.data.stepId });
  }

  private async load(fetch: () => Promise<TutorialState>): Promise<void> {
    const at = ++this.generation;
    this.stopWaiting();
    this.phase = 'loading';
    this.message = null;
    this.emit();
    try {
      const state = await fetch();
      if (at !== this.generation) return;
      this.phase = 'step';
      this.adopt(state, true);
    } catch (err) {
      if (at !== this.generation) return;
      this.fail(messageOf(err), () => void this.load(fetch));
    }
  }

  /** Takes in the server's word on where the player is. */
  private adopt(state: TutorialState, fresh = false): void {
    const before = this.state;
    this.state = state;
    if (this.phase === 'closed') {
      this.emit();
      return;
    }
    if (state.status !== 'in-progress' || !state.mapId || !state.stepId) {
      // Finished (or ended elsewhere) while open.
      this.finish(this.choice);
      return;
    }
    if (fresh || before?.stepId !== state.stepId || before.mapId !== state.mapId) {
      this.line = 0;
      this.stopWaiting();
      if (this.phase === 'waiting') this.phase = 'step';
    }
    this.follow(state.mapId);
    this.emit();
  }

  private finish(choice: GraduationChoice | null): void {
    this.close();
    this.choice = null;
    this.options.onDone(choice);
  }

  /** Asks the server where the player is, after a missed or uncertain advance. */
  private async recheck(at: number): Promise<void> {
    try {
      const state = await this.options.api.state();
      if (at === this.generation) this.adopt(state);
    } catch {
      // Offline: the next check (or the player's retry) tries again.
    }
  }

  private armCheck(ms: number): void {
    this.clearTimer(this.checkTimer);
    const at = this.generation;
    this.checkTimer = this.setTimer(() => {
      if (at !== this.generation || this.phase !== 'waiting') return;
      this.checks += 1;
      const stepId = this.state?.stepId;
      void this.recheck(at).then(() => {
        if (at !== this.generation || this.phase !== 'waiting' || this.state?.stepId !== stepId) {
          return;
        }
        if (this.checks >= ADVANCE_CHECKS_BEFORE_RETRY) {
          const choice = this.choice;
          this.fail(STUCK_MESSAGE, () => {
            this.phase = 'step';
            this.acknowledge(choice);
          });
          return;
        }
        this.armCheck(Math.min(ms * 2, ADVANCE_CHECK_MAX_MS));
      });
    }, ms);
  }

  private stopWaiting(): void {
    this.clearTimer(this.checkTimer);
    this.checkTimer = undefined;
    this.checks = 0;
  }

  private fail(message: string, retry: () => void): void {
    this.stopWaiting();
    this.phase = 'error';
    this.message = message;
    this.retryAction = retry;
    this.emit();
  }

  /** Follows the run's map live (from its start: the run is short). */
  private follow(mapId: string): void {
    if (this.followedMapId === mapId) return;
    this.ws ??= this.options.createWs({
      onEvent: (event) => {
        this.event(event);
      },
      // Too much missed to replay, or the server stopped us following:
      // ask where we are instead (checks keep running while waiting).
      onResync: () => void this.recheck(this.generation),
      onError: (error) => {
        if (error.mapId === this.followedMapId) void this.recheck(this.generation);
      },
    });
    this.followedMapId = mapId;
    this.ws.subscribe(mapId, 0);
  }

  private unfollow(): void {
    this.ws?.close();
    this.ws = null;
    this.followedMapId = null;
  }

  private emit(): void {
    this.options.onChange(this.view);
  }
}
