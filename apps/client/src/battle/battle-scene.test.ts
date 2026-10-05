import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { GAME_DATA, visualRegistry } from '@heartpatch/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackStep } from './battle-playback.js';
import { BattleScene } from './battle-scene.js';
import { BattleContent } from './battle-view.js';

// The contact shadow paints a 2D canvas, which NullEngine hasn't got: a plain quad stands in.
vi.mock('../procedural/contact-shadow.js', () => ({
  createContactShadowMesh: (scene: Scene) =>
    CreateGround('test-shadow', { width: 1, height: 1 }, scene),
}));

const registry = visualRegistry(GAME_DATA);
const content = new BattleContent({ speciesDefs: [], moveDefs: [] });

const step = (kind: PlaybackStep['kind'], side: 'a' | 'b', extra: Partial<PlaybackStep> = {}) =>
  ({
    kind,
    side,
    slot: 0,
    text: '',
    callout: null,
    squish: null,
    energy: null,
    to: null,
    move: null,
    effectiveness: null,
    status: null,
    ms: 650,
    ...extra,
  }) satisfies PlaybackStep;

describe('BattleScene', () => {
  const engine = new NullEngine({
    renderWidth: 390,
    renderHeight: 844,
    textureSize: 1,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  afterEach(() => {
    for (const scene of [...engine.scenes]) scene.dispose();
  });

  function build(terrain = 'forest', reducedMotion = false) {
    const scene = new Scene(engine);
    scene.activeCamera = new TargetCamera('cam', Vector3.Zero(), scene);
    const battle = new BattleScene(scene, {
      registry,
      lod: 'low',
      content,
      mySide: 'a',
      keeper: null,
      terrain,
      timeOfDay: 'day',
      battleId: '01a10948-604f-73db-bbd4-5cad0847932b',
      reducedMotion,
    });
    return { scene, battle };
  }

  /** Positions of the live puffs (fire's trail and embers), from their instance buffer. */
  function puffs(scene: Scene): { x: number; z: number }[] {
    const mesh = scene.getMeshByName('fx-puff') as Mesh | null;
    const data = mesh?.thinInstanceGetWorldMatrices() ?? [];
    return data
      .slice(0, mesh?.thinInstanceCount ?? 0)
      .filter((m) => m.m[0] !== 0)
      .map((m) => ({ x: m.m[12] ?? 0, z: m.m[14] ?? 0 }));
  }

  it('draws the terrain it is told, with both squishies out', () => {
    const { battle } = build('mountains');
    battle.sendOut('a', 'puddlepuff', 'mine-1');
    battle.sendOut('b', 'emberbun', 'wild-1');
    expect(battle.stats).toMatchObject({
      squishies: 2,
      arena: { terrain: 'mountains', known: true },
      down: 0,
    });
    expect(battle.stats.arena.props).toBeGreaterThan(0);
  });

  it('streams a strike’s trail along the dash, towards the other squishy', () => {
    const { scene, battle } = build();
    battle.sendOut('a', 'emberbun', 'mine-1');
    battle.sendOut('b', 'puddlepuff', 'wild-1');
    battle.perform(step('move', 'a', { move: 'ember-boop' }), 1000);
    // Near the end of the dash, the trail reaches well past where it started.
    battle.update(1000 + 650 * 0.62);
    const xs = puffs(scene).map((p) => p.x);
    expect(xs.length).toBeGreaterThan(0);
    // Mine stands at x = −2.4 and dashes towards +x.
    expect(Math.max(...xs)).toBeGreaterThan(-1);
    expect(battle.stats.acts).toBe(1);
  });

  it('builds every team squishy up front, so a swap makes no meshes mid-turn', () => {
    const { scene, battle } = build();
    const team = [
      { speciesId: 'puddlepuff', instanceId: 'mine-1' },
      { speciesId: 'emberbun', instanceId: 'mine-2' },
    ];
    battle.prewarm('a', team);
    battle.prewarm('b', [{ speciesId: 'fuzzbolt', instanceId: 'wild-1' }]);
    battle.sendOut('a', 'puddlepuff', 'mine-1');
    battle.sendOut('b', 'fuzzbolt', 'wild-1');
    battle.update(0);
    const meshes = scene.meshes.length;
    battle.perform(step('swap', 'a', { slot: 0, to: 1, ms: 700 }), 1000, {
      incoming: { speciesId: 'emberbun', instanceId: 'mine-2' },
    });
    for (let t = 1000; t <= 2000; t += 50) battle.update(t);
    scene.render();
    expect(scene.meshes.length).toBe(meshes);
    expect(battle.stats.squishies).toBe(2);
  });

  it('builds the benches again after a detail change, so a later swap still makes no meshes', () => {
    const { scene, battle } = build();
    battle.prewarm('a', [
      { speciesId: 'puddlepuff', instanceId: 'mine-1' },
      { speciesId: 'emberbun', instanceId: 'mine-2' },
    ]);
    battle.sendOut('a', 'puddlepuff', 'mine-1');
    battle.sendOut('b', 'fuzzbolt', 'wild-1');
    battle.setLod('high');
    battle.update(0);
    scene.render();
    const meshes = scene.meshes.length;
    battle.perform(step('swap', 'a', { slot: 0, to: 1, ms: 700 }), 1000, {
      incoming: { speciesId: 'emberbun', instanceId: 'mine-2' },
    });
    for (let t = 1000; t <= 2000; t += 50) battle.update(t);
    scene.render();
    expect(scene.meshes.length).toBe(meshes);
  });

  it('lays a tuckered-out squishy down and keeps it there', () => {
    const { battle } = build();
    battle.sendOut('a', 'puddlepuff', 'mine-1');
    battle.sendOut('b', 'emberbun', 'wild-1');
    battle.perform(step('tuckered', 'b', { ms: 1100 }), 1000);
    battle.update(3000);
    expect(battle.stats.down).toBe(1);
  });

  it('says when it plays for reduced motion', () => {
    expect(build('lake', true).battle.stats.reducedMotion).toBe(true);
  });
});
