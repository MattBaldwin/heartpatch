import { activeSeasons, GAME_DATA } from '@heartpatch/shared';
import {
  effectiveVolumes,
  loadAudioSettings,
  safeStorage,
  saveAudioSettings,
  type AudioSettings,
  type SettingsStorage,
} from './audio-settings.js';
import { audioSettingsView } from './audio-settings-view.js';
import { AudioUnlock, type AudioState } from './audio-unlock.js';
import type { CueName } from './cues.js';
import { pickTrack, type TrackId } from './music-score.js';
import type { Engine } from './audio-engine.js';

// Sound for the whole game (#25, tech spec §15). This small part ships in the
// first load: it waits for the first tap, makes the AudioContext inside it
// (iOS only allows that), and only then loads the engine (`audio-engine.ts`,
// a separate chunk). Screens report moments as cues; a cue before the engine
// is ready is counted for the dev hook but stays silent, so nothing ever
// plays before a tap and no burst of old cues plays after one.

export interface AudioDebug {
  readonly state: AudioState;
  /** 'idle' until the first tap, then 'loading', then 'ready' (or 'failed'). */
  readonly engine: 'idle' | 'loading' | 'ready' | 'failed';
  /** The loop wanted for where the player is (day, night or Halloween). */
  readonly track: TrackId;
  /** The loop the engine is playing (null: none, or music off). */
  readonly playing: TrackId | null;
  /** The last cue a screen asked for, whether or not it could sound. */
  readonly lastCue: CueName | null;
  /** Cues asked for, and cues that actually played. */
  readonly cues: number;
  readonly played: number;
  readonly settings: AudioSettings;
}

export interface GameAudio {
  /** A moment that has a sound (null: this one doesn't). */
  cue: (name: CueName | null) => void;
  /** Night on the open map (the Hollow layer's dusk, #21): the night loop. */
  setNight: (night: boolean) => void;
  /** Rows for the lobby's Settings screen: music and sounds. */
  settings: () => Node[];
  readonly debug: AudioDebug;
}

/** Where gestures and visibility come from (tests pass a fake document). */
export type AudioEventTarget = Pick<Document, 'addEventListener' | 'hidden'>;

export interface AudioOptions {
  target?: AudioEventTarget;
  storage?: SettingsStorage | null;
  createContext?: () => AudioContext | null;
  loadEngine?: () => Promise<{
    createEngine: (ctx: AudioContext, volumes: { music: number; sounds: number }) => Engine;
  }>;
  /** Today's date on this device, `YYYY-MM-DD` (Halloween's window). */
  today?: () => string;
}

/** The device's local date as `YYYY-MM-DD`. */
function localDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function defaultContext(): AudioContext | null {
  const g = globalThis as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? new Ctor({ latencyHint: 'interactive' }) : null;
}

/** One silent sample, played inside the unlocking gesture (old iOS needs it). */
function primeSilently(ctx: AudioContext): void {
  const source = ctx.createBufferSource();
  source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  source.connect(ctx.destination);
  source.start(0);
  source.onended = () => {
    source.disconnect();
  };
}

/**
 * iOS 16.4+: an "ambient" audio session mixes with the player's own music and
 * follows the silent switch. Elsewhere this does nothing.
 */
function useAmbientSession(): void {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'ambient';
  } catch {
    // Not supported: the browser's default session applies.
  }
}

export function createAudio(options: AudioOptions = {}): GameAudio {
  const target = options.target ?? document;
  const storage = options.storage === undefined ? safeStorage() : options.storage;
  const today = options.today ?? localDate;
  const loadEngine = options.loadEngine ?? (() => import('./audio-engine.js'));
  let settings = loadAudioSettings(storage);
  let night = false;
  let engine: Engine | null = null;
  /** The context the engine was made for (a closed context gets a new one). */
  let engineCtx: AudioContext | null = null;
  let engineState: AudioDebug['engine'] = 'idle';
  let lastCue: CueName | null = null;
  let cues = 0;
  let played = 0;

  useAmbientSession();
  const unlock = new AudioUnlock<AudioContext>({
    create: options.createContext ?? defaultContext,
    prime: primeSilently,
  });

  const halloween = (): boolean => {
    try {
      return activeSeasons(GAME_DATA.seasons, today()).some((s) => s.id === 'halloween');
    } catch {
      return false;
    }
  };
  const wantedTrack = (): TrackId => pickTrack({ night, halloween: halloween() });

  /** Music plays only while it can be heard. */
  const syncMusic = () => {
    if (!engine) return;
    const audible = effectiveVolumes(settings).music > 0;
    engine.setTrack(audible ? wantedTrack() : null);
  };

  const startEngine = (ctx: AudioContext) => {
    engineCtx = ctx;
    engine = null;
    engineState = 'loading';
    loadEngine().then(
      (module) => {
        if (engineCtx !== ctx) return;
        engine = module.createEngine(ctx, effectiveVolumes(settings));
        engineState = 'ready';
        syncMusic();
      },
      () => {
        if (engineCtx === ctx) engineState = 'failed';
      },
    );
  };

  // The engine loads as soon as a tap has made the context, even while iOS
  // still holds it suspended; it only plays once the context runs.
  unlock.onChange(() => {
    const ctx = unlock.context;
    if (ctx && ctx !== engineCtx) startEngine(ctx);
  });

  const onGesture = () => {
    unlock.gesture();
  };
  for (const type of ['touchend', 'click', 'keydown'] as const) {
    target.addEventListener(type, onGesture, { capture: true, passive: true });
  }
  target.addEventListener('visibilitychange', () => {
    unlock.visibility(target.hidden);
  });

  const cue = (name: CueName | null) => {
    if (!name) return;
    lastCue = name;
    cues += 1;
    if (!engine || unlock.state !== 'running') return;
    if (effectiveVolumes(settings).sounds <= 0) return;
    if (engine.play(name)) played += 1;
  };

  // Every button gives a soft tick (captured, so a handler that stops the
  // click can't swallow it). Runs after the unlock listener above.
  target.addEventListener(
    'click',
    (event) => {
      const el = event.target as { closest?: (selector: string) => unknown } | null;
      if (el?.closest?.('button, [role="button"]')) cue('tick');
    },
    { capture: true, passive: true },
  );

  const update = (next: AudioSettings, save: boolean) => {
    settings = next;
    engine?.setVolumes(effectiveVolumes(settings));
    syncMusic();
    if (save) saveAudioSettings(storage, settings);
  };

  return {
    cue,
    setNight: (next) => {
      if (next === night) return;
      night = next;
      syncMusic();
    },
    settings: () =>
      audioSettingsView({
        current: () => settings,
        change: update,
        preview: () => {
          cue('boop');
        },
      }),
    get debug() {
      return {
        state: unlock.state,
        engine: engineState,
        track: wantedTrack(),
        playing: engine?.track ?? null,
        lastCue,
        cues,
        played,
        settings,
      };
    },
  };
}
