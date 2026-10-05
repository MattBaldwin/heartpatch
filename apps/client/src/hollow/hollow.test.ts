import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { findAvoidedWords, STARTERS, type MorningReport } from '@heartpatch/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { testView } from '../map/test-view.js';
import { VISIT_KEYS, visitFrames } from '../procedural/hollow-man/hollow-man-config.js';
import { NIGHT_LOOK } from './hollow-config.js';
import { HollowLayer } from './hollow-layer.js';
import { changesMyFire, HOLLOW_TEXT, reportText, unseenReports } from './hollow-report.js';

const ID = (n: number) => `0190a8c4-0000-7000-8000-0000000002${String(n).padStart(2, '0')}`;
const taken = (n: number, inHollow = true) => ({
  squishyId: ID(n),
  speciesId: STARTERS.speciesIds[0]!,
  nickname: null,
  inHollow,
});
const night = (date: string, extra: Partial<MorningReport> = {}): MorningReport => ({
  night: date,
  taken: null,
  sheltered: 0,
  exposed: 0,
  ...extra,
});

describe('the fire hint', () => {
  it('asks again when one of my buildings changes, not someone else’s or anything else', () => {
    const me = ID(1);
    expect(changesMyFire({ type: 'building.fueled', data: { userId: me } }, me)).toBe(true);
    expect(changesMyFire({ type: 'building.placed', data: { userId: me } }, me)).toBe(true);
    expect(changesMyFire({ type: 'building.removed', data: { userId: me } }, me)).toBe(true);
    expect(changesMyFire({ type: 'building.fueled', data: { userId: ID(2) } }, me)).toBe(false);
    expect(changesMyFire({ type: 'squishy.housed', data: { userId: me } }, me)).toBe(false);
  });
});

describe('the morning report', () => {
  it('tells only nights the player has not seen, and only ones with news', () => {
    const reports = [
      night('2026-10-31', { taken: taken(1), exposed: 1 }),
      night('2026-10-30', { sheltered: 2 }),
      night('2026-10-29'), // they had nobody there
      night('2026-10-28', { exposed: 1 }), // out in the dark, but spared (grace, #134)
    ];
    expect(unseenReports(reports, null).map((r) => r.night)).toEqual([
      '2026-10-31',
      '2026-10-30',
      '2026-10-28',
    ]);
    expect(unseenReports(reports, '2026-10-30').map((r) => r.night)).toEqual(['2026-10-31']);
    expect(unseenReports(reports, '2026-10-31')).toEqual([]);
  });

  it('says he let them be on a grace night, and asks for a fire (#134)', () => {
    expect(reportText([night('2026-10-28', { exposed: 1 })], () => '')).toEqual({
      title: HOLLOW_TEXT.passedBy,
      lines: [HOLLOW_TEXT.spared, HOLLOW_TEXT.fireHint],
    });
    // Once someone is taken, that line is the news; the spared night needs no line of its own.
    const mixed = reportText(
      [night('2026-10-31', { taken: taken(1), exposed: 1 }), night('2026-10-30', { exposed: 1 })],
      () => 'Moonpuff',
    );
    expect(mixed.lines).toEqual(['He took Moonpuff to the Hollow. You can rescue them!']);
  });

  it('always follows "taken to the Hollow" with "you can rescue them"', () => {
    const one = reportText([night('2026-10-31', { taken: taken(1) })], () => 'Moonpuff');
    expect(one).toEqual({
      title: HOLLOW_TEXT.visitedOne,
      lines: ['He took Moonpuff to the Hollow. You can rescue them!'],
    });
    const many = reportText(
      [night('2026-10-31', { taken: taken(1) }), night('2026-10-30', { taken: taken(2, false) })],
      () => 'Moonpuff',
    );
    expect(many.title).toBe(HOLLOW_TEXT.visitedMany);
    expect(many.lines[1]).toBe("He took Moonpuff to the Hollow, but they're home again!");
    expect(reportText([night('2026-10-31', { sheltered: 1 })], () => '')).toEqual({
      title: HOLLOW_TEXT.passedBy,
      lines: [HOLLOW_TEXT.safe],
    });
  });

  it('uses kind words only (style guide §9) and keeps lines short', () => {
    const text = Object.values(HOLLOW_TEXT).map((v) =>
      typeof v === 'function' ? (v as (...a: unknown[]) => string)('Moonpuff', 1) : v,
    );
    for (const line of text) {
      expect(findAvoidedWords(line)).toEqual([]);
      expect(line.split(' ').length).toBeLessThanOrEqual(12);
    }
  });
});

