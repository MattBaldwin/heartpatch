import type { PublicUser, TutorialState } from '@heartpatch/shared';
import type { Scene } from '@babylonjs/core/scene';
import type { GroundPoint } from '../engine/camera/camera-math.js';
import { createWsClient, type WsClient, type WsClientOptions } from '../net/ws-client.js';
import { SproutActor } from '../procedural/sprout/sprout-actor.js';
import { sproutHash } from '../procedural/sprout/sprout-params.js';
import { el } from '../ui/dom.js';
import { createHighlightTargets, type HighlightTargets } from './highlight-targets.js';
import { tutorialApi, type TutorialApi } from './tutorial-api.js';
import {
  TutorialController,
  type GraduationChoice,
  type TutorialControllerDebug,
  type TutorialView,
} from './tutorial-controller.js';
import { mountTutorialOverlay, type TutorialOverlayDebug } from './tutorial-overlay.js';

// The single-player tutorial on the client (design doc §26, tech spec §6–7):
// decides when it shows, puts Sprout in the scene, and offers start, resume
// and replay from the lobby and Settings. The server owns progress; this
// follows it.

export interface TutorialScreenOptions {
  root: HTMLElement;
  /** The run ended: finished (with the graduation choice) or skipped. */
  onDone: (choice: GraduationChoice | null) => void;
  /** The lobby's tutorial button or Settings row may have changed. */
  onEntryChange: () => void;
  /**
   * Draws the run's Tutorial Glade as a normal map (the map screen) while
   * the tutorial is open. `open` rejects if it can't; the tutorial carries
   * on over whatever is on screen.
   */
  glade?: {
    /** `stillWanted` turns false if the tutorial closed while the Glade loaded. */
    open: (mapId: string, stillWanted: () => boolean) => Promise<void>;
    close: () => void;
  };
  /**
   * Opens the Wardrobe over the Glade for the wardrobe step (design doc §26
   * step 12); the tutorial carries on when it closes.
   */
  openWardrobe?: () => void;
  /** The step on screen changed (to null when the run closed). */
  onStep?: (stepId: string | null) => void;
  api?: Pick<
    TutorialApi,
    'state' | 'start' | 'replay' | 'skip' | 'acknowledge' | 'nightfall' | 'name'
  >;
  createWs?: (options: WsClientOptions) => WsClient;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface TutorialDebug extends TutorialControllerDebug {
  readonly overlay: TutorialOverlayDebug;
  /** Sprout's look fingerprint while it's in the scene, else null. */
  readonly sprout: string | null;
}

export interface TutorialScreen {
  setUser: (user: PublicUser | null) => void;
  /** A scene was mounted: Sprout joins it while the tutorial is open. */
  attachScene: (scene: Scene, spot: GroundPoint, invalidate: () => void) => void;
  /** The lobby's button under the patch list ("Meet Sprout"), if any. */
  listActions: () => Node[];
  /** The Settings rows (replay, design doc §26). */
  settings: () => Node[];
  /** Canvas targets register here (highlight-targets.ts). */
  readonly targets: HighlightTargets;
  /** A target moved on screen: move the spotlight with it. */
  relayout: () => void;
  readonly debug: TutorialDebug | null;
}

/**
 * Opens on its own only when the player has a run going (resume after
 * quitting, design doc §26), or must finish it before multiplayer
 * (`HP_TUTORIAL_REQUIRED`, decision A). With the gate off a new player gets
 * a friendly button in the lobby instead, and the lobby is never blocked.
 */
export function opensByItself(state: TutorialState): boolean {
  return state.status === 'in-progress' || (state.required && state.status === 'not-started');
}

export function createTutorialScreen(options: TutorialScreenOptions): TutorialScreen {
  const api = options.api ?? tutorialApi;
  const createWs = options.createWs ?? createWsClient;
  const targets = createHighlightTargets();

  let user: PublicUser | null = null;
  let controller: TutorialController | null = null;
  let scene: { scene: Scene; spot: GroundPoint; invalidate: () => void } | null = null;
  let sprout: SproutActor | null = null;
  /** The step and line Sprout last hopped for. */
  let saying = '';
  /** The Glade on screen (its map id), if any. */
  let glade: string | null = null;

  /** The Glade is on screen exactly while a run is open. */
  const syncGlade = (view: TutorialView) => {
    const want =
      view.phase !== 'closed' && view.state?.status === 'in-progress' ? view.state.mapId : null;
    if (want === glade || (want === null && view.phase !== 'closed')) return;
    if (glade !== null && want === null) {
      glade = null;
      options.glade?.close();
      return;
    }
    glade = want;
    if (want) options.glade?.open(want, () => glade === want).catch(() => undefined);
  };

  const overlay = mountTutorialOverlay(options.root, targets, {
    nextLine: () => controller?.nextLine(),
    acknowledge: (choice) => controller?.acknowledge(choice),
    retry: () => controller?.retry(),
    recheck: () => controller?.recheckNow(),
    skip: () => controller?.skip(),
    leave: () => {
      controller?.close();
      options.onEntryChange();
    },
    nudge: () => sprout?.hop(),
    name: (nickname) => controller?.name(nickname),
    nightfall: () => controller?.nightfall(),
    wardrobe: () => {
      controller?.tuck();
      options.openWardrobe?.();
    },
    tuck: () => controller?.tuck(),
    untuck: () => controller?.untuck(),
  });
  /** The step last reported to `onStep`. */
  let reported: string | null = null;

  /** Sprout is in the scene exactly while the tutorial is open. */
  const syncSprout = (open: boolean) => {
    if (open && !sprout && scene && user) {
      sprout = new SproutActor(scene.scene, user.id, scene.spot);
      scene.invalidate();
    } else if (!open && sprout) {
      sprout.dispose();
      sprout = null;
      scene?.invalidate();
    }
  };

  const render = (view: TutorialView) => {
    overlay.render(view);
    const stepId = view.phase === 'closed' ? null : (view.state?.stepId ?? null);
    if (stepId !== reported) {
      reported = stepId;
      options.onStep?.(stepId);
    }
    syncGlade(view);
    syncSprout(view.phase !== 'closed');
    const now = view.step && view.phase === 'step' ? `${view.step.id}:${String(view.line)}` : '';
    if (now && now !== saying) sprout?.hop();
    saying = now;
  };

  const newController = () =>
    new TutorialController({
      api,
      createWs,
      onChange: render,
      onDone: (choice) => {
        // A graduation choice opens a lobby form; refreshing the list (an
        // async fetch) could land after it and cover it. The list redraws
        // with the new state when the player goes back to it.
        if (choice === null) options.onEntryChange();
        options.onDone(choice);
      },
    });

  const entryButton = (label: string, testId: string, action: () => Promise<void>) => {
    const node = el(
      'button',
      { type: 'button', class: 'auth-button auth-button-soft', 'data-testid': testId },
      label,
    );
    node.addEventListener('click', () => {
      void action();
    });
    return node;
  };

  // iOS pauses background tabs: check where we are on return (tech spec §5).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && controller?.isOpen) {
      controller.check().catch(() => undefined);
    }
  });

  return {
    setUser: (next) => {
      if (next?.id === user?.id) return;
      controller?.close();
      user = next;
      controller = next ? newController() : null;
      const current = controller;
      if (!current) return;
      current
        .check()
        .then((state) => {
          if (current !== controller) return;
          options.onEntryChange();
          if (opensByItself(state)) void current.open();
        })
        .catch(() => {
          // Offline or a hiccup: the tutorial never blocks the lobby. The
          // lobby's own error says what to do; the next login checks again.
        });
    },
    attachScene: (next, spot, invalidate) => {
      // The old scene's meshes went with it.
      sprout = null;
      scene = { scene: next, spot, invalidate };
      next.onDisposeObservable.addOnce(() => {
        if (scene?.scene !== next) return;
        scene = null;
        sprout = null;
      });
      syncSprout(controller?.isOpen ?? false);
      overlay.relayout();
    },
    listActions: () => {
      const state = controller?.known;
      if (!controller || !state || controller.isOpen) return [];
      const current = controller;
      if (state.status === 'not-started') {
        return [entryButton('Meet Sprout', 'tutorial-start', () => current.open())];
      }
      if (state.status === 'in-progress') {
        return [entryButton('Visit Sprout', 'tutorial-resume', () => current.open())];
      }
      return [];
    },
    settings: () => {
      const state = controller?.known;
      if (!controller) return [];
      if (!state) {
        return [
          el('p', { class: 'auth-subtitle' }, "Sprout can't be reached right now. Try again soon!"),
        ];
      }
      const current = controller;
      if (state.status === 'completed') {
        return [
          el('p', { class: 'auth-subtitle' }, 'Want to play with Sprout again?'),
          entryButton('Play again', 'tutorial-replay', () => current.replay()),
        ];
      }
      return [
        el('p', { class: 'auth-subtitle' }, 'Sprout is waiting to show you around.'),
        entryButton('Meet Sprout', 'tutorial-settings-start', () => current.open()),
      ];
    },
    targets,
    relayout: () => {
      overlay.relayout();
    },
    get debug() {
      if (!controller) return null;
      return {
        ...controller.debug,
        overlay: overlay.debug,
        sprout: sprout ? sproutHash(sprout.params) : null,
      };
    },
  };
}
