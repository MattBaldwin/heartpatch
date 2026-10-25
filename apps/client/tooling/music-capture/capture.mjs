/* global process, console, window, Buffer, OfflineAudioContext */
// Captures each music loop as the game plays it, for the owner's
// before/after listening page (#664). Dev tooling only:
// `node tooling/music-capture/capture.mjs` with the client dev server
// running (BASE, default http://localhost:5173). Writes one mono WAV per
// loop to OUT (default .music-capture), at the loops' render rate, through
// the music bus's reverb send when there is one. Each runs SECONDS long, or
// by default its loop and 5 s past the seam (45 to 64 s), so the seam is heard.
//
// It drives the dev sound gallery's `__heartpatchSounds.capture` hook. On an
// older commit without that hook (the "before" side), it renders the loop
// itself from the engine module and repeats it: music had no reverb then.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = process.env.OUT ?? path.resolve('.music-capture');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const SECONDS = process.env.SECONDS ? Number(process.env.SECONDS) : null;
const TRACKS = (process.env.TRACKS ?? 'day,night,halloween,wonder').split(',');

/** 16-bit mono PCM WAV. */
function wav(samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) =>
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2),
  );
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_EXECUTABLE || undefined,
});
const page = await browser.newPage();
await page.goto(`${BASE}/sounds.html`);
await mkdir(OUT, { recursive: true });
for (const id of TRACKS) {
  const started = Date.now();
  const result = await page.evaluate(
    async ({ id, wanted }) => {
      const score = await import('/src/audio/music-score.ts');
      const seconds = wanted ?? Math.min(64, Math.max(45, score.loopSeconds(score.SCORES[id]) + 5));
      const hook = window.__heartpatchSounds;
      if (hook?.capture) return hook.capture(id, seconds);
      const engine = await import('/src/audio/audio-engine.ts');
      const ctx = new OfflineAudioContext(1, 1, 22_050);
      const loop = await engine.renderLoop(ctx, score.SCORES[id]);
      const one = loop.getChannelData(0);
      const out = new Float32Array(Math.round(seconds * loop.sampleRate));
      for (let i = 0; i < out.length; i += 1) out[i] = one[i % one.length];
      return { rate: loop.sampleRate, loopS: loop.duration, samples: Array.from(out) };
    },
    { id, wanted: SECONDS },
  );
  const file = path.join(OUT, `${id}.wav`);
  await writeFile(file, wav(result.samples, result.rate));
  console.log(
    `${id}: loop ${result.loopS.toFixed(1)} s, ${String(Date.now() - started)} ms -> ${file}`,
  );
}
await browser.close();
