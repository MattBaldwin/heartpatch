import { MIX, MUSIC, SFX } from './audio-config.js';
import { DUCKING_CUES, UI_CUES, type CueName } from './cues.js';
import {
  loadInstruments,
  playSampled,
  voiceBuses,
  type InstrumentBank,
  type InstrumentId,
  type InstrumentNote,
} from './music-samples.js';
import { loopSeconds, SCORES, type Score, type TrackId } from './music-score.js';
import { recordingFor } from './recorded.js';
import { fetchBytes, loadSamples, type FetchBytes, type SampleId } from './samples.js';
import { RECIPES } from './sfx.js';
import { noiseBuffer, playNote, roomImpulse } from './synth.js';

// The sound engine (#25, tech spec §15). Loaded lazily after the first tap
// (`audio.ts`), so it never weighs on the first load. Buses for music, SFX
// and UI meet in a master gain with a limiter. Music loops are rendered once
// each on an OfflineAudioContext (on the audio thread, off the render loop)
// and then play as plain looping buffers: no timers or per-frame work.
// The big moments' recorded hits (#653) start loading when the engine is made
// (after the first tap); each plays its synth stand-in until they're in.
// So do the music's instrument notes (#664): a loop waits a few seconds for
// them, renders with the synth if they're late, and is re-rendered and
// cross-faded in place (same spot in the tune) once they arrive.

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
  /** Context time the loop's first beat played (or would have). */
  startedAt: number;
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
 * folded back over the start, then the loop is levelled to a steady loudness.
 * Each note plays its sampled instrument from `bank` (#664), or the synth if
 * that instrument isn't loaded.
 */
export async function renderLoop(
  ctx: BaseAudioContext,
  score: Score,
  bank: InstrumentBank = new Map(),
): Promise<AudioBuffer | null> {
  const Offline = offlineCtor();
  if (!Offline) return null;
  const rate = MUSIC.sampleRate;
  const loopLength = Math.round(loopSeconds(score) * rate);
  const offline = new Offline(1, loopLength + Math.round(MUSIC.tailS * rate), rate);
  const spb = 60 / score.bpm;
  const buses = voiceBuses(offline, offline.destination);
  const hiss = noiseBuffer(offline);
  for (const note of score.notes) {
    if (!playSampled(offline, buses, bank, note, spb)) {
      playNote(offline, offline.destination, note, spb, hiss);
    }
  }
  const rendered = await offline.startRendering();
  const from = rendered.getChannelData(0);
  const loop = ctx.createBuffer(1, loopLength, rate);
  const to = loop.getChannelData(0);
  to.set(from.subarray(0, loopLength));
  for (let i = loopLength; i < from.length; i += 1) {
    to[i - loopLength] = (to[i - loopLength] ?? 0) + (from[i] ?? 0);
  }
  let peak = 0;
  let power = 0;
  for (const sample of to) {
    peak = Math.max(peak, Math.abs(sample));
    power += sample * sample;
  }
  // One loudness for every loop (tech spec §15), never past the peak cap.
  if (peak > 0) {
    const rms = Math.sqrt(power / to.length);
    const scale = Math.min(MUSIC.rms / rms, MUSIC.peak / peak);
    for (let i = 0; i < to.length; i += 1) to[i] = (to[i] ?? 0) * scale;
  }
  return loop;
}

/** The context the music's notes decode on: the loops' own rate, so they stay small. */
function decodeContext(ctx: BaseAudioContext): BaseAudioContext {
  const Offline = offlineCtor();
  return Offline ? new Offline(1, 1, MUSIC.sampleRate) : ctx;
}

export function createEngine(
  ctx: AudioContext,
  volumes: { music: number; sounds: number },
  fetcher: FetchBytes = fetchBytes,
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
  // A light room reverb (#653): SFX and UI send a little into it, and the
  // music (#664) a touch more, after its duck so the room dips with it.
  const reverb = ctx.createConvolver();
  reverb.buffer = roomImpulse(ctx, MIX.reverbS);
  reverb.connect(master);
  for (const [bus, amount] of [
    [sfxBus, MIX.sfxReverb],
    [uiBus, MIX.uiReverb],
    [duck, MIX.musicReverb],
  ] as const) {
    const send = ctx.createGain();
    send.gain.value = amount;
    bus.connect(send);
    send.connect(reverb);
  }

  const samples = new Map<SampleId, AudioBuffer>();
  void loadSamples(ctx, samples, fetcher);
  const kit = { ctx, noise: noiseBuffer(ctx), samples };
  /** When each voice slot frees up (context time); fixed size, so no allocation per play. */
  const voiceEnds = new Float64Array(SFX.maxVoices);
  const lastPlayed = new Map<CueName, number>();
  const instruments = new Map<InstrumentId, readonly InstrumentNote[]>();
  let instrumentsIn = false;
  const instrumentsLoaded = loadInstruments(decodeContext(ctx), instruments, fetcher).then(() => {
    instrumentsIn = true;
  });
  /** Settles once the notes are in, or after the wait (a slow first visit plays the synth). */
  const instrumentsOrWait = Promise.race([
    instrumentsLoaded,
    new Promise<void>((resolve) => setTimeout(resolve, MUSIC.instrumentWaitS * 1000)),
  ]);
  const loops = new Map<TrackId, Promise<AudioBuffer | null>>();
  /** Loops rendered before the instruments were in, to redo once they are. */
  const synthLoops = new Set<TrackId>();
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
      loop = instrumentsOrWait
        .then(() => {
          if (!instrumentsIn) synthLoops.add(id);
          return renderLoop(ctx, SCORES[id], instruments);
        })
        .catch(() => null);
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

  /** Starts `buffer` looping into `entry`, `offset` seconds into the tune, fading in. */
  const startLoop = (entry: Playing, buffer: AudioBuffer, offset: number) => {
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
    source.start(now, offset);
    entry.source = source;
    entry.startedAt = now - offset;
  };

  const newEntry = (id: TrackId): Playing => {
    const entry: Playing = { id, gain: ctx.createGain(), source: null, startedAt: 0 };
    entry.gain.gain.value = 0;
    entry.gain.connect(musicBus);
    return entry;
  };

  const setTrack = (id: TrackId | null) => {
    if ((playing?.id ?? null) === id) return;
    if (playing) fadeOut(playing);
    playing = null;
    if (!id) return;
    const entry = newEntry(id);
    playing = entry;
    void loopFor(id).then((buffer) => {
      // Changed again while it rendered: this one never starts.
      if (playing !== entry) {
        entry.gain.disconnect();
        return;
      }
      if (buffer) startLoop(entry, buffer, 0);
    });
  };

  // The instruments came in after a loop had to render with the synth: redo
  // those loops, and swap the one playing for its new self at the same spot.
  void instrumentsLoaded.then(() => {
    if (synthLoops.size === 0 || instruments.size === 0) return;
    const current = playing;
    // Let the synth render in progress finish (and start) first.
    const before = current ? loops.get(current.id) : undefined;
    for (const id of synthLoops) loops.delete(id);
    synthLoops.clear();
    if (!current) return;
    void Promise.resolve(before)
      .then(() => loopFor(current.id))
      .then((buffer) => {
        if (!buffer || playing !== current || !current.source) return;
        const offset = (ctx.currentTime - current.startedAt) % buffer.duration;
        fadeOut(current);
        const entry = newEntry(current.id);
        playing = entry;
        startLoop(entry, buffer, offset);
      });
  });

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
    const recording = recordingFor(cue, samples);
    const jitter = recording ? SFX.recordedPitchJitter : SFX.pitchJitter;
    const pitch = 1 + (Math.random() * 2 - 1) * jitter;
    const gain = 1 - Math.random() * SFX.gainJitter;
    const out = UI_CUES.has(cue) ? uiBus : sfxBus;
    const length = recording
      ? recording.play(kit, out, now, pitch, gain)
      : RECIPES[cue](kit, out, now, pitch, gain);
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