describe('the Hollow Man on the map', () => {
  const engine = new NullEngine({
    renderWidth: 400,
    renderHeight: 800,
    textureSize: 1,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  afterEach(() => {
    for (const scene of [...engine.scenes]) scene.dispose();
  });

  function stage() {
    const scene = new Scene(engine);
    new TargetCamera('camera', new Vector3(0, 10, -10), scene);
    const sun = new DirectionalLight('sun', new Vector3(0, -1, 1), scene);
    sun.intensity = 2;
    scene.environmentIntensity = 1;
    let frames = 0;
    const layer = new HollowLayer({ invalidate: () => (frames += 1) });
    layer.attach(scene, testView(1));
    return { scene, sun, layer, frames: () => frames };
  }

  it('dims the light at night and puts the day back exactly in the morning', () => {
    const { scene, sun, layer, frames } = stage();
    const day = scene.clearColor.clone();
    layer.setNight(true);
    expect(scene.environmentIntensity).toBeCloseTo(NIGHT_LOOK.environment);
    expect(sun.intensity).toBeCloseTo(2 * NIGHT_LOOK.sun);
    expect(scene.clearColor.equals(day)).toBe(false);
    // Nothing changes, nothing is drawn.
    const drawn = frames();
    layer.setNight(true);
    expect(frames()).toBe(drawn);
    layer.setNight(false);
    expect(scene.environmentIntensity).toBe(1);
    expect(sun.intensity).toBe(2);
    expect(scene.clearColor.equals(day)).toBe(true);
  });

  it('stays hidden until night falls, then plays one visit on its own animation', () => {
    const { scene, layer } = stage();
    const man = scene.getTransformNodeByName('hollow-man')!;
    expect(man.isEnabled()).toBe(false);
    // Three draw calls: his body, both arms (thin instances of one mesh) and his eyes.
    expect(scene.meshes.filter((m) => m.name.startsWith('hollow-man'))).toHaveLength(3);
    expect(scene.animatables).toHaveLength(0);

    expect(layer.visit()).toBe(true);
    expect(man.isEnabled()).toBe(true);
    expect(layer.debug).toMatchObject({ visiting: true, visits: 1 });
    // The stage draws while Babylon animations run, and stops when they end.
    expect(scene.animatables.length).toBeGreaterThan(0);
    // A second nightfall while he's here doesn't stack another visit.
    layer.visit();
    expect(layer.debug.visits).toBe(1);
    for (const a of [...scene.animatables]) a.goToFrame(visitFrames());
    for (const a of [...scene.animatables]) a.stop();
    expect(layer.debug.visiting).toBe(false);
    expect(man.isEnabled()).toBe(false);
  });

  it('still ends a visit whose scene is torn down mid-way (GPU loss)', () => {
    const { scene, layer } = stage();
    let ended = 0;
    expect(layer.visit(() => (ended += 1))).toBe(true);
    scene.dispose();
    expect(ended).toBe(1);
  });

  it('fades fully in and fully out', () => {
    for (const keys of [VISIT_KEYS.bodyAlpha, VISIT_KEYS.eyeAlpha]) {
      expect(keys[0][1]).toBe(0);
      expect(keys.at(-1)![1]).toBe(0);
      expect(Math.max(...keys.map(([, v]) => v))).toBe(1);
    }
    expect(visitFrames()).toBe(270);
  });

  it('does nothing without a map on screen', () => {
    const layer = new HollowLayer({ invalidate: () => undefined });
    expect(layer.visit()).toBe(false);
    layer.setNight(true);
    expect(layer.debug).toEqual({ night: true, visiting: false, visits: 0 });
  });
});
