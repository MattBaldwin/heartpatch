/* global process, console, window */
// Captures the battle screen from the real game at iPhone and iPad sizes with
// headless Chromium (SwiftShader WebGL), for the owner to judge the look. Dev
// tooling only: `node tooling/battle-shots/shoot.mjs` with the dev servers
// running (`pnpm dev` with HP_DEV_SQUISHY_GRANTS=true). It signs up a player
// per device, makes a patch, and for every moment starts a dev battle, reloads
// the page with `?battle-clock=manual&battle-arena=<terrain>/<time>`, taps the
// move, and steps the battle clock to the exact frame before each shot. Writes
// JPEGs and a stats JSON (draw calls per moment) into OUT. The default
// Chromium path is the preinstalled one in the build container; set
// PW_CHROMIUM_EXECUTABLE elsewhere.
import { GAME_DATA } from '@heartpatch/shared';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { api, battleDev, hook, launch, openBattle, shoot, signUpAndMakePatch } from './helpers.mjs';

const OUT = process.env.OUT ?? path.resolve('.battle-shots');
const ALL_DEVICES = {
  iphone: { width: 390, height: 844, dpr: 2 },
  ipad: { width: 1180, height: 820, dpr: 2 },
};
const DEVICES = (process.env.DEVICES ?? 'iphone,ipad').split(',');
const ONLY = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;

/** The move step's length and the hit step's, as the client plays them (battle-config.ts). */
const MOVE_MS = 650;
const HIT_MS = 800;
const TUCKERED_MS = 1100;
const CAPTURE_MS = 1300;

/**
 * Every moment to capture: who fights where, what to tap, and the battle
 * clock times (ms after the tap's first step starts) to freeze at.
 */
const MOMENTS = [
  {
    id: 'idle',
    label: 'Idle face-off (the HUD)',
    arena: 'meadow/day',
    mine: { speciesId: 'emberbun', level: 30 },
    theirs: { speciesId: 'puddlepuff', level: 3 },
    tap: null,
    frames: [{ id: 'idle', at: 700 }],
  },
  ...attack('fire', 'pumpkin-fields/dusk', 'emberbun', 'puddlepuff', 'ember-boop'),
  ...attack('water', 'lake/day', 'puddlepuff', 'emberbun', 'giggle-drizzle'),
  ...attack('leaf', 'forest/day', 'thistlepip', 'pebblesnooze', 'leafy-tickle'),
  {
    id: 'charm',
    label: 'Heart Charm throw',
    arena: 'hills/day',
    mine: { speciesId: 'emberbun', level: 30 },
    theirs: { speciesId: 'thistlepip', level: 1 },
    tap: { testId: 'battle-capture' },
    frames: [
      { id: 'charm-throw', at: CAPTURE_MS * 0.18 },
      { id: 'charm-wobble', at: CAPTURE_MS * 0.6 },
    ],
  },
  {
    id: 'ko',
    label: 'Tuckered out',
    arena: 'old-forest/night',
    mine: { speciesId: 'emberbun', level: 60 },
    theirs: { speciesId: 'puddlepuff', level: 1 },
    tap: { move: 'toasty-tumble' },
    frames: [
      { id: 'ko-flop', at: MOVE_MS + HIT_MS + TUCKERED_MS * 0.75 },
      { id: 'ko-down', at: MOVE_MS + HIT_MS + TUCKERED_MS + 300 },
    ],
  },
  {
    id: 'reduced',
    label: 'Reduced motion: fire impact',
    arena: 'pumpkin-fields/dusk',
    mine: { speciesId: 'emberbun', level: 30 },
    theirs: { speciesId: 'puddlepuff', level: 3 },
    tap: { move: 'ember-boop' },
    reducedMotion: true,
    frames: [
      { id: 'reduced-impact', at: MOVE_MS + 40 },
      { id: 'reduced-react', at: MOVE_MS + 300 },
    ],
  },
];

