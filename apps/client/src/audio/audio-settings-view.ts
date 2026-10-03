import { el } from '../ui/dom.js';
import type { AudioSettings } from './audio-settings.js';
import './audio.css';

// Music and sounds on the lobby's Settings screen (#25): a slider and an
// on/off switch for each. Changes are heard at once and kept on this device.

export const AUDIO_TEXT = {
  title: 'Music and sounds',
  music: 'Music',
  sounds: 'Sounds',
  on: 'On',
  off: 'Off',
  musicSwitch: 'Play music',
  soundsSwitch: 'Play sounds',
} as const;

/** Slider steps (0–10), so a small thumb lands on a level easily. */
const STEPS = 10;

export interface AudioSettingsViewOptions {
  current: () => AudioSettings;
  /** A new setting; `save` is false while a slider is still moving. */
  change: (next: AudioSettings, save: boolean) => void;
  /** A sample sound after the Sounds level changes. */
  preview: () => void;
}

export function audioSettingsView(options: AudioSettingsViewOptions): Node[] {
  const row = (kind: 'music' | 'sounds'): HTMLElement => {
    const onKey = kind === 'music' ? 'musicOn' : 'soundsOn';
    const id = `audio-${kind}-volume`;
    const slider = el('input', {
      id,
      type: 'range',
      min: '0',
      max: String(STEPS),
      step: '1',
      class: 'audio-slider',
      'data-testid': id,
    });
    slider.value = String(Math.round(options.current()[kind] * STEPS));
    const toggle = el('button', {
      type: 'button',
      class: 'auth-button auth-button-soft auth-button-small audio-toggle',
      'aria-label': kind === 'music' ? AUDIO_TEXT.musicSwitch : AUDIO_TEXT.soundsSwitch,
      'data-testid': `audio-${kind}-toggle`,
    });
    const show = () => {
      const on = options.current()[onKey];
      toggle.textContent = on ? AUDIO_TEXT.on : AUDIO_TEXT.off;
      toggle.setAttribute('aria-pressed', String(on));
      slider.disabled = !on;
    };
    const level = (save: boolean) => {
      options.change({ ...options.current(), [kind]: Number(slider.value) / STEPS }, save);
    };
    slider.addEventListener('input', () => {
      level(false);
    });
    slider.addEventListener('change', () => {
      level(true);
      if (kind === 'sounds') options.preview();
    });
    toggle.addEventListener('click', () => {
      const current = options.current();
      options.change({ ...current, [onKey]: !current[onKey] }, true);
      show();
    });
    show();
    return el(
      'div',
      { class: 'audio-row' },
      el(
        'label',
        { for: id, class: 'audio-label' },
        kind === 'music' ? '🎵 ' : '🔔 ',
        AUDIO_TEXT[kind],
      ),
      slider,
      toggle,
    );
  };
  return [
    el(
      'div',
      { class: 'audio-settings', 'data-testid': 'audio-settings' },
      el('p', { class: 'auth-subtitle' }, AUDIO_TEXT.title),
      row('music'),
      row('sounds'),
    ),
  ];
}
