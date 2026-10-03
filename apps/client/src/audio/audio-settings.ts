import { AUDIO_SETTINGS_KEY, DEFAULT_VOLUMES } from './audio-config.js';

// The player's music and sound levels, kept per device (#25). Storage can be
// blocked (private browsing, a full disk): then the defaults apply and the
// sliders still work for this visit.

export interface AudioSettings {
  /** Slider levels, 0–1. */
  readonly music: number;
  readonly sounds: number;
  /** Off switches, separate from the sliders so turning back on restores the level. */
  readonly musicOn: boolean;
  readonly soundsOn: boolean;
}

export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  music: DEFAULT_VOLUMES.music,
  sounds: DEFAULT_VOLUMES.sounds,
  musicOn: true,
  soundsOn: true,
};

const level = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

const flag = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/** Whatever was stored, made safe: unknown or broken fields fall back to the defaults. */
export function parseAudioSettings(raw: string | null): AudioSettings {
  if (raw === null) return DEFAULT_AUDIO_SETTINGS;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
  if (typeof data !== 'object' || data === null) return DEFAULT_AUDIO_SETTINGS;
  const d = data as Record<string, unknown>;
  const base = DEFAULT_AUDIO_SETTINGS;
  return {
    music: level(d['music'], base.music),
    sounds: level(d['sounds'], base.sounds),
    musicOn: flag(d['musicOn'], base.musicOn),
    soundsOn: flag(d['soundsOn'], base.soundsOn),
  };
}

export function loadAudioSettings(storage: SettingsStorage | null): AudioSettings {
  try {
    return parseAudioSettings(storage?.getItem(AUDIO_SETTINGS_KEY) ?? null);
  } catch {
    return DEFAULT_AUDIO_SETTINGS; // storage blocked
  }
}

export function saveAudioSettings(storage: SettingsStorage | null, settings: AudioSettings): void {
  try {
    storage?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked or full: the levels hold for this visit only.
  }
}

/** The levels the buses play at (0 when switched off). */
export function effectiveVolumes(settings: AudioSettings): { music: number; sounds: number } {
  return {
    music: settings.musicOn ? settings.music : 0,
    sounds: settings.soundsOn ? settings.sounds : 0,
  };
}

/** This browser's localStorage, or null where reading it throws. */
export function safeStorage(): SettingsStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
