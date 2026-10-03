import { describe, expect, it } from 'vitest';
import { AUDIO_SETTINGS_KEY } from './audio-config.js';
import {
  DEFAULT_AUDIO_SETTINGS,
  effectiveVolumes,
  loadAudioSettings,
  parseAudioSettings,
  saveAudioSettings,
  type SettingsStorage,
} from './audio-settings.js';

function memoryStorage(): SettingsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const blocked: SettingsStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('audio settings', () => {
  it('starts from the defaults: both on, music quieter than sounds', () => {
    expect(loadAudioSettings(memoryStorage())).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(DEFAULT_AUDIO_SETTINGS.musicOn && DEFAULT_AUDIO_SETTINGS.soundsOn).toBe(true);
    expect(DEFAULT_AUDIO_SETTINGS.music).toBeLessThan(DEFAULT_AUDIO_SETTINGS.sounds);
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const mine = { music: 0.3, sounds: 1, musicOn: false, soundsOn: true };
    saveAudioSettings(storage, mine);
    expect(storage.data.has(AUDIO_SETTINGS_KEY)).toBe(true);
    expect(loadAudioSettings(storage)).toEqual(mine);
  });

  it('works without storage, or with storage that throws', () => {
    expect(loadAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(loadAudioSettings(blocked)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(() => {
      saveAudioSettings(blocked, DEFAULT_AUDIO_SETTINGS);
    }).not.toThrow();
    expect(() => {
      saveAudioSettings(null, DEFAULT_AUDIO_SETTINGS);
    }).not.toThrow();
  });

  it('repairs broken or tampered values field by field', () => {
    expect(parseAudioSettings('not json')).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings('null')).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings('[1,2]')).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings('{"music": 7, "sounds": -1, "musicOn": "yes"}')).toEqual({
      ...DEFAULT_AUDIO_SETTINGS,
      music: 1,
      sounds: 0,
    });
    expect(parseAudioSettings('{"music": "loud", "soundsOn": false}')).toEqual({
      ...DEFAULT_AUDIO_SETTINGS,
      soundsOn: false,
    });
  });

  it('plays at zero when switched off, and keeps the level for switching back on', () => {
    const settings = { music: 0.4, sounds: 0.9, musicOn: false, soundsOn: true };
    expect(effectiveVolumes(settings)).toEqual({ music: 0, sounds: 0.9 });
    expect(effectiveVolumes({ ...settings, musicOn: true })).toEqual({ music: 0.4, sounds: 0.9 });
  });
});
