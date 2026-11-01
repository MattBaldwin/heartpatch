import type { TutorialState } from '@heartpatch/shared';
import { PUSH_OFFERED_KEY } from './config.js';
import type { PushClient, PushDevice, SubscribeOutcome } from './push-client.js';

// The nudge offer (#726 plan, "Client UI flow"; owner answer 5): one card,
// the first time a patch is on screen after graduation, in a Home Screen app
// only, through the one-card-at-a-time queue (#129). Shown once: "Not now"
// and every answer to "Yes please" set `heartpatch.pushOffered` for good, so
// the app never asks twice (Settings › Nudges is the way back). Without the
// DOM, so the conditions and the tap order are unit-tested; the card itself
// is `push-offer-card.ts`.

export const PUSH_OFFER_TEXT = {
  title: 'Want a nudge when night falls? 🔥',
  line: "We'll tap your shoulder when your land gets dark, your gatherers are done, or a friend drops by.",
  yes: 'Yes please',
  no: 'Not now',
  on: 'Nudges on! 🔔',
} as const;

/** The parts of `pushClient` the offer and Settings use (tests pass fakes). */
export type PushUiClient = Pick<
  PushClient,
  'supported' | 'permission' | 'status' | 'device' | 'saveSettings'
>;

/** Graduated (owner answer 5): no tutorial run going, and finished or never needed. */
export function graduated(state: Pick<TutorialState, 'status' | 'completedAt' | 'required'>) {
  return state.status !== 'in-progress' && (state.completedAt !== null || !state.required);
}

/**
 * `device.subscribe(key)`, called synchronously (the tap rule: put no
 * `await` before this in a click handler). WebKit may refuse `subscribe`
 * while its permission prompt is still up, which ends `failed` after Allow
 * (726e1 gotcha): then permission is `granted`, so one more try needs no
 * gesture.
 */
export function subscribeOnTap(
  device: PushDevice,
  key: string,
  permission: () => NotificationPermission | 'unsupported',
): Promise<SubscribeOutcome> {
  return device
    .subscribe(key)
    .then((outcome) =>
      outcome === 'failed' && permission() === 'granted' ? device.subscribe(key) : outcome,
    );
}

/** `localStorage` behind try/catch: blocked storage reads as "never asked". */
export interface OfferedStore {
  read: () => boolean;
  write: () => void;
}

export function offeredStore(storage: () => Pick<Storage, 'getItem' | 'setItem'> | null) {
  return {
    read: () => {
      try {
        return storage()?.getItem(PUSH_OFFERED_KEY) != null;
      } catch {
        return false;
      }
    },
    write: () => {
      try {
        storage()?.setItem(PUSH_OFFERED_KEY, '1');
      } catch {
        // Blocked: this launch still remembers (`createPushOffer`).
      }
    },
  } satisfies OfferedStore;
}

/** The card, ready to show: its buttons' handlers (they run inside the tap). */
export interface ReadyOffer {
  /** "Yes please". Subscribes synchronously (tap rule); resolves the outcome. */
  yes: () => Promise<SubscribeOutcome>;
  /** "Not now". */
  no: () => void;
}

export interface PushOfferDeps {
  client: PushUiClient;
  offered: OfferedStore;
  /** The tutorial's state, or null when it can't be read (no offer then). */
  tutorial: () => Promise<Pick<TutorialState, 'status' | 'completedAt' | 'required'> | null>;
  /** The patch on screen (not the Glade), or null. */
  patch: () => string | null;
  /** Another card or screen owns the map: wait. */
  busy: () => boolean;
  /** Puts the card up. The offer calls this at most once per launch. */
  show: (offer: ReadyOffer) => void;
  /** The card goes away (any answer). */
  hide: () => void;
  /** "Nudges on! 🔔" on the patch line. */
  toast: (text: string) => void;
  setTimer: (task: () => void, ms: number) => unknown;
  retryMs: number;
}

export interface PushOffer {
  /** A patch came on screen: offer if every condition holds. */
  maybeOffer: () => void;
  /** Settings turned nudges on or off: never offer again. */
  settle: () => void;
  /** Signed out: an open card closes, unanswered, and a wait stops. */
  cancel: () => void;
  readonly debug: { readonly state: 'idle' | 'checking' | 'waiting' | 'showing' | 'done' };
}

export function createPushOffer(deps: PushOfferDeps): PushOffer {
  let state: PushOffer['debug']['state'] = 'idle';
  /** Blocked storage still asks at most once per launch. */
  let askedThisLaunch = false;
  /** Bumped by `cancel()`: a check or wait from before a sign-out stops. */
  let run = 0;

  const finish = () => {
    state = 'done';
    askedThisLaunch = true;
    deps.offered.write();
  };

  /** The cheap, synchronous conditions, checked again before the card goes up. */
  const stillWanted = (): boolean =>
    !askedThisLaunch &&
    !deps.offered.read() &&
    deps.patch() !== null &&
    deps.client.supported() &&
    deps.client.permission() === 'default';

  function showWhenFree(device: PushDevice, key: string, mine: number): void {
    if (state !== 'waiting' || mine !== run) return;
    if (!stillWanted()) {
      // Asked already, or the patch went away (a later one may ask).
      state = askedThisLaunch || deps.offered.read() ? 'done' : 'idle';
      return;
    }
    if (deps.busy()) {
      deps.setTimer(() => {
        showWhenFree(device, key, mine);
      }, deps.retryMs);
      return;
    }
    state = 'showing';
    askedThisLaunch = true;
    deps.show({
      yes: () => {
        // The tap rule: subscribe before anything else in the handler.
        const outcome = subscribeOnTap(device, key, deps.client.permission);
        finish();
        deps.hide();
        return outcome.then((result) => {
          if (result === 'on') deps.toast(PUSH_OFFER_TEXT.on);
          return result;
        });
      },
      no: () => {
        finish();
        deps.hide();
      },
    });
  }

  return {
    maybeOffer: () => {
      if (state !== 'idle') return;
      if (askedThisLaunch || deps.offered.read()) {
        state = 'done'; // asked on this device already: never again
        return;
      }
      if (!stillWanted()) return;
      state = 'checking';
      const mine = run;
      void (async () => {
        const tutorial = await deps.tutorial().catch(() => null);
        if (mine !== run) return;
        if (!tutorial || !graduated(tutorial)) {
          state = 'idle';
          return;
        }
        // Both before the card shows: the tap handler may not await (tap rule).
        const status = await deps.client.status();
        if (mine !== run) return;
        if (status.state !== 'available') {
          // Off for this player: never. Unreachable: a later patch tries again.
          state = status.state === 'off' ? 'done' : 'idle';
          return;
        }
        const device = await deps.client.device();
        if (mine !== run) return;
        if (!device) {
          state = 'idle';
          return;
        }
        state = 'waiting';
        showWhenFree(device, status.vapidPublicKey, mine);
      })();
    },
    settle: () => {
      if (state === 'showing') deps.hide();
      finish();
    },
    cancel: () => {
      run++;
      if (state === 'showing') deps.hide();
      // Unanswered, so not marked offered; once per launch still holds.
      if (state !== 'done') state = 'idle';
    },
    get debug() {
      return { state };
    },
  };
}
