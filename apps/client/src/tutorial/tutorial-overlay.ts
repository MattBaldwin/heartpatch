import { GAME_DATA, NICKNAME_MAX_LENGTH, type HighlightTarget } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import type { HighlightTargets } from './highlight-targets.js';
import { layoutOverlay, type Insets, type OverlayLayout, type Rect } from './overlay-layout.js';
import type { GraduationChoice, TutorialView } from './tutorial-controller.js';
import '../ui/auth/auth.css';
import './tutorial.css';

// The tutorial UI layer (tech spec §6): a spotlight over the step's target,
// Sprout's speech bubble and arrow, and input blockers around the spotlight.
// Plain DOM and CSS over the canvas, so it costs no render passes: the dim is
// one element's box-shadow and nothing animates but the arrow's bob.
// Chrome copy follows docs/STYLE_GUIDE.md; Sprout's lines come from the data.

export interface TutorialOverlayActions {
  nextLine: () => void;
  acknowledge: (choice: GraduationChoice | null) => void;
  retry: () => void;
  /** Asks the server where we are (a step this app doesn't know yet). */
  recheck: () => void;
  skip: () => void;
  /** Puts the tutorial away for now (only offered when it isn't required). */
  leave: () => void;
  /** A blocked tap: Sprout gives a little hop to say "over here!". */
  nudge: () => void;
  /** The naming step's Save. */
  name: (nickname: string) => void;
  /** The nightfall step's "Night falls". */
  nightfall: () => void;
  /** The wardrobe step's "Wardrobe". */
  wardrobe: () => void;
  /** A gameplay step's "Let's go!": tuck the bubble away. */
  tuck: () => void;
  /** Tapping the tucked chip: read the bubble again. */
  untuck: () => void;
}

/** Chrome words (style guide §6). Sprout's lines come from the step data. */
export const OVERLAY_TEXT = {
  nameLabel: "Your Partner's name",
  waiting: 'One moment…',
  next: 'Next',
} as const;

const speciesNames = new Map(GAME_DATA.species.map((s) => [s.id, s.name]));

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface TutorialOverlayDebug {
  readonly target: HighlightTarget | null;
  /** The element the spotlight is on (its `data-tutorial-target`), when it's a DOM target. */
  readonly spotlightOn: string | null;
  readonly hole: Rect | null;
  readonly gate: OverlayLayout['gate'] | null;
}

export interface TutorialOverlay {
  render: (view: TutorialView) => void;
  /** Lays out again (the target moved: a resize, a scene change). */
  relayout: () => void;
  /** Lays out again on the next frame, if anything moved (a scene drew a frame). */
  follow: () => void;
  readonly debug: TutorialOverlayDebug;
}

/** `env(safe-area-inset-*)` in pixels, read from a probe element. */
function readInsets(probe: HTMLElement): Insets {
  const style = getComputedStyle(probe);
  const px = (value: string) => Number.parseFloat(value) || 0;
  return {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft),
  };
}

