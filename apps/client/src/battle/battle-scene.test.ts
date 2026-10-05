import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { GAME_DATA, visualRegistry } from '@heartpatch/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHOREO, PLAYBACK } from './battle-config.js';
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

  function build(terrain = 'forest', reducedMotion = false, tier: 'high' | 'low' = 'high') {
    const scene = new Scene(engine);
    scene.activeCamera = new TargetCamera('cam', Vector3.Zero(), scene);
    const battle = new BattleScene(scene, {
      registry,
      lod: 'low',
      tier,
      content,
      mySide: 'a',
      keeper: { base: 'pip', hairColor: 'honey', eyeColor: 'cocoa', outfit: 'strawberry' },
      terrain,
      timeOfDay: 'dusk',
      battleId: '01a10948-604f-73db-bbd4-5cad0847932b',
      reducedMotion,
      safe: () => ({ top: 0.12, bottom: 0.65 }),
    });
    return { scene, battle };
  }

  /** Positions of the live instances of an effect mesh, from its instance buffer. */
  function live(scene: Scene, name: string): { x: number; y: number; z: number }[] {
    const mesh = scene.getMeshByName(name) as Mesh | null;
    if (!mesh?.isEnabled()) return [];
    const data = mesh.thinInstanceGetWorldMatrices();
    return data
      .slice(0, mesh.thinInstanceCount)
      .filter((m) => m.m[0] !== 0 || m.m[1] !== 0 || m.m[2] !== 0)
      .map((m) => ({ x: m.m[12] ?? 0, y: m.m[13] ?? 0, z: m.m[14] ?? 0 }));
  }

  it('draws the terrain it is told, lit for its time of day, with both squishies out and the Keeper', () => {
    const { scene, battle } = build('mountains');
    battle.sendOut('a', 'puddlepuff', 'mine-1');
    battle.sendOut('b', 'emberbun', 'wild-1');
    expect(battle.stats).toMatchObject({
      squishies: 2,
      keeper: true,
      arena: { terrain: 'mountains', timeOfDay: 'dusk', known: true, shadowMap: true },
      down: 0,
    });
    expect(battle.stats.arena.props).toBeGreaterThan(0);
    expect(scene.lights.map((l) => l.name)).toEqual(['sun', 'arena-fill']);
    expect(scene.fogMode).toBe(Scene.FOGMODE_LINEAR);
    expect(scene.getMeshByName('arena-sky')).not.toBeNull();
    expect(scene.getMeshByName('arena-hills')).not.toBeNull();
  });

  it('scatters fewer props and draws no shadow map on the low tier; night gets its stars', () => {
    const high = build('forest').battle.stats.arena.props;
    const { scene, battle } = build('forest', false, 'low');
    expect(battle.stats.arena.props).toBeLessThan(high);
    expect(battle.stats.arena.shadowMap).toBe(false);
    expect(scene.getMeshByName('arena-stars')).toBeNull();
    const night = new Scene(engine);
    night.activeCamera = new TargetCamera('cam', Vector3.Zero(), night);
    new BattleScene(night, {
      registry,
      lod: 'low',
      tier: 'high',
      content,
      mySide: 'a',
      keeper: null,
      terrain: 'old-forest',
      timeOfDay: 'night',
      battleId: 'x',
      reducedMotion: false,
      safe: () => ({ top: 0.1, bottom: 0.65 }),
    });
    expect(night.getMeshByName('arena-stars')).not.toBeNull();
  });

  it('writes the camera shot into the stage camera before a render, with the lens shift', () => {
    const { scene, battle } = build();
    battle.sendOut('a', 'puddlepuff', 'mine-1');
    battle.sendOut('b', 'emberbun', 'wild-1');
    battle.update(0);
    scene.render();
    const camera = scene.activeCamera as TargetCamera;
    expect(camera.position.y).toBeGreaterThan(0.5);
    expect(camera.position.z).toBeLessThan(0);
    expect(camera.getProjectionMatrix().m[9]).not.toBe(0);
    expect(scene.imageProcessingConfiguration.vignetteEnabled).toBe(true);
  });

  it('streams a strike’s trail along the dash, towards the other squishy', () => {
    const { scene, battle } = build();
    battle.sendOut('a', 'emberbun', 'mine-1');
    battle.sendOut('b', 'puddlepuff', 'wild-1');
    battle.perform(step('move', 'a', { move: 'ember-boop' }), 1000);
    const { windup, travel } = CHOREO.dash;
    battle.update(1000 + 650 * (windup + travel * 0.95));
    scene.render();
    const xs = live(scene, 'fx-halo').map((p) => p.x);
    expect(xs.length).toBeGreaterThan(0);
    // Mine stands at x ≈ −2.15 and dashes towards +x.
    expect(Math.max(...xs)).toBeGreaterThan(-1);
    expect(battle.stats.acts).toBe(1);
    expect(battle.stats.playing).toMatchObject({ kind: 'move' });
    expect(battle.isPlaying(1000 + 100)).toBe(true);
  });

  it('plays a hit: a hit-stop, then the bonk, the element burst with speed lines, and effects that die away', () => {
    const { scene, battle } = build();
    battle.sendOut('a', 'emberbun', 'mine-1');
    battle.sendOut('b', 'puddlepuff', 'wild-1');
    battle.perform(step('move', 'a', { move: 'ember-boop' }), 0);
    battle.update(650);
    battle.perform(step('hit', 'b', { effectiveness: 'super', ms: 800 }), 650);
    battle.update(650 + 30);
    scene.render();
    // In the hit-stop: a flash, nothing else yet.
    expect(live(scene, 'fx-puff').length).toBeGreaterThan(0);
    expect(live(scene, 'fx-line').length).toBe(0);
    battle.update(650 + CHOREO.hitStop * 1.5 + 60);
    scene.render();
    expect(live(scene, 'fx-line').length).toBeGreaterThan(0);
    expect(battle.stats.effects.spawned).toBeGreaterThan(2);
    battle.update(650 + 800 + 3000);
    scene.render();
    expect(battle.stats.effects.live).toBe(0);
    expect(battle.stats.effects.meshes).toBe(0);
  });

  it('builds every team squishy up front, so a swap makes no meshes mid-turn', () => {
    const { scene, battle } = build();
    battle.prewarm('a', [
      { speciesId: 'puddlepuff', instanceId: 'mine-1' },
      { speciesId: 'emberbun', instanceId: 'mine-2' },
    ]);
    battle.prewarm('b', [{ speciesId: 'fuzzbolt', instanceId: 'wild-1' }]);
    battle.sendOut('a', 'puddlepuff', 'mine-1');
    battle.sendOut('b', 'fuzzbolt', 'wild-1');
    battle.update(0);
    scene.render();
    const meshes = scene.meshes.length;
    const materials = scene.materials.length;
    battle.perform(step('swap', 'a', { slot: 0, to: 1, ms: PLAYBACK.swapMs }), 1000, {
      incoming: { speciesId: 'emberbun', instanceId: 'mine-2' },
    });
    for (let t = 1000; t <= 2000; t += 50) battle.update(t);
    scene.render();
    expect(scene.meshes.length).toBe(meshes);
    expect(scene.materials.length).toBe(materials);
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

  it('lays a tuckered-out squishy down and keeps it there, and at once on resume', () => {
    const { battle } = build();
    battle.sendOut('a', 'puddlepuff', 'mine-1');
    battle.sendOut('b', 'emberbun', 'wild-1');
    battle.perform(step('tuckered', 'b', { ms: 1100 }), 1000);
    battle.update(3000);
    expect(battle.stats.down).toBe(1);
    battle.knockedOut('a');
    expect(battle.stats.down).toBe(2);
  });

  it('holds still with reduced motion between steps, and says so', () => {
    const { battle } = build('lake', true);
    battle.sendOut('a', 'puddlepuff', 'mine-1');
    battle.sendOut('b', 'emberbun', 'wild-1');
    expect(battle.stats.reducedMotion).toBe(true);
    expect(battle.update(500)).toBe(false);
    expect(battle.isPlaying(500)).toBe(false);
    const { battle: lively } = build('lake', false);
    lively.sendOut('a', 'puddlepuff', 'mine-1');
    expect(lively.update(500)).toBe(true);
    expect(lively.isPlaying(500)).toBe(false);
  });

  it('disposes everything it made', () => {
    const { scene, battle } = build();
    battle.sendOut('a', 'puddlepuff', 'mine-1');
    battle.update(0);
    scene.render();
    battle.dispose();
    expect(scene.meshes.length).toBe(0);
    expect(scene.lights.map((l) => l.name)).toEqual(['sun']);
  });
});
