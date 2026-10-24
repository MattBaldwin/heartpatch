/* global process, console */
// Builds the owner's screens page from a door-glow.mjs run (#306 door glow):
//   node door-glow-page.mjs <shots dir (with glow-stats.json)> <out dir>
// then publish <out dir>/index.html with its img/ folder as an artifact.
// Every caption comes from the run's own stats, so it says only what the frame shows.
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: node door-glow-page.mjs <shots dir> <out dir>');
const HERE = path.dirname(fileURLToPath(import.meta.url));
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'img'), { recursive: true });
for (const f of await readdir(src)) {
  if (/-glow-.*-high\.png$/.test(f)) {
    await copyFile(path.join(src, f), path.join(out, 'img', f));
  }
}
const stats = new Map(
  JSON.parse(await readFile(path.join(src, 'glow-stats.json'), 'utf8')).map((r) => [r.file, r]),
);

const DOORS = [
  { power: 'fire', room: 'Parlour', thing: 'cold fireplace', elem: 'Fire', colour: 'orange' },
  { power: 'leaf', room: 'Conservatory', thing: 'cracked window', elem: 'Leaf', colour: 'green' },
  { power: 'water', room: 'Scullery', thing: 'cosy flames', elem: 'Water', colour: 'blue' },
  { power: 'light', room: 'Blue Bedroom', thing: 'dark closet', elem: 'Light', colour: 'yellow' },
];
const DEVICES = {
  iphone: ['iPhone 15', 393, '393 × 852 pt, insets 59 top / 34 bottom'],
  se: ['iPhone SE', 375, '375 × 667 pt, insets 20 top / 0 bottom'],
};
const esc = (t) =>
  String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const clean = (t) => (t ?? '').replace(/\u00a0/g, ' ').trim();

function caption(d, door, state, r) {
  const [name] = DEVICES[d];
  const parts = [];
  const bubble = clean(r.bubble);
  const action = clean(r.action);
  parts.push(bubble ? `a bubble reading “${bubble}”` : 'no bubble');
  parts.push(action ? `a button reading “${action}”` : 'no button');
  const light = r.doorLights?.[0];
  const away =
    light && r.keeper
      ? Math.hypot(r.keeper.x - light.at.x, r.keeper.z - light.at.z).toFixed(1)
      : null;
  const lead =
    state === 'asleep'
      ? `${door.room}, the ${door.thing} door still asleep, the Keeper at it.`
      : `${door.room}, the ${door.thing} door just woken by a ${door.elem} friend.`;
  const glow = light
    ? ` ${door.colour === 'orange' ? 'An' : 'A'} ${door.colour} glow lights the door, centred ${Math.round((light.doorway.cx / r.viewport.w) * 100)}% across and ${Math.round((light.doorway.cy / r.viewport.h) * 100)}% down the screen, with a soft spill at the foot of the wall; the dark is cut away round it so the door shows, and the rest of the room stays dark.`
    : '';
  const keeper = away ? ` The Keeper stands ${away} m from the door.` : '';
  const echoes = r.echoes?.length
    ? ` ${r.echoes.length === 1 ? 'A wandering echo’s eyes show' : 'Wandering echoes’ eyes show'} (random; they can differ between phones).`
    : '';
  return `${name}. ${lead} Same fixed camera view of the door as the ${state === 'asleep' ? 'woken' : 'asleep'} frame.${glow}${keeper} On screen: ${parts.join(' and ')}.${echoes}`;
}

function figure(d, door, state) {
  const [name, width, spec] = DEVICES[d];
  const file = `${d}-glow-${door.power}-${state}-high.png`;
  const r = stats.get(file);
  if (!r) throw new Error(`no stats for ${file}`);
  const label = state === 'asleep' ? 'Asleep' : 'Just woken';
  return (
    `<figure><img src="img/${file}" width="${width}" alt="${esc(name)}: ${door.power} door ${state}">` +
    `<figcaption><b>${label}</b> · ${esc(caption(d, door, state, r))} ` +
    `<span class="pin">?tier=${esc(r.tier)} pinned · ${esc(spec)}</span></figcaption></figure>`
  );
}

const sections = DOORS.map((door) => {
  const row = Object.keys(DEVICES)
    .flatMap((d) => ['asleep', 'woke'].map((state) => figure(d, door, state)))
    .join('');
  return `<section><h2>${door.elem} · ${door.room}</h2><div class="grid">${row}</div></section>`;
}).join('');
const template = await readFile(path.join(HERE, 'door-glow-page.html'), 'utf8');
await writeFile(path.join(out, 'index.html'), template.replace('@@SECTIONS@@', sections));
console.log('ok', stats.size);
