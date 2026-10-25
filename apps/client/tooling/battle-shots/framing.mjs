/* global process, console */
// Captures the battle framing on two phones (#652): the same battles, at the
// same frozen clock time, on an iPhone 15 and an iPhone SE, at a pinned
// quality tier. Two steps, so a "before" and an "after" build show the very
// same battles (the arena's layout is seeded from the battle id):
//
//   STEP=start node tooling/battle-shots/framing.mjs   signs up one player per
//     pairing and starts its battle; the sessions go into OUT/sessions.json
//   STEP=shoot LABEL=before node tooling/battle-shots/framing.mjs   shoots
//     every pairing on both phones into OUT/<pairing>-<phone>-<label>.jpg
//
// Swap the client dev server's checkout between two `shoot` runs. Needs the
// dev servers (`pnpm dev` with HP_DEV_SQUISHY_GRANTS=true).
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  battleDev,
  hook,
  launch,
  shoot,
  showBattle,
  signUpAndMakePatch,
  startBattle,
  api,
} from './helpers.mjs';

const OUT = process.env.OUT ?? path.resolve('.battle-shots/framing');
const STEP = process.env.STEP ?? 'shoot';
const LABEL = process.env.LABEL ?? 'now';
const TIER = process.env.TIER ?? 'high';
/**
 * Both at DPR 2 (the game caps its DPR there, CLAUDE.md rule 8), with each
 * phone's safe-area insets (the Dynamic Island and home indicator; the SE's
 * status bar), as #649's captures emulate them.
 */
const PHONES = {
  'iphone-15': { width: 393, height: 852, dpr: 2, insets: { top: 59, bottom: 34 } },
  'iphone-se': { width: 375, height: 667, dpr: 2, insets: { top: 20, bottom: 0 } },
};
/** The idle face-off, a little way in, so the ready stance is mid-bob. */
const AT = 700;

const PAIRINGS = [
  {
    id: 'bristlebloom-gourdon',
    arena: 'pumpkin-fields/dusk',
    mine: { speciesId: 'bristlebloom', level: 30 },
    theirs: { speciesId: 'gourdon', level: 3 },
  },
  {
    // The tallest species in the data against the smallest (camera-director.test.ts).
    id: 'thistleknight-shellnap',
    arena: 'meadow/day',
    mine: { speciesId: 'thistleknight', level: 40 },
    theirs: { speciesId: 'shellnap', level: 3 },
  },
  {
    id: 'emberbun-puddlepuff',
    arena: 'meadow/day',
    mine: { speciesId: 'emberbun', level: 30 },
    theirs: { speciesId: 'puddlepuff', level: 3 },
  },
];

const browser = await launch();
await mkdir(OUT, { recursive: true });
const sessionsFile = path.join(OUT, 'sessions.json');
const phone = PHONES['iphone-15'];
const contextFor = (storageState) =>
  browser.newContext({
    viewport: { width: phone.width, height: phone.height },
    deviceScaleFactor: phone.dpr,
    isMobile: true,
    hasTouch: true,
    ...(storageState ? { storageState } : {}),
  });

if (STEP === 'start') {
  const sessions = {};
  for (const pairing of PAIRINGS) {
    const context = await contextFor(null);
    const page = await context.newPage();
    const mapId = await signUpAndMakePatch(page, `frame_${Date.now().toString(36)}`);
    const care = await api(page, 'GET', `/maps/${mapId}/care`);
    await startBattle(page, mapId, care.body?.squishies?.[0]?.id ?? null, pairing);
    // Open it once, so the last patch is remembered (#160) with the session.
    await showBattle(page, pairing.arena, { tier: TIER });
    sessions[pairing.id] = await context.storageState();
    await context.close();
    console.log(`started ${pairing.id}`);
  }
  await writeFile(sessionsFile, JSON.stringify(sessions));
} else {
  const sessions = JSON.parse(await readFile(sessionsFile, 'utf8'));
  for (const pairing of PAIRINGS) {
    const context = await contextFor(sessions[pairing.id]);
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    const cdp = await context.newCDPSession(page);
    for (const [name, size] of Object.entries(PHONES)) {
      await cdp.send('Emulation.setSafeAreaInsetsOverride', {
        insets: { left: 0, right: 0, ...size.insets },
      });
      await page.setViewportSize({ width: size.width, height: size.height });
      await showBattle(page, pairing.arena, { tier: TIER });
      await battleDev(page, 'set', AT);
      const file = path.join(OUT, `${pairing.id}-${name}-${LABEL}.jpg`);
      const scene = await shoot(page, file);
      const battle = await hook(page, 'battle');
      console.log(
        `${file}  tier=${TIER} draws=${scene?.drawCalls ?? '?'} battle=${battle?.id ?? '?'}`,
      );
    }
    await context.close();
  }
}
await browser.close();
