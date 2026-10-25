import { buttonClass } from '../../ui/button/button.js';
import { el } from '../../ui/dom.js';
import { MIX, MUSIC } from '../audio-config.js';
import { createEngine, renderLoop, type Engine } from '../audio-engine.js';
import { CUE_NAMES, type CueName } from '../cues.js';
import { loadInstruments, type InstrumentId, type InstrumentNote } from '../music-samples.js';
import { loopSeconds, SCORES, type TrackId } from '../music-score.js';
import { RECORDED } from '../recorded.js';
import { loadSamples, type SampleId } from '../samples.js';
import { RECIPES } from '../sfx.js';
import { noiseBuffer, roomImpulse } from '../synth.js';
import '../../ui/auth/auth.css';
import './sound-gallery.css';

/**
 * Dev-only sound gallery at `/sounds.html` (tech spec §15): every cue and
 * every music loop, so a human can judge them by ear. Never part of the
 * production build. Tap anything to start sound (iOS needs the tap).
 *
 * `window.__heartpatchSounds.check()` renders every cue and loop offline and
 * reports its length and peak (silence or clipping shows up there), and how
 * long each loop took to render. `capture(track, seconds)` renders a loop as
 * the game plays it, through the music's reverb send, for
 * `tooling/music-capture` (#664).
 */

if (!import.meta.env.DEV) throw new Error('The sound gallery is dev-only');

const root = document.querySelector<HTMLElement>('#sounds');
if (!root) throw new Error('missing #sounds');

let ctx: AudioContext | null = null;
let engine: Engine | null = null;

function start(): Engine {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    engine = createEngine(ctx, { music: 1, sounds: 1 });
  }
  void ctx.resume();
  if (!engine) throw new Error('no engine');
  return engine;
}

const button = (label: string, onTap: () => void, testid: string) => {
  const b = el(
    'button',
    { type: 'button', class: buttonClass({ variant: 'primary' }), 'data-testid': testid },
    label,
  );
  b.addEventListener('click', onTap);
  return b;
};

const tracks: TrackId[] = ['day', 'night', 'halloween', 'wonder'];
root.append(
  el('h1', { class: 'auth-title' }, 'Sound gallery'),
  el(
    'p',
    { class: 'auth-subtitle' },
    'Tap to hear. Made in the browser; the big moments layer a few CC0 recorded hits (#653) and the music plays CC0 instrument notes (#664).',
  ),
  el('h2', {}, 'Music'),
  el(
    'div',
    { class: 'sound-grid' },
    ...tracks.map((id) =>
      button(
        `${id} (${loopSeconds(SCORES[id]).toFixed(1)} s)`,
        () => {
          start().setTrack(id);
        },
        `track-${id}`,
      ),
    ),
    button(
      'Stop music',
      () => {
        start().setTrack(null);
      },
      'track-stop',
    ),
  ),
  el('h2', {}, 'Sounds'),
  el(
    'div',
    { class: 'sound-grid' },
    ...CUE_NAMES.map((cue) => button(cue, () => start().play(cue), `cue-${cue}`)),
  ),
);

interface Report {
  readonly name: string;
  readonly seconds: number;
  readonly peak: number;
  readonly finite: boolean;
  /** Loops only: how long the offline render took. */
  readonly renderMs?: number;
}

interface Capture {
  readonly rate: number;
  readonly loopS: number;
  readonly renderMs: number;
  readonly samples: number[];
}

/** The music's instrument notes, decoded once at the loops' rate. */
let instruments: Promise<Map<InstrumentId, readonly InstrumentNote[]>> | null = null;
const loadedInstruments = () => {
  instruments ??= (async () => {
    const bank = new Map<InstrumentId, readonly InstrumentNote[]>();
    await loadInstruments(new OfflineAudioContext(1, 1, MUSIC.sampleRate), bank);
    return bank;
  })();
  return instruments;
};

function measure(name: string, buffer: AudioBuffer): Report {
  let peak = 0;
  let finite = true;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    for (const s of buffer.getChannelData(c)) {
      if (!Number.isFinite(s)) finite = false;
      else peak = Math.max(peak, Math.abs(s));
    }
  }
  return { name, seconds: buffer.duration, peak, finite };
}

/** Renders a cue's synth recipe, or with `recorded`, its recording (#653) from those hits. */
async function renderCue(
  cue: CueName,
  recorded?: ReadonlyMap<SampleId, AudioBuffer>,
): Promise<Report> {
  const rate = 44_100;
  const offline = new OfflineAudioContext(1, rate * 5, rate);
  const kit = { ctx: offline, noise: noiseBuffer(offline), samples: recorded ?? new Map() };
  const recording = recorded ? RECORDED[cue] : undefined;
  const length = recording
    ? recording.play(kit, offline.destination, 0, 1, 1)
    : RECIPES[cue](kit, offline.destination, 0, 1, 1);
  const buffer = await offline.startRendering();
  const name = recording ? `recorded:${cue}` : cue;
  return { ...measure(name, buffer), seconds: length };
}

declare global {
  interface Window {
    __heartpatchSounds?: {
      check(): Promise<Report[]>;
      capture(track: TrackId, seconds: number): Promise<Capture>;
    };
  }
}

window.__heartpatchSounds = {
  check: async () => {
    const reports: Report[] = [];
    for (const cue of CUE_NAMES) reports.push(await renderCue(cue));
    // The big moments' recordings too (#653), from the decoded hits.
    const samples = new Map<SampleId, AudioBuffer>();
    await loadSamples(new OfflineAudioContext(1, 1, 44_100), samples);
    for (const cue of CUE_NAMES) {
      if (RECORDED[cue]) reports.push(await renderCue(cue, samples));
    }
    const live = new OfflineAudioContext(1, 1, MUSIC.sampleRate);
    const bank = await loadedInstruments();
    for (const id of tracks) {
      // The synth stand-in (before the notes load), then the instruments (#664).
      for (const [name, notes] of [
        [`music:${id}:synth`, new Map()],
        [`music:${id}`, bank],
      ] as const) {
        const started = performance.now();
        const loop = await renderLoop(live, SCORES[id], notes);
        const renderMs = Math.round(performance.now() - started);
        if (loop) reports.push({ ...measure(name, loop), renderMs });
      }
    }
    return reports;
  },
  capture: async (id, seconds) => {
    const started = performance.now();
    const bank = await loadedInstruments();
    const rate = MUSIC.sampleRate;
    const loop = await renderLoop(new OfflineAudioContext(1, 1, rate), SCORES[id], bank);
    if (!loop) throw new Error('no OfflineAudioContext');
    const renderMs = Math.round(performance.now() - started);
    const offline = new OfflineAudioContext(1, Math.round(seconds * rate), rate);
    const source = offline.createBufferSource();
    source.buffer = loop;
    source.loop = true;
    source.loopEnd = loop.duration;
    const reverb = offline.createConvolver();
    reverb.buffer = roomImpulse(offline, MIX.reverbS);
    const send = offline.createGain();
    send.gain.value = MIX.musicReverb;
    source.connect(offline.destination);
    source.connect(send);
    send.connect(reverb);
    reverb.connect(offline.destination);
    source.start(0);
    const out = await offline.startRendering();
    return { rate, loopS: loop.duration, renderMs, samples: Array.from(out.getChannelData(0)) };
  },
};
