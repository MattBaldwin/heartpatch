import { GAME_DATA, NICKNAME_MAX_LENGTH, type HighlightTarget } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import type { HighlightTargets } from './highlight-targets.js';
import {
  layoutOverlay,
  placeOrb,
  union,
  type Insets,
  type OverlayLayout,
  type Rect,
  type Size,
} from './overlay-layout.js';
import { foreignSheets, obstacles, openSheets } from './sheets.js';
import type { GraduationChoice, TutorialView } from './tutorial-controller.js';
import '../ui/auth/auth.css';
import './tutorial.css';

// The tutorial UI layer (tech spec §6): a spotlight over the step's target,
// Sprout's speech bubble and arrow, and input blockers around the spotlight.
// Plain DOM and CSS over the canvas, so it costs no render passes: the dim is
// one element's box-shadow and nothing animates but the arrow's bob.
// Chrome copy follows docs/STYLE_GUIDE.md; Sprout's lines come from the data.
//
// Sprout waits its turn (#127, #128, #139): while a sheet that isn't the
// step's own target is open (sheets.ts), the layer gates nothing and the
// bubble shrinks to a small orb clear of the sheet, so no tap meant for the
// sheet ever lands on Sprout and no sheet is ever stuck under a blocker. The
// bubble opens again by itself once the sheet closes; a tap on the orb peeks
// at it sooner, laid out clear of the sheet, and a tap on the read bubble (or
// its button) tucks it back into the orb.

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
  /** Sprout is waiting behind an open sheet (the orb). */
  readonly held: boolean;
  /** The sheets it waits behind (their `data-testid`s, or class names). */
  readonly sheets: readonly string[];
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
  /** Sprout is waiting behind these open sheets (sheets.ts). */
  let behind: string[] = [];
  /** The player tapped the orb: the bubble shows over the sheet until it's put away. */
  let peek = false;
  /** The step the bubble last showed, so a new step closes a peek. */
  let shownStep: string | null = null;
  /** The layout last put on screen, so an unchanged one touches no DOM. */
  let drawn = '';
  /** What the main button does right now. */
  let onMain: () => void = () => undefined;

  mainButton.addEventListener('click', (event) => {
    event.stopPropagation();
    onMain();
  });
  // Tap the bubble to read on (style guide §6: "tap to continue"), or to
  // open it again when it's tucked away or waiting behind a sheet.
  bubble.addEventListener('click', (event) => {
    if (overlay.classList.contains('tutorial-held')) {
      peek = true;
      relayout();
      return;
    }
    if (overlay.classList.contains('tutorial-tucked')) {
      actions.untuck();
      return;
    }
    if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement) {
      return;
    }
    // A peek that has been read: tapping it puts it back into the orb.
    const step = view?.step;
    if (peek && step && (view?.line ?? 0) >= step.lines.length - 1) {
      peek = false;
      relayout();
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

  /**
   * The bubble's size free of the height the last layout capped it to; a
   * tucked chip also sheds its pinned width, so it can grow with its goal.
   */
  function naturalSize(): { width: number; height: number } {
    const { width, height, maxHeight } = bubble.style;
    bubble.style.width = '';
    bubble.style.height = '';
    bubble.style.maxHeight = '';
    const size = { width: bubble.offsetWidth, height: bubble.scrollHeight };
    bubble.style.width = width;
    bubble.style.height = height;
    bubble.style.maxHeight = maxHeight;
    return size;
  }

  function relayout(): void {
    const step = view?.phase === 'step' || view?.phase === 'waiting' ? view.step : null;
    if (!view || view.phase === 'closed') return;
    const target = step?.target ?? 'none';
    const found = step ? targets.find(target) : null;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const insets = readInsets(probe);
    // Sprout waits behind any sheet that isn't the step's own target.
    const sheets = openSheets(root, overlay);
    const waitingFor = foreignSheets(sheets, found?.element ?? null);
    const held = waitingFor.length > 0;
    if (!held) peek = false;
    const orb = held && !peek;
    behind = waitingFor.map(
      (s) => (s.element as HTMLElement).dataset['testid'] ?? s.element.className,
    );
    overlay.classList.toggle('tutorial-held', orb);
    // Something to read once the sheet closes: the orb glows until then.
    overlay.classList.toggle('tutorial-new', orb && !view.tucked);
    overlay.classList.toggle('tutorial-tucked', !held && view.tucked);
    layout = layoutOverlay({
      target: held ? null : (found?.rect ?? null),
      // While loading or showing an error, only Sprout's bubble takes taps;
      // behind a sheet, nothing is gated at all.
      talkOnly: held ? false : step ? step.talkOnly : true,
      viewport,
      insets,
      bubbleSize: naturalSize(),
      tucked: overlay.classList.contains('tutorial-tucked'),
      soft: found?.soft ?? false,
      avoid: held && peek ? union(waitingFor.map((s) => s.rect)) : null,
    });
    spotlightOn = !held && found?.element ? target : null;
    const orbRect = orb
      ? placeOrb({ viewport, insets, obstacles: obstaclesNow(waitingFor, viewport) })
      : null;
    const key = JSON.stringify([layout, spotlightOn, orbRect, peek]);
    if (key === drawn) return;
    drawn = key;
    overlay.dataset['gate'] = layout.gate;
    overlay.dataset['bubble'] = layout.bubble;
    // With a spotlight the layout places the bubble clear of it; the orb
    // goes where the sheet isn't; otherwise CSS does.
    const at = orbRect ?? layout.bubbleRect;
    bubble.style.left = at ? `${String(at.x)}px` : '';
    bubble.style.top = at ? `${String(at.y)}px` : '';
    bubble.style.width = at ? `${String(at.width)}px` : '';
    bubble.style.right = at ? 'auto' : '';
    bubble.style.bottom = at ? 'auto' : '';
    bubble.style.margin = at ? '0' : '';
    bubble.style.maxHeight = at ? `${String(at.height)}px` : '';
    bubble.style.height = orbRect ? `${String(orbRect.height)}px` : '';

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
   * The controls and cards the orb keeps clear of, measured once per change
   * to the page (a frame drawn by the scene moves no buttons), so a night
   * sky or a visit animating under the orb costs no layout per frame.
   */
  let pageVersion = 0;
  let measured: { version: number; key: string; rects: Rect[] } | null = null;
  function obstaclesNow(sheets: Parameters<typeof obstacles>[2], viewport: Size): Rect[] {
    const key = JSON.stringify([viewport, sheets.map((s) => s.rect)]);
    if (measured?.version !== pageVersion || measured.key !== key) {
      measured = { version: pageVersion, key, rects: obstacles(root, overlay, sheets, viewport) };
    }
    return measured.rects;
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
  // Sprout's words changed size: place the bubble again (same layout, no writes).
  new ResizeObserver(() => {
    follow();
  }).observe(bubble);
  new MutationObserver((records) => {
    if (records.some((r) => !overlay.contains(r.target))) {
      pageVersion += 1;
      follow();
    }
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
    // A new step (or a run starting over) ends a peek at the old one.
    const stepKey = step ? `${step.id}:${next.state?.mapId ?? ''}` : null;
    if (stepKey !== shownStep || next.tucked) {
      shownStep = stepKey;
      peek = false;
    }
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

  const resized = () => {
    pageVersion += 1;
    relayout();
  };
  window.addEventListener('resize', resized);
  window.visualViewport?.addEventListener('resize', resized);

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
        held: !hidden && overlay.classList.contains('tutorial-held'),
        sheets: hidden ? [] : behind,
      };
    },
  };
}
