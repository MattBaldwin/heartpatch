import type { KeeperBodyType, KeeperFaceShape } from '@heartpatch/shared';

// The Keeper creator's steps (#372, owner-approved order): one per screen,
// with Back and Next. The starter outfit rides on the body step. Every step
// starts on a sensible pick, so a kid can tap Next all the way through; the
// step tabs jump straight to any of them.

export const KEEPER_STEPS = ['face', 'body', 'skin', 'hairstyle', 'hairColor', 'details'] as const;
export type KeeperStep = (typeof KEEPER_STEPS)[number];

/** The step after `step`, or null on the last one. */
export function nextStep(step: KeeperStep): KeeperStep | null {
  return KEEPER_STEPS[KEEPER_STEPS.indexOf(step) + 1] ?? null;
}

/** The step before `step`, or null on the first one. */
export function previousStep(step: KeeperStep): KeeperStep | null {
  const i = KEEPER_STEPS.indexOf(step);
  return i > 0 ? (KEEPER_STEPS[i - 1] ?? null) : null;
}

/** Tile drawings are this many px square (the SVG view box). */
const TILE = 48;
const ink = '#4a3150';
const round = (n: number) => Math.round(n * 10) / 10;

/**
 * A face shape's tile (#372): its head as an outline, as wide and tall as
 * the head is for its size, filled with the skin tone picked so far.
 */
export function faceTileSvg(face: KeeperFaceShape, skin: string): string {
  // Sizes run 0.38–0.6 of the Keeper's height: the biggest nearly fills the tile.
  const ry = (face.head / 0.6) * (TILE * 0.42);
  const rx = ry * face.headShape;
  const c = TILE / 2;
  return (
    `<svg viewBox="0 0 ${String(TILE)} ${String(TILE)}" aria-hidden="true">` +
    `<ellipse cx="${String(c)}" cy="${String(c)}" rx="${String(round(rx))}" ry="${String(round(ry))}" fill="${skin}" stroke="${ink}" stroke-width="1.5"/>` +
    `<circle cx="${String(round(c - rx * 0.36))}" cy="${String(c)}" r="1.8" fill="${ink}"/>` +
    `<circle cx="${String(round(c + rx * 0.36))}" cy="${String(c)}" r="1.8" fill="${ink}"/>` +
    `<path d="M${String(round(c - rx * 0.22))} ${String(round(c + ry * 0.36))} q${String(round(rx * 0.22))} ${String(round(ry * 0.2))} ${String(round(rx * 0.44))} 0" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linecap="round"/>` +
    `</svg>`
  );
}

/**
 * A body type's tile (#372): a little standing figure in the body's
 * proportions (feet on the bottom edge, the tallest filling the tile), in
 * the skin tone and outfit top picked so far.
 */
export function bodyTileSvg(body: KeeperBodyType, skin: string, top: string): string {
  // To one scale, so a taller body is a taller figure: legs, body and head
  // of the tallest stack to about 1.15 Keeper heights. TUNE: if a body
  // outgrows the tile.
  const u = (body.height * (TILE - 2)) / 1.15;
  const legs = body.legs * u;
  const th = body.torsoHeight * u;
  const tw = body.torsoWidth * u * (1 + 0.15 * body.roundness);
  const limb = Math.max(body.limbs * u, 2.4);
  const d = body.head * u;
  const c = TILE / 2;
  const floor = TILE - 2;
  const hip = floor - legs;
  const shoulder = hip - th;
  const headY = shoulder - d * 0.45;
  const r = Math.min(tw / 2, th / 2) * (0.35 + 0.65 * body.roundness);
  const arm = body.arms * u;
  return (
    `<svg viewBox="0 0 ${String(TILE)} ${String(TILE)}" aria-hidden="true">` +
    [-1, 1]
      .map((side) => {
        const legX = String(round(c + side * tw * 0.24));
        const leg = `x1="${legX}" y1="${String(round(hip))}" x2="${legX}" y2="${String(round(floor - limb / 2))}"`;
        const armLine = `x1="${String(round(c + side * (tw / 2 - limb * 0.2)))}" y1="${String(round(shoulder + limb * 0.6))}" x2="${String(round(c + side * (tw / 2 + arm * 0.24)))}" y2="${String(round(shoulder + arm * 0.97))}"`;
        // An ink line under a skin line: an outlined limb.
        const limbOf = (at: string) =>
          `<line ${at} stroke="${ink}" stroke-width="${String(round(limb + 2.4))}" stroke-linecap="round"/>` +
          `<line ${at} stroke="${skin}" stroke-width="${String(round(limb))}" stroke-linecap="round"/>`;
        return limbOf(leg) + limbOf(armLine);
      })
      .join('') +
    `<rect x="${String(round(c - tw / 2))}" y="${String(round(shoulder))}" width="${String(round(tw))}" height="${String(round(th))}" rx="${String(round(r))}" fill="${top}" stroke="${ink}" stroke-width="1.2"/>` +
    `<circle cx="${String(c)}" cy="${String(round(headY))}" r="${String(round(d / 2))}" fill="${skin}" stroke="${ink}" stroke-width="1.2"/>` +
    `</svg>`
  );
}
