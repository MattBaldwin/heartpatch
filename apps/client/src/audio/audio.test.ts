import { describe, expect, it } from 'vitest';
import type { Engine } from './audio-engine.js';
import { AUDIO_SETTINGS_KEY } from './audio-config.js';
import { createAudio, type AudioEventTarget } from './audio.js';
import type { CueName } from './cues.js';
import type { TrackId } from './music-score.js';

type Listener = (event: { target: unknown }) => void;

/** A stand-in document: gestures and visibility are dispatched by hand. */
class FakeTarget {
  hidden = false;
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  fire(type: string, target: unknown = null): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ target });
  }

  /** A tap on something: touchend, then the click it makes. */
  tap(target: unknown = null): void {
    this.fire('touchend', target);
    this.fire('click', target);
  }
}

class FakeContext {
  state = 'suspended';
  private readonly listeners: (() => void)[] = [];
  resume(): Promise<void> {
    this.state = 'running';
    for (const l of this.listeners) l();
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = 'suspended';
    for (const l of this.listeners) l();
    return Promise.resolve();
  }
  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener);
  }
}

class FakeEngine implements Engine {
  plays: CueName[] = [];
  tracks: (TrackId | null)[] = [];
  volumes: { music: number; sounds: number }[] = [];
  current: TrackId | null = null;
  play(cue: CueName): boolean {
    this.plays.push(cue);
    return true;
  }
  setTrack(track: TrackId | null): void {
    this.tracks.push(track);
    this.current = track;
  }
  setVolumes(volumes: { music: number; sounds: number }): void {
    this.volumes.push(volumes);
  }
  get track(): TrackId | null {
    return this.current;
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const button = { closest: (selector: string) => (selector.includes('button') ? {} : null) };

function setup(opts: { stored?: string; today?: string; context?: boolean } = {}) {
  const target = new FakeTarget();
  const data = new Map<string, string>();
  if (opts.stored) data.set(AUDIO_SETTINGS_KEY, opts.stored);
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
  const engine = new FakeEngine();
  let loads = 0;
  let contexts = 0;
  const audio = createAudio({
    target: target as unknown as AudioEventTarget,
    storage,
    createContext: () => {
      if (opts.context === false) return null;
      contexts += 1;
      return new FakeContext() as unknown as AudioContext;
    },
    loadEngine: () => {
      loads += 1;
      return Promise.resolve({ createEngine: () => engine });
    },
    today: () => opts.today ?? '2026-07-04',
  });
  return { audio, target, engine, data, loads: () => loads, contexts: () => contexts };
}

describe('createAudio', () => {
  it('makes no context, loads no engine and plays nothing before the first tap', async () => {
    const { audio, engine, loads, contexts } = setup();
    audio.cue('boop');
    audio.setNight(true);
    await flush();
    expect(contexts()).toBe(0);
    expect(loads()).toBe(0);
    expect(engine.plays).toEqual([]);
    expect(audio.debug).toMatchObject({
      state: 'locked',
      engine: 'idle',
      lastCue: 'boop',
      cues: 1,
    });
  });

  it('unlocks on the first tap, then loads the engine once and starts the music', async () => {
    const { audio, target, engine, loads, contexts } = setup();
    target.tap();
    target.tap();
    await flush();
    expect(contexts()).toBe(1);
    expect(loads()).toBe(1);
    expect(audio.debug).toMatchObject({ state: 'running', engine: 'ready', playing: 'day' });
    expect(engine.tracks).toEqual(['day']);
  });

  it('ticks for buttons, and plays cues once running', async () => {
    const { audio, target, engine } = setup();
    target.tap(button);
    // The tap that unlocks comes before the engine: its tick is counted but silent.
    expect(audio.debug.lastCue).toBe('tick');
    await flush();
    target.tap(button);
    audio.cue('giggle');
    audio.cue(null);
    expect(engine.plays).toEqual(['tick', 'giggle']);
    expect(audio.debug).toMatchObject({ cues: 3, played: 2, lastCue: 'giggle' });
  });

  it('does not tick for taps on things that are not buttons', async () => {
    const { audio, target } = setup();
    target.tap({ closest: () => null });
    await flush();
    expect(audio.debug.cues).toBe(0);
  });

  it('plays the night loop at night, and Halloween in its window by day', async () => {
    const { audio, target, engine } = setup({ today: '2026-10-20' });
    target.tap();
    await flush();
    expect(engine.track).toBe('halloween');
    audio.setNight(true);
    expect(engine.track).toBe('night');
    audio.setNight(false);
    expect(engine.track).toBe('halloween');
    expect(audio.debug.track).toBe('halloween');
  });

  it('lets the cinematic pick the music, or silence, then hands it back (#46)', async () => {
    const { audio, target, engine } = setup();
    target.tap();
    await flush();
    audio.setScore('wonder');
    audio.setScore('wonder');
    audio.setScore(null);
    // Night falling meanwhile keeps the silence.
    audio.setNight(true);
    expect(engine.current).toBeNull();
    audio.setScore(undefined);
    expect(engine.tracks).toEqual(['day', 'wonder', null, null, 'night']);
    expect(audio.debug.scored).toBeUndefined();
  });

  it('stops the music when it is switched off, and stays quiet when sounds are off', async () => {
    const { audio, target, engine } = setup({
      stored: JSON.stringify({ music: 0.5, sounds: 0.5, musicOn: false, soundsOn: false }),
    });
    target.tap();
    await flush();
    expect(engine.track).toBeNull();
    expect(engine.volumes).toEqual([]);
    audio.cue('boop');
    expect(engine.plays).toEqual([]);
    expect(audio.debug.played).toBe(0);
  });

  it('suspends in the background and comes back when visible', async () => {
    const { audio, target, engine } = setup();
    target.tap();
    await flush();
    target.hidden = true;
    target.fire('visibilitychange');
    expect(audio.debug.state).toBe('suspended');
    audio.cue('boop');
    expect(engine.plays).toEqual([]);
    target.hidden = false;
    target.fire('visibilitychange');
    await flush();
    expect(audio.debug.state).toBe('running');
  });

  it('stays silent, without errors, where there is no Web Audio', async () => {
    const { audio, target, loads } = setup({ context: false });
    target.tap(button);
    await flush();
    expect(audio.debug).toMatchObject({ state: 'unsupported', engine: 'idle', lastCue: 'tick' });
    expect(loads()).toBe(0);
  });

  it('marks the engine failed if its chunk cannot load', async () => {
    const target = new FakeTarget();
    const audio = createAudio({
      target: target as unknown as AudioEventTarget,
      storage: null,
      createContext: () => new FakeContext() as unknown as AudioContext,
      loadEngine: () => Promise.reject(new Error('offline')),
    });
    target.tap();
    await flush();
    expect(audio.debug.engine).toBe('failed');
    expect(() => {
      audio.cue('boop');
    }).not.toThrow();
  });

  it('reads the saved levels at start', () => {
    const { audio } = setup({
      stored: JSON.stringify({ music: 0.2, sounds: 0.9, musicOn: true, soundsOn: false }),
    });
    expect(audio.debug.settings).toEqual({
      music: 0.2,
      sounds: 0.9,
      musicOn: true,
      soundsOn: false,
    });
  });
});