export function mountTutorialOverlay(
  root: HTMLElement,
  targets: HighlightTargets,
  actions: TutorialOverlayActions,
): TutorialOverlay {
  const probe = el('div', { class: 'tutorial-insets', 'aria-hidden': 'true' });
  const spotlight = el('div', { class: 'tutorial-spotlight', 'data-testid': 'tutorial-spotlight' });
  const blockers = el('div', { class: 'tutorial-blockers' });
  const arrow = el('div', { class: 'tutorial-arrow', 'data-testid': 'tutorial-arrow' });

  const choiceButton = (label: string, choice: GraduationChoice, soft = false) => {
    const node = el(
      'button',
      { type: 'button', class: soft ? 'auth-button auth-button-soft' : 'auth-button' },
      label,
    );
    node.addEventListener('click', () => {
      actions.acknowledge(choice);
    });
    return node;
  };
  const choices = el(
    'div',
    { class: 'tutorial-choices', 'data-tutorial-target': 'graduation-choices' },
    choiceButton('Make a patch', 'create'),
    choiceButton('Join with a code', 'join', true),
  );

  const goal = el('p', { class: 'tutorial-goal', 'data-testid': 'tutorial-goal' });
  const line = el('p', { class: 'tutorial-line', 'data-testid': 'tutorial-line' });
  const mainButton = el('button', {
    type: 'button',
    class: 'auth-button',
    'data-testid': 'tutorial-main',
  });
  const nameInput = el('input', {
    type: 'text',
    class: 'tutorial-name-input',
    'aria-label': OVERLAY_TEXT.nameLabel,
    'data-testid': 'tutorial-name-input',
    autocomplete: 'off',
    autocapitalize: 'words',
    spellcheck: 'false',
    enterkeyhint: 'done',
    maxlength: String(NICKNAME_MAX_LENGTH),
  });
  const nameSave = el(
    'button',
    { type: 'submit', class: 'auth-button', 'data-testid': 'tutorial-name-save' },
    'Save',
  );
  const nameForm = el(
    'form',
    { class: 'tutorial-name-form', 'data-testid': 'tutorial-name-form' },
    nameInput,
    nameSave,
  );
  const skipButton = el('button', { type: 'button', class: 'auth-link' }, 'Skip it');
  const leaveButton = el('button', { type: 'button', class: 'auth-link' }, 'Later');
  const bubble = el(
    'section',
    {
      class: 'tutorial-bubble',
      'data-testid': 'tutorial-bubble',
      role: 'dialog',
      'aria-label': 'Sprout',
    },
    el('p', { class: 'tutorial-name' }, 'Sprout'),
    goal,
    el('div', { 'aria-live': 'polite' }, line),
    nameForm,
    el('div', { class: 'tutorial-actions' }, mainButton),
    el('div', { class: 'tutorial-links' }, skipButton, leaveButton),
  );
  const overlay = el(
    'div',
    { class: 'tutorial', 'data-testid': 'tutorial' },
    probe,
    spotlight,
    blockers,
    choices,
    arrow,
    bubble,
  );
  overlay.hidden = true;
  root.append(overlay);

  let view: TutorialView | null = null;
  let layout: OverlayLayout | null = null;
  let spotlightOn: string | null = null;
  /** The layout last put on screen, so an unchanged one touches no DOM. */
  let drawn = '';
  /** What the main button does right now. */
  let onMain: () => void = () => undefined;

  mainButton.addEventListener('click', (event) => {
    event.stopPropagation();
    onMain();
  });
  // Tap the bubble to read on (style guide §6: "tap to continue"), or to
  // open it again when it's tucked away.
  bubble.addEventListener('click', (event) => {
    if (overlay.classList.contains('tutorial-tucked')) {
      actions.untuck();
      return;
    }
    if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement) {
      return;
    }
    actions.nextLine();
  });
  nameForm.addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopPropagation();
    actions.name(nameInput.value);
  });
  skipButton.addEventListener('click', () => {
    actions.skip();
  });
  leaveButton.addEventListener('click', () => {
    actions.leave();
  });
  blockers.addEventListener('pointerdown', () => {
    actions.nudge();
  });

  const place = (node: HTMLElement, rect: Rect) => {
    node.style.transform = `translate(${String(rect.x)}px, ${String(rect.y)}px)`;
    node.style.width = `${String(rect.width)}px`;
    node.style.height = `${String(rect.height)}px`;
  };

  function relayout(): void {
    const step = view?.phase === 'step' || view?.phase === 'waiting' ? view.step : null;
    if (!view || view.phase === 'closed') return;
    const target = step?.target ?? 'none';
    const found = step ? targets.find(target) : null;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    layout = layoutOverlay({
      target: found?.rect ?? null,
      // While loading or showing an error, only Sprout's bubble takes taps.
      talkOnly: step ? step.talkOnly : true,
      viewport,
      insets: readInsets(probe),
    });
    spotlightOn = found?.element ? target : null;
    const key = JSON.stringify([layout, spotlightOn]);
    if (key === drawn) return;
    drawn = key;
    overlay.dataset['gate'] = layout.gate;
    overlay.dataset['bubble'] = layout.bubble;

    spotlight.hidden = layout.hole === null;
    if (layout.hole) place(spotlight, layout.hole);
    // Dim everything when Sprout is just talking; open steps stay clear.
    overlay.classList.toggle('tutorial-dim', layout.gate === 'blockAll');

    blockers.replaceChildren(
      ...layout.blockers.map((rect) => {
        const node = el('div', { class: 'tutorial-blocker', 'data-testid': 'tutorial-blocker' });
        place(node, rect);
        return node;
      }),
    );

    arrow.hidden = layout.arrow === null;
    if (layout.arrow) {
      arrow.dataset['points'] = layout.arrow.points;
      arrow.style.left = `${String(layout.arrow.x)}px`;
      arrow.style.top = `${String(layout.arrow.y)}px`;
    }
  }

  /**
   * Lays out again on the next frame (many calls, one layout): the target
   * may have moved, appeared or gone (a panel opened, a countdown finished,
   * the camera panned). Unchanged layouts cost a lookup and no DOM writes.
   */
  let queued = false;
  function follow(): void {
    if (queued || overlay.hidden) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      relayout();
    });
  }
  // The game's screens show and hide their buttons as you play; the
  // spotlight moves with them. Our own changes don't count.
  new MutationObserver((records) => {
    if (records.some((r) => !overlay.contains(r.target))) follow();
  }).observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'class'],
  });

  function render(next: TutorialView): void {
    view = next;
    overlay.hidden = next.phase === 'closed';
    if (next.phase === 'closed') return;
    const step = next.step;
    const lastLine = step !== null && next.line >= step.lines.length - 1;
    // Graduation's choices come with Sprout's last line.
    const showChoices = step?.target === 'graduation-choices' && next.phase === 'step' && lastLine;
    choices.hidden = !showChoices;
    choices.querySelectorAll('button').forEach((b) => {
      b.disabled = next.phase !== 'step';
    });

    goal.textContent = step?.goal ?? '';
    goal.hidden = !step?.goal;
    mainButton.hidden = false;
    mainButton.disabled = false;
    overlay.classList.toggle('tutorial-tucked', next.tucked);
    const naming = step?.action === 'name' && lastLine && next.phase !== 'error';
    nameForm.hidden = !naming;
    nameSave.disabled = next.phase === 'waiting';
    if (naming && next.state?.partner) {
      const species = speciesNames.get(next.state.partner.speciesId) ?? '';
      nameInput.placeholder = species;
    }
    if (next.phase === 'loading') {
      line.textContent = 'One moment…';
      mainButton.hidden = true;
    } else if (next.phase === 'error') {
      line.textContent = next.message ?? 'Oops, something went wobbly. Try again!';
      mainButton.textContent = 'Try again';
      onMain = actions.retry;
    } else if (step) {
      line.textContent = step.lines[Math.min(next.line, step.lines.length - 1)] ?? '';
      if (!lastLine) {
        mainButton.textContent = OVERLAY_TEXT.next;
        onMain = actions.nextLine;
      } else if (step.talkOnly && !showChoices) {
        mainButton.textContent = next.phase === 'waiting' ? OVERLAY_TEXT.waiting : step.actionLabel;
        mainButton.disabled = next.phase === 'waiting';
        onMain = () => {
          actions.acknowledge(null);
        };
      } else if (step.action === 'name') {
        // The name box has its own Save.
        mainButton.hidden = true;
      } else if (step.action === 'nightfall' || step.action === 'wardrobe') {
        const waiting = next.phase === 'waiting';
        mainButton.textContent = waiting ? OVERLAY_TEXT.waiting : step.actionLabel;
        mainButton.disabled = waiting;
        onMain = step.action === 'nightfall' ? actions.nightfall : actions.wardrobe;
      } else if (!step.known) {
        // A newer step than this app knows: input stays open, and Sprout can
        // check whether the server has moved on (an update is on its way).
        mainButton.textContent = 'Check again';
        onMain = actions.recheck;
      } else if (showChoices) {
        // Graduation goes on with a choice.
        mainButton.hidden = true;
      } else {
        // Gameplay steps go on when the player does the thing (input stays
        // open around the spotlight): tuck Sprout away so it never covers it.
        mainButton.textContent = step.actionLabel;
        onMain = actions.tuck;
      }
    }
    skipButton.hidden = !next.canSkip;
    leaveButton.hidden = !next.canLeave;
    relayout();
  }

  window.addEventListener('resize', relayout);
  window.visualViewport?.addEventListener('resize', relayout);

  return {
    render,
    relayout,
    follow,
    get debug() {
      const hidden = overlay.hidden || !view;
      return {
        target: hidden ? null : (view?.step?.target ?? null),
        spotlightOn: hidden ? null : spotlightOn,
        hole: hidden ? null : (layout?.hole ?? null),
        gate: hidden ? null : (layout?.gate ?? null),
      };
    },
  };
}
