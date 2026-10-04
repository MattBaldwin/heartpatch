import { el } from '../../ui/dom.js';
import { createEngine, renderLoop, type Engine } from '../audio-engine.js';
import { CUE_NAMES, type CueName } from '../cues.js';
import { loopSeconds, SCORES, type TrackId } from '../music-score.js';
import { RECIPES } from '../sfx.js';
import { noiseBuffer } from '../synth.js';
import '../../ui/auth/auth.css';
import './sound-gallery.css';

/**
 * Dev-only sound gallery at `/sounds.html` (tech spec §15): every cue and
 * every music loop, so a human can judge them by ear. Never part of the
 * production build. Tap anything to start sound (iOS needs the tap).
 *
 * `window.__heartpatchSounds.check()` renders every cue and loop offline and
 * reports its length and peak (silence or clipping shows up there).
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
    { type: 'button', class: 'auth-button sound-button', 'data-testid': testid },
    label,
  );
  b.addEventListener('click', onTap);
  return b;
};

const tracks: TrackId[] = ['day', 'night', 'halloween', 'wonder'];
root.append(
  el('h1', { class: 'auth-title' }, 'Sound gallery'),
  el('p', { class: 'auth-subtitle' }, 'Tap to hear. All made in the browser, no files.'),
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
}

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

async function renderCue(cue: CueName): Promise<Report> {
  const rate = 44_100;
  const offline = new OfflineAudioContext(1, rate * 5, rate);
  const length = RECIPES[cue](
    { ctx: offline, noise: noiseBuffer(offline) },
    offline.destination,
    0,
    1,
    1,
  );
  const buffer = await offline.startRendering();
  return { ...measure(cue, buffer), seconds: length };
}

declare global {
  interface Window {
    __heartpatchSounds?: { check(): Promise<Report[]> };
  }
}

window.__heartpatchSounds = {
  check: async () => {
    const reports: Report[] = [];
    for (const cue of CUE_NAMES) reports.push(await renderCue(cue));
    const live = new OfflineAudioContext(1, 1, 22_050);
    for (const id of tracks) {
      const loop = await renderLoop(live, SCORES[id]);
      if (loop) reports.push(measure(`music:${id}`, loop));
    }
    return reports;
  },
};
