import { MIX, MUSIC, SFX } from './audio-config.js';
import { DUCKING_CUES, UI_CUES, type CueName } from './cues.js';
import { loopSeconds, SCORES, type Score, type TrackId } from './music-score.js';
import { RECIPES } from './sfx.js';
import { noiseBuffer, playNote } from './synth.js';

// The sound engine (#25, tech spec §15). Loaded lazily after the first tap
// (`audio.ts`), so it never weighs on the first load. Buses for music, SFX
// and UI meet in a master gain with a limiter. Music loops are rendered once
// each on an OfflineAudioContext (on the audio thread, off the render loop)
// and then play as plain looping buffers: no timers or per-frame work.

export interface Engine {
  /** Plays a cue now; false if it was dropped (too many voices, or a repeat too soon). */
  play(cue: CueName): boolean;
  /** Cross-fades to a loop, or fades out (null). Renders the loop the first time. */
  setTrack(track: TrackId | null): void;
  /** Slider levels 0–1 (0 when switched off). */
  setVolumes(volumes: { music: number; sounds: number }): void;
  /** The loop playing (or rendering to play), or null. */
  readonly track: TrackId | null;
}

interface Playing {
  readonly id: TrackId;
  readonly gain: GainNode;
  source: AudioBufferSourceNode | null;
}

type OfflineCtor = new (
  channels: number,
  length: number,
  sampleRate: number,
) => OfflineAudioContext;

function offlineCtor(): OfflineCtor | null {
  const g = globalThis as {
    OfflineAudioContext?: OfflineCtor;
    webkitOfflineAudioContext?: OfflineCtor;
  };
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null;
}

/**
 * Renders a score to one seamless mono loop: notes that ring past the end are
 * folded back over the start, then the loop is levelled to a steady peak.
 */
export async function renderLoop(ctx: BaseAudioContext, score: Score): Promise<AudioBuffer | null> {
  const Offline = offlineCtor();
  if (!Offline) return null;
  const rate = MUSIC.sampleRate;
  const loopLength = Math.round(loopSeconds(score) * rate);
  const offline = new Offline(1, loopLength + Math.round(MUSIC.tailS * rate), rate);
  const spb = 60 / score.bpm;
  for (const note of score.notes) playNote(offline, offline.destination, note, spb);
  const rendered = await offline.startRendering();
  const from = rendered.getChannelData(0);
  const loop = ctx.createBuffer(1, loopLength, rate);
  const to = loop.getChannelData(0);
  to.set(from.subarray(0, loopLength));
  for (let i = loopLength; i < from.length; i += 1) {
    to[i - loopLength] = (to[i - loopLength] ?? 0) + (from[i] ?? 0);
  }
  let peak = 0;
  for (const sample of to) peak = Math.max(peak, Math.abs(sample));
  // TUNE: a steady peak per loop (tech spec §15 asks for loudness matching).
  if (peak > 0) {
    const scale = 0.8 / peak;
    for (let i = 0; i < to.length; i += 1) to[i] = (to[i] ?? 0) * scale;
  }
  return loop;
}

export function createEngine(
  ctx: AudioContext,
  volumes: { music: number; sounds: number },
): Engine {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = MIX.limiterThresholdDb;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  limiter.connect(ctx.destination);
  const master = ctx.createGain();
  master.connect(limiter);

  const musicBus = ctx.createGain();
  const duck = ctx.createGain();
  musicBus.connect(duck);
  duck.connect(master);
  const sfxBus = ctx.createGain();
  sfxBus.connect(master);
  const uiBus = ctx.createGain();
  uiBus.connect(master);

  const kit = { ctx, noise: noiseBuffer(ctx) };
  /** When each voice slot frees up (context time); fixed size, so no allocation per play. */
  const voiceEnds = new Float64Array(SFX.maxVoices);
  const lastPlayed = new Map<CueName, number>();
  const loops = new Map<TrackId, Promise<AudioBuffer | null>>();
  let playing: Playing | null = null;
  let duckUntil = 0;

  const level = (param: AudioParam, value: number, over = 0.05) => {
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + over);
  };

  const setVolumes = (next: { music: number; sounds: number }) => {
    level(musicBus.gain, MIX.music * next.music);
    level(sfxBus.gain, MIX.sfx * next.sounds);
    level(uiBus.gain, MIX.ui * next.sounds);
  };
  setVolumes(volumes);

  const loopFor = (id: TrackId): Promise<AudioBuffer | null> => {
    let loop = loops.get(id);
    if (!loop) {
      loop = renderLoop(ctx, SCORES[id]).catch(() => null);
      loops.set(id, loop);
    }
    return loop;
  };

  const fadeOut = (old: Playing) => {
    const now = ctx.currentTime;
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setValueAtTime(old.gain.gain.value, now);
    old.gain.gain.linearRampToValueAtTime(0, now + MUSIC.crossFadeS);
    if (old.source) {
      old.source.stop(now + MUSIC.crossFadeS + 0.05);
    } else {
      old.gain.disconnect();
    }
  };

  const setTrack = (id: TrackId | null) => {
    if ((playing?.id ?? null) === id) return;
    if (playing) fadeOut(playing);
    playing = null;
    if (!id) return;
    const entry: Playing = { id, gain: ctx.createGain(), source: null };
    entry.gain.gain.value = 0;
    entry.gain.connect(musicBus);
    playing = entry;
    void loopFor(id).then((buffer) => {
      // Changed again while it rendered: this one never starts.
      if (playing !== entry) {
        entry.gain.disconnect();
        return;
      }
      if (!buffer) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
      source.connect(entry.gain);
      source.onended = () => {
        source.disconnect();
        entry.gain.disconnect();
      };
      const now = ctx.currentTime;
      entry.gain.gain.setValueAtTime(0, now);
      entry.gain.gain.linearRampToValueAtTime(1, now + MUSIC.crossFadeS);
      source.start(now);
      entry.source = source;
    });
  };

  const duckFor = (seconds: number) => {
    const now = ctx.currentTime;
    duckUntil = Math.max(duckUntil, now + seconds);
    const gain = duck.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(MUSIC.duckTo, now + MUSIC.duckFadeS);
    gain.setValueAtTime(MUSIC.duckTo, duckUntil);
    gain.linearRampToValueAtTime(1, duckUntil + MUSIC.crossFadeS);
  };

  const play = (cue: CueName): boolean => {
    const now = ctx.currentTime;
    const last = lastPlayed.get(cue);
    if (last !== undefined && now - last < SFX.minRepeatS) return false;
    let slot = -1;
    for (let i = 0; i < voiceEnds.length; i += 1) {
      if ((voiceEnds[i] ?? 0) <= now) {
        slot = i;
        break;
      }
    }
    if (slot < 0) return false;
    const pitch = 1 + (Math.random() * 2 - 1) * SFX.pitchJitter;
    const gain = 1 - Math.random() * SFX.gainJitter;
    const out = UI_CUES.has(cue) ? uiBus : sfxBus;
    const length = RECIPES[cue](kit, out, now, pitch, gain);
    voiceEnds[slot] = now + length;
    lastPlayed.set(cue, now);
    if (DUCKING_CUES.has(cue)) duckFor(length);
    return true;
  };

  return {
    play,
    setTrack,
    setVolumes,
    get track() {
      return playing?.id ?? null;
    },
  };
}
