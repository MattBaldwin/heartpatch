import '../audio/audio.css';
import { hpButton } from '../ui/button/button.js';
import { el } from '../ui/dom.js';
import { installSteps } from './install-guide.js';
import type { SubscribeOutcome } from './push-client.js';
import {
  loadNudges,
  type Nudges,
  type NudgesDeps,
  type NudgesState,
  type NudgeSwitch,
} from './push-settings.js';
import './pwa.css';

// Settings › Nudges (#726 plan, "Client UI flow"): a "Nudges" row with its
// state and an On/Off control, and while on, the four switches in the audio
// switches' look. Read fresh every time Settings opens; push off for this
// player (NOT_FOUND) leaves the group out.

export const PUSH_SETTINGS_TEXT = {
  title: 'Nudges',
  row: 'Nudges',
  on: 'On',
  off: 'Off',
  blocked: 'Off in iPhone Settings',
  blockedHow: 'To turn them on: Settings › Notifications › Heartpatch.',
  install: 'Add to Home Screen first',
  installHow: 'Show me how',
  failed: "Oops, that didn't work. Try again!",
  switches: {
    dusk: 'Night falling',
    gatherers: 'Gatherers done',
    friend: 'A friend is here',
    longNight: 'The Long Night',
  } satisfies Record<NudgeSwitch, string>,
} as const;

export interface PushSettingsViewOptions extends NudgesDeps {
  /** The patch on screen has a Long Night day: its switch shows. */
  longNight: () => Promise<boolean>;
  /** Nudges were turned on or off here (the offer card never shows after). */
  onAnswered: () => void;
}

/** The group for the Settings list: an empty box until the row's state is read. */
/**
 * Whether The Long Night's switch shows: nudges on, and the patch behind
 * Settings has a Long Night day (`longNight` asks; a failed ask is no).
 */
export async function longNightShown(
  state: NudgesState,
  longNight: () => Promise<boolean>,
): Promise<boolean> {
  return state === 'on' && (await longNight().catch(() => false));
}

/** The switches under the On control, in order: none unless nudges are on. */
export function nudgeSwitches(state: NudgesState, longNight: boolean): NudgeSwitch[] {
  if (state !== 'on') return [];
  return longNight ? ['dusk', 'gatherers', 'friend', 'longNight'] : ['dusk', 'gatherers', 'friend'];
}

export function pushSettingsView(options: PushSettingsViewOptions): Node[] {
  const box = el('div', { class: 'push-settings-box' });

  async function fill(note: string | null = null): Promise<void> {
    const nudges = await loadNudges(options).catch(() => null);
    if (!nudges) {
      box.replaceChildren();
      return;
    }
    box.replaceChildren(group(nudges, note, await longNightShown(nudges.state, options.longNight)));
  }

  const after = (outcome: SubscribeOutcome | null) => {
    if (outcome !== 'failed') options.onAnswered();
    void fill(outcome === 'failed' ? PUSH_SETTINGS_TEXT.failed : null);
  };

  function control(nudges: Nudges): HTMLElement {
    if (nudges.state === 'blocked' || nudges.state === 'install') {
      return el(
        'span',
        { class: 'push-state', 'data-testid': 'push-state' },
        nudges.state === 'blocked' ? PUSH_SETTINGS_TEXT.blocked : PUSH_SETTINGS_TEXT.install,
      );
    }
    const on = nudges.state === 'on';
    const toggle = el(
      'button',
      {
        type: 'button',
        class: 'auth-button auth-button-soft auth-button-small audio-toggle',
        'aria-label': PUSH_SETTINGS_TEXT.row,
        'aria-pressed': String(on),
        'data-testid': 'push-toggle',
      },
      on ? PUSH_SETTINGS_TEXT.on : PUSH_SETTINGS_TEXT.off,
    );
    toggle.addEventListener('click', () => {
      if (on) {
        toggle.disabled = true;
        void nudges.turnOff().then(
          () => {
            after(null);
          },
          () => {
            after(null);
          },
        );
        return;
      }
      // The tap rule: subscribe first thing, with no await before it.
      const outcome = nudges.turnOn();
      toggle.disabled = true;
      void outcome.then(after, () => {
        after('failed');
      });
    });
    return toggle;
  }

  function switchRow(nudges: Nudges, key: NudgeSwitch): HTMLElement {
    const toggle = el('button', {
      type: 'button',
      class: 'auth-button auth-button-soft auth-button-small audio-toggle',
      'aria-label': PUSH_SETTINGS_TEXT.switches[key],
      'data-testid': `push-switch-${key}`,
    });
    const show = (on: boolean) => {
      toggle.textContent = on ? PUSH_SETTINGS_TEXT.on : PUSH_SETTINGS_TEXT.off;
      toggle.setAttribute('aria-pressed', String(on));
    };
    show(nudges.settings[key]);
    toggle.addEventListener('click', () => {
      if (nudges.saving(key)) return;
      const next = !nudges.settings[key];
      show(next); // optimistic; goes back if the save fails
      // One save at a time: the switch rests while its save is out.
      toggle.disabled = true;
      void nudges
        .toggle(key, next)
        .then(show, () => {
          show(nudges.settings[key]);
        })
        .finally(() => {
          toggle.disabled = false;
        });
    });
    return el(
      'div',
      { class: 'push-row push-switch' },
      el('span', { class: 'push-label' }, PUSH_SETTINGS_TEXT.switches[key]),
      toggle,
    );
  }

  function group(nudges: Nudges, note: string | null, longNight: boolean): HTMLElement {
    const parts: Node[] = [
      el('p', { class: 'auth-subtitle' }, PUSH_SETTINGS_TEXT.title),
      el(
        'div',
        { class: 'push-row' },
        el('span', { class: 'push-label push-label-main' }, PUSH_SETTINGS_TEXT.row),
        control(nudges),
      ),
    ];
    if (nudges.state === 'blocked') {
      parts.push(el('p', { class: 'push-note' }, PUSH_SETTINGS_TEXT.blockedHow));
    }
    if (nudges.state === 'install') {
      const how = hpButton(PUSH_SETTINGS_TEXT.installHow, { variant: 'quiet', small: true });
      how.dataset['testid'] = 'push-install-how';
      const steps = installSteps();
      steps.hidden = true;
      how.addEventListener('click', () => {
        steps.hidden = false;
        how.remove();
      });
      parts.push(how, steps);
    }
    if (note !== null) {
      parts.push(el('p', { class: 'push-note', role: 'status' }, note));
    }
    parts.push(...nudgeSwitches(nudges.state, longNight).map((key) => switchRow(nudges, key)));
    return el(
      'div',
      { class: 'push-settings', 'data-testid': 'push-settings', 'data-state': nudges.state },
      ...parts,
    );
  }

  void fill();
  return [box];
}
