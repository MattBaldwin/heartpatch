import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { type Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { GAME_DATA, visualRegistry } from '@heartpatch/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHOREO, PLAYBACK } from './battle-config.js';
import type { PlaybackStep } from './battle-playback.js';
import { BattleScene } from './battle-scene.js';
import type { SafeRegion } from './camera-director.js';
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
    item: null,
    shielded: false,
    stance: null,
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
      arena: {
        terrain: 'mountains',
        timeOfDay: 'dusk',
        known: true,
        shadowMap: true,
        lowTier: false,
      },
      down: 0,
    });
    expect(battle.stats.arena.props).toBeGreaterThan(0);
    expect(scene.lights.map((l) => l.name)).toEqual(['sun', 'arena-fill']);
    expect(scene.fogMode).toBe(Scene.FOGMODE_LINEAR);
    expect(scene.getMeshByName('arena-sky')).not.toBeNull();
    expect(scene.getMeshByName('arena-hills')).not.toBeNull();
  });

  it('puts screenSpot on the fighter in page pixels, not in the camera’s 0..1 viewport (#190)', () => {
    const { scene, battle } = build();
    battle.sendOut('a', 'puddlepuff', 'mine-1');
    battle.sendOut('b', 'emberbun', 'wild-1');
    const box = { left: 10, top: 20, width: 390, height: 844 };
    vi.spyOn(engine, 'getRenderingCanvas').mockReturnValue({
      getBoundingClientRect: () => box,
    } as unknown as HTMLCanvasElement);
    scene.render();
    const spots = (['a', 'b'] as const).map((side) => battle.screenSpot(side));
    for (const spot of spots) {
      // Inside the canvas, well clear of its top-left corner.
      expect(spot).not.toBeNull();
      expect(spot!.x).toBeGreaterThan(box.left + 20);
      expect(spot!.x).toBeLessThan(box.left + box.width - 20);
      expect(spot!.y).toBeGreaterThan(box.top + 20);
      expect(spot!.y).toBeLessThan(box.top + box.height);
    }
    // The two sides stand apart on screen.
    expect(
      Math.abs(spots[0]!.x - spots[1]!.x) + Math.abs(spots[0]!.y - spots[1]!.y),
    ).toBeGreaterThan(20);
    // `out` is filled and handed back, with the same answer.
    const out = { x: 0, y: 0, r: 0 };
    expect(battle.screenSpot('a', undefined, false, out)).toBe(out);
    expect(out).toEqual(spots[0]);
    vi.restoreAllMocks();
  });

  it('lays each fighter a contact shadow that faces up, not mirrored, so culling keeps it (#462)', () => {
    for (const tier of ['high', 'low'] as const) {
      const { scene, battle } = build('forest', false, tier);
      battle.sendOut('a', 'puddlepuff', 'mine-1');
      battle.sendOut('b', 'emberbun', 'wild-1');
      battle.update(5000);
      const mesh = scene.getMeshByName('battle-fighter-shadows') as Mesh | null;
      expect(mesh, tier).not.toBeNull();
      const shown = (mesh?.thinInstanceGetWorldMatrices() ?? [])
        .slice(0, mesh?.thinInstanceCount ?? 0)
        .filter((m) => m.m[0] !== 0 || m.m[2] !== 0);
      expect(shown.length, tier).toBe(4);
      // A mirrored instance turns the ground quad's face away, and back-face
      // culling drops it (#462): every shadow keeps a positive determinant.
      for (const m of shown) expect(m.determinant(), tier).toBeGreaterThan(0);
    }
  });

  it("sizes each prop's contact shadow by the prop, however it's turned (#473)", () => {
    const { scene } = build('forest');
    const shadows = scene.getMeshByName('arena-prop-shadows') as Mesh | null;
    expect(shadows).not.toBeNull();
    // The X row's length is the scale on X, whatever the turn about Y.
    const width = (m: Matrix) => Math.hypot(m.m[0] ?? 0, m.m[1] ?? 0, m.m[2] ?? 0);
    const shadowAt = new Map(
      (shadows?.thinInstanceGetWorldMatrices() ?? []).map((m) => [
        `${(m.m[12] ?? 0).toFixed(3)},${(m.m[14] ?? 0).toFixed(3)}`,
        width(m),
      ]),
    );
    let checked = 0;
    for (const mesh of scene.meshes) {
      if (!mesh.name.startsWith('arena-prop-') || mesh === shadows) continue;
      const ratios = (mesh as Mesh).thinInstanceGetWorldMatrices().flatMap((m) => {
        const shadow = shadowAt.get(`${(m.m[12] ?? 0).toFixed(3)},${(m.m[14] ?? 0).toFixed(3)}`);
        return shadow === undefined ? [] : [shadow / width(m)];
      });
      // Same kind, same shadow-to-prop ratio: a prop turned 90° keeps a full shadow.
      for (const r of ratios) expect(r, mesh.name).toBeCloseTo(ratios[0] ?? 0, 5);
      checked += ratios.length;
    }
    // Every shadow found its prop: no key collided, and none was left over.
    expect(checked).toBe(shadowAt.size);
    expect(checked).toBeGreaterThan(2);
  });

  it('dresses each squishy in what it wears, hat height included, and swaps keep it (#373)', () => {
    const { battle } = build('forest');
    battle.prewarm('a', [
      { speciesId: 'puddlepuff', instanceId: 'mine-1', accessory: 'tiny-top-hat' },
      { speciesId: 'puddlepuff', instanceId: 'mine-2', accessory: null },
    ]);
    battle.prewarm('b', [{ speciesId: 'emberbun', instanceId: 'theirs-1', accessory: 'tiny-bow' }]);
    expect(battle.stats.accessories).toBe(2);
    // Sending out and swapping reuse the built (dressed) squishies.
    battle.sendOut('a', 'puddlepuff', 'mine-1');
    battle.sendOut('b', 'emberbun', 'theirs-1');
    expect(battle.stats.accessories).toBe(2);
    battle.sendOut('a', 'puddlepuff', 'mine-2');
    expect(battle.stats.accessories).toBe(2);
  });

  it('scatters fewer props and draws no shadow map on the low tier; night gets its stars', () => {
    const high = build('forest').battle.stats.arena.props;
    const { scene, battle } = build('forest', false, 'low');
    expect(battle.stats.arena.props).toBeLessThan(high);
    expect(battle.stats.arena).toMatchObject({ shadowMap: false, lowTier: true });
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

  it('tells a watcher after a render in which the camera moved, never while it holds still (#190)', () => {
    const { scene, battle } = build('forest', true);
    battle.sendOut('a', 'puddlepuff', 'mine-1');
    battle.sendOut('b', 'emberbun', 'wild-1');
    battle.update(0);
    const moved = vi.fn();
    const stop = battle.onCameraMoved(moved);
    scene.render();
    expect(moved).toHaveBeenCalledTimes(1);
    battle.update(16);
    scene.render();
    expect(moved).toHaveBeenCalledTimes(1);
    // A lean towards one side moves it (at once, with reduced motion).
    battle.focusOn('a');
    battle.update(32);
    scene.render();
    expect(moved).toHaveBeenCalledTimes(2);
    stop();
    battle.focusOn('b');
    battle.update(48);
    scene.render();
    expect(moved).toHaveBeenCalledTimes(2);
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
  describe('a team battle (#190, arena A)', () => {
    let lastScene: Scene | null = null;
    function team(slots: number[], frame: { safe?: SafeRegion; reducedMotion?: boolean } = {}) {
      const scene = new Scene(engine);
      lastScene = scene;
      scene.activeCamera = new TargetCamera('cam', Vector3.Zero(), scene);
      const battle = new BattleScene(scene, {
        registry,
        lod: 'low',
        tier: 'high',
        content,
        mySide: 'a',
        keeper: null,
        terrain: 'meadow',
        timeOfDay: 'day',
        battleId: '01a10948-604f-73db-bbd4-5cad0847932b',
        reducedMotion: frame.reducedMotion ?? false,
        safe: () => frame.safe ?? { top: 0.2, bottom: 0.6 },
        team: { slots },
      });
      const [one, two, three] = GAME_DATA.species;
      const mine = [one!, two!, three!].slice(0, slots.length);
      battle.prewarm(
        'a',
        mine.map((s, i) => ({ speciesId: s.id, instanceId: `mine-${String(i)}`, slot: slots[i] })),
      );
      mine.forEach((s, i) => {
        battle.sendOut('a', s.id, `mine-${String(i)}`, 5, slots[i]);
      });
      battle.prewarm('b', [{ speciesId: one!.id, instanceId: 'boss' }]);
      battle.sendOut('b', one!.id, 'boss');
      battle.update(0);
      return battle;
    }

    it.each([[[0]], [[0, 1]], [[0, 1, 2]]])('stands %j in a row, each on its own post', (slots) => {
      const battle = team(slots);
      expect(battle.stats.squishies).toBe(slots.length + 1);
      const homes = slots.map((slot) => battle.homeOf('a', slot));
      // Left to right in slot order, apart, all nearer the camera than the boss.
      for (let i = 1; i < homes.length; i++) {
        expect(homes[i]!.x).toBeGreaterThan(homes[i - 1]!.x + 1);
      }
      const boss = battle.homeOf('b');
      for (const home of homes) expect(home.z).toBeLessThan(boss.z - 2);
    });

    it('acts a step out on the squishy in its slot, and a hit on the boss on the boss', () => {
      const battle = team([0, 1, 2]);
      const before = battle.stats.acts;
      battle.perform(step('move', 'a', { slot: 2, move: GAME_DATA.moves[0]!.id }), 10);
      battle.perform(step('hit', 'b', { effectiveness: 'normal' }), 700);
      battle.update(1400);
      expect(battle.stats.acts).toBeGreaterThan(before);
      // A tuckered-out squishy in slot 1 lies down; the others stand.
      battle.knockedOut('a', 1);
      expect(battle.stats.down).toBe(1);
    });

    it("returns the boss's beats for its sound, the same with reduced motion (#190 PR 4)", () => {
      const move = GAME_DATA.moves.find((m) => m.element === 'frost') ?? GAME_DATA.moves[0]!;
      for (const reducedMotion of [false, true]) {
        const battle = team([0, 1, 2], { reducedMotion });
        expect(battle.perform(step('move', 'b', { move: move.id, charge: true }), 0)).toBeNull();
        expect(battle.perform(step('effect', 'b', { windup: true }), 500)).toEqual({
          kind: 'windup',
          element: move.element,
        });
        expect(
          battle.perform(step('move', 'b', { move: move.id, landing: true }), 1500),
        ).toBeNull();
        expect(
          battle.perform(step('hit', 'a', { slot: 1, effectiveness: 'normal' }), 2100),
        ).toEqual({
          kind: 'landing',
          element: move.element,
        });
        // My squishy's hit back on the boss is an ordinary hit.
        battle.perform(step('move', 'a', { slot: 0, move: move.id }), 3000);
        expect(battle.perform(step('hit', 'b', { effectiveness: 'normal' }), 3600)).toBeNull();
      }
    });

    it('frames the boss HUD band with nothing to fade (#190 PR 1), the hook keeping what captures measure', () => {
      // The notched iPhone's rest band under the strip and above the chip handle.
      const band: SafeRegion = { top: 0.142, bottom: 0.876 };
      const battle = team([0, 1, 2], { safe: band });
      battle.perform(step('effect', 'b', { windup: true }), 20);
      for (let now = 40; now <= 2400; now += 50) {
        battle.update(now);
        lastScene!.render();
      }
      const framing = battle.stats.framing!;
      // The #868 fade's fields are gone; the captures lane's stay.
      expect(Object.keys(framing).sort()).toEqual([
        'band',
        'bossFacing',
        'distance',
        'face',
        'fogEnd',
        'team',
        'teamFeet',
      ]);
      expect(framing.band).toEqual({ top: 0.142, bottom: 0.876 });
      expect(framing.team.length).toBeGreaterThan(0);
      // The team's lowest body row (#190 PR 2): over the band's bottom.
      expect(framing.teamFeet).not.toBeNull();
      expect(framing.teamFeet!).toBeLessThanOrEqual(band.bottom + 1e-6);
      expect(framing.face).not.toBeNull();
      expect(framing.face!.top).toBeGreaterThanOrEqual(band.top - 1e-6);
      expect(framing.face!.bottom).toBeLessThanOrEqual(band.bottom + 1e-6);
    });

    it('a shield bubble per squishy', () => {
      const battle = team([0, 1, 2]);
      battle.setShield('a', true, 2);
      battle.update(10);
      expect(battle.shieldShown('a', 2)).toBe(true);
      expect(battle.shieldShown('a', 0)).toBe(false);
    });
  });
});