function attack(element, arena, mine, theirs, move) {
  return [
    {
      id: element,
      label: `${element} attack`,
      arena,
      mine: { speciesId: mine, level: 30 },
      theirs: { speciesId: theirs, level: 3 },
      tap: { move },
      frames: [
        { id: `${element}-anticipation`, at: MOVE_MS * 0.3 },
        { id: `${element}-dash`, at: MOVE_MS * 0.55 },
        // The hit-stop is 120 ms × the hit's strength (up to 1.5): the flash
        // during it, then the burst and the knockback right after.
        { id: `${element}-hitstop`, at: MOVE_MS + 60 },
        { id: `${element}-impact`, at: MOVE_MS + 230 },
        { id: `${element}-react`, at: MOVE_MS + 400 },
        { id: `${element}-settle`, at: MOVE_MS + 750 },
      ],
    },
  ];
}

const moveName = (id) => GAME_DATA.moves.find((m) => m.id === id)?.name ?? id;

await mkdir(OUT, { recursive: true });
const browser = await launch();
const stats = [];
for (const device of DEVICES) {
  const size = ALL_DEVICES[device];
  for (const reduced of [false, true]) {
    const moments = MOMENTS.filter(
      (m) => Boolean(m.reducedMotion) === reduced && (!ONLY || ONLY.has(m.id)),
    );
    if (moments.length === 0) continue;
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.dpr,
      isMobile: true,
      hasTouch: true,
      reducedMotion: reduced ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    const name = `shot_${Date.now().toString(36)}${device[0]}${reduced ? 'r' : ''}`;
    const mapId = await signUpAndMakePatch(page, name);
    const care = await api(page, 'GET', `/maps/${mapId}/care`);
    const starterId = care.body?.squishies?.[0]?.id ?? null;
    for (const moment of moments) {
      const started = Date.now();
      await openBattle(page, mapId, starterId, moment);
      // Idle: a little way in, so the ready stance and motes are mid-bob.
      const dev = (fn, ms) => battleDev(page, fn, ms);
      await dev('set', 400);
      let t0 = 400;
      if (moment.tap) {
        const button = moment.tap.move
          ? page.getByTestId('battle-move').filter({ hasText: moveName(moment.tap.move) })
          : page.getByTestId(moment.tap.testId);
        await button.click();
        // The server replies and the log starts playing on the frozen clock.
        await page.waitForFunction(
          () => {
            const b = window.__heartpatch?.battle?.();
            return b && !b.waiting && b.scene?.playing;
          },
          null,
          { timeout: 60_000 },
        );
        t0 = (await hook(page, 'battle')).clock;
      }
      for (const frame of moment.frames) {
        await dev('set', t0 + frame.at);
        const file = path.join(OUT, `${frame.id}-${device}.jpg`);
        const scene = await shoot(page, file);
        const b = await hook(page, 'battle');
        stats.push({
          id: frame.id,
          moment: moment.label,
          device,
          reduced,
          arena: moment.arena,
          at: frame.at,
          playing: b?.scene?.playing ?? null,
          drawCalls: scene?.drawCalls ?? null,
          effects: scene?.effects ?? null,
          props: scene?.arena?.props ?? null,
          meshes: scene?.meshes ?? null,
        });
        console.log(
          `${frame.id}-${device}  draws=${scene?.drawCalls ?? '?'} playing=${JSON.stringify(b?.scene?.playing)}`,
        );
      }
      // Let the turn finish on the frozen clock, so the next moment starts clean.
      await dev('set', t0 + 20_000);
      console.log(
        `${moment.id} (${device}${reduced ? ', reduced' : ''}) in ${Date.now() - started} ms`,
      );
    }
    await context.close();
  }
}
await browser.close();
await writeFile(path.join(OUT, 'stats.json'), JSON.stringify(stats, null, 2));
console.log(`wrote ${stats.length} shots to ${OUT}`);
