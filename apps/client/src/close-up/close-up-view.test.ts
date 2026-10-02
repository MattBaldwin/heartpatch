import {
  findAvoidedWords,
  GAME_DATA,
  type CareListResponse,
  type CareSquishy,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { CARE_TEXT } from '../care/care-view.js';
import { CAMERA_POSES, IDLE, IDLE_BY_FEELING, REACTIONS } from './close-up-config.js';
import {
  cameraFor,
  careDecision,
  checkNickname,
  CLOSE_UP_TEXT,
  easeOutCubic,
  FILL,
  frameFor,
  idleMoveFor,
  idlePose,
  infoCard,
  nextIdleIn,
  poseBetween,
  projectPoint,
  reactionFor,
  screenEllipse,
  tidyId,
  TOUCH_CARE,
} from './close-up-view.js';

const NOW = '2026-10-02T12:00:00.000Z';
const now = Date.parse(NOW);

function squishy(over: Partial<CareSquishy> = {}): CareSquishy {
  return {
    id: '00000000-0000-7000-8000-000000000001',
    speciesId: 'mystery-blob',
    element: 'shadow',
    feeling: 'sleepy',
    nickname: null,
    level: 4,
    xp: 80,
    xpIntoLevel: 5,
    xpToNext: 40,
    stats: { hp: 30, attack: 10, defense: 10, speed: 10 },
    contentment: 40,
    mood: 'happy',
    xpBonusPercent: 130,
    habitatId: null,
    caredToday: 1,
    fullCareLeft: 2,
    nextCareAt: {},
    newEvolution: null,
    ...over,
  };
}

function reply(over: Partial<CareListResponse> = {}): CareListResponse {
  return {
    squishies: [squishy()],
    speciesDefs: [
      {
        id: 'mystery-blob',
        name: 'Gloomdrop',
        element: 'shadow',
        feeling: 'sleepy',
        rarity: 'secret',
        baseStats: { hp: 30, attack: 10, defense: 10, speed: 10 },
        moves: ['zz-mystery-wiggle', ...GAME_DATA.moves.slice(0, 1).map((m) => m.id)],
        evolutions: [],
        habitatPreferences: [],
        visual: { body: 'blob', palette: ['#8b7bd8'], parts: [] },
      } as unknown as CareListResponse['speciesDefs'][number],
    ],
    items: { treats: 2 },
    coinsToday: 0,
    now: NOW,
    ...over,
  };
}

describe('touches and care', () => {
  it('maps gestures onto the three care actions (design doc §7)', () => {
    expect(TOUCH_CARE).toEqual({ boop: 'play', tickle: 'play', stroke: 'pet', treat: 'feed' });
  });

  it('sends a touch unless the server would only refuse it', () => {
    const s = squishy({ nextCareAt: { pet: new Date(now + 5000).toISOString() } });
    const r = reply();
    expect(careDecision('boop', s, r, now, new Set())).toEqual({ action: 'play', hold: null });
    expect(careDecision('stroke', s, r, now, new Set())).toEqual({
      action: 'pet',
      hold: 'resting',
    });
    // On the server's clock: once the debounce is over, it counts again.
    expect(careDecision('stroke', s, r, now + 5001, new Set()).hold).toBeNull();
    expect(careDecision('tickle', s, r, now, new Set(['play'])).hold).toBe('busy');
    expect(careDecision('treat', s, r, now, new Set())).toEqual({ action: 'feed', hold: null });
    expect(careDecision('treat', s, reply({ items: {} }), now, new Set()).hold).toBe('noTreats');
  });

  it('always reacts, softer when the touch was held back, sniffing at no treat', () => {
    expect(reactionFor('stroke', null)).toEqual(REACTIONS.wiggle);
    expect(reactionFor('tickle', null)).toEqual(REACTIONS.giggle);
    expect(reactionFor('treat', null)).toEqual(REACTIONS.nom);
    const soft = reactionFor('boop', 'resting');
    expect(soft.move).toBe(REACTIONS.boop.move);
    expect(soft.strength).toBeLessThan(REACTIONS.boop.strength);
    expect(reactionFor('treat', 'noTreats')).toEqual(REACTIONS.sniff);
  });
});

describe('info card', () => {
  it("shows the care sheet's mood and hearts plus element, feeling and moves", () => {
    const card = infoCard(squishy(), reply());
    expect(card).toMatchObject({
      name: 'Gloomdrop',
      speciesName: 'Gloomdrop',
      nickname: null,
      levelNumber: 4,
      level: 'Level 4',
      element: 'Shadow',
      feeling: 'Sleepy',
      mood: 'Happy and bouncy!',
      hearts: 0.4,
      // A move this client has a row for uses its name; one it hasn't is tidied.
      moves: ['Zz Mystery Wiggle', ...GAME_DATA.moves.slice(0, 1).map((m) => m.name)],
    });
    expect(card.buttons.map((b) => b.action)).toEqual(['feed', 'pet', 'play']);
  });

  it('goes by its nickname once it has one', () => {
    const card = infoCard(squishy({ nickname: 'Sir Puffs' }), reply());
    expect(card.name).toBe('Sir Puffs');
    expect(card.nickname).toBe('Sir Puffs');
    expect(card.speciesName).toBe('Gloomdrop');
  });

  it('tidies move ids it has no row for', () => {
    expect(tidyId('giggle-drizzle')).toBe('Giggle Drizzle');
    expect(tidyId('peekaboo')).toBe('Peekaboo');
  });

  it('checks names the way the server does, with friendly words', () => {
    expect(checkNickname('  Sir   Puffs ')).toEqual({ ok: true, name: 'Sir Puffs' });
    expect(checkNickname('   ')).toMatchObject({ ok: false });
    expect(checkNickname('x'.repeat(17))).toMatchObject({ ok: false });
    expect(checkNickname('<b>hi</b>')).toMatchObject({ ok: false });
  });

  it('only uses kid-friendly words (style guide §9)', () => {
    const words = [
      ...Object.values(CLOSE_UP_TEXT).flatMap((v) => (typeof v === 'string' ? [v] : [])),
      CLOSE_UP_TEXT.renamed('Puff'),
      CLOSE_UP_TEXT.level(3),
      ...Object.values(REACTIONS).map((r) => r.bubble ?? ''),
      ...Object.values(IDLE_BY_FEELING).map((m) => m.bubble ?? ''),
      CARE_TEXT.upClose,
    ];
    expect(findAvoidedWords(words.join(' '))).toEqual([]);
  });
});

describe('camera', () => {
  it('swoops from up and back to face to face', () => {
    expect(poseBetween(CAMERA_POSES.from, CAMERA_POSES.face, 0)).toEqual(CAMERA_POSES.from);
    expect(poseBetween(CAMERA_POSES.from, CAMERA_POSES.face, 1)).toEqual(CAMERA_POSES.face);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it('puts the camera in front of the face (−z) looking at it', () => {
    const cam = cameraFor({ distance: 5, pitch: 0, yaw: 0, lookAt: 0.5 }, 2);
    expect(cam.target).toEqual({ x: 0, y: 1, z: 0 });
    expect(cam.position.x).toBeCloseTo(0);
    expect(cam.position.y).toBeCloseTo(1);
    expect(cam.position.z).toBeCloseTo(-5);
    const high = cameraFor(CAMERA_POSES.from, 2);
    expect(high.position.y).toBeGreaterThan(cam.position.y);
  });

  it('projects the squishy to the middle of the screen, bigger when closer', () => {
    const view = { width: 390, height: 844, fov: 0.7 };
    const face = cameraFor(CAMERA_POSES.face, 1.6);
    const target = cameraFor({ ...CAMERA_POSES.face, pitch: 0 }, 1.6).target;
    const p = projectPoint(cameraFor({ ...CAMERA_POSES.face, pitch: 0 }, 1.6), view, target);
    expect(p?.x).toBeCloseTo(195);
    expect(p?.y).toBeCloseTo(422);
    // Right of the squishy is right on screen; above is up.
    const right = projectPoint(face, view, { x: 0.5, y: 0.8, z: 0 });
    const up = projectPoint(face, view, { x: 0, y: 1.5, z: 0 });
    expect(right!.x).toBeGreaterThan(195);
    expect(up!.y).toBeLessThan(projectPoint(face, view, { x: 0, y: 0.8, z: 0 })!.y);
    // Behind the camera: nothing.
    expect(projectPoint(face, view, { x: 0, y: 1, z: -50 })).toBeNull();

    const near = screenEllipse(face, view, { width: 1.6, height: 1.6 });
    const far = screenEllipse(cameraFor(CAMERA_POSES.from, 1.6), view, { width: 1.6, height: 1.6 });
    expect(near!.rx).toBeGreaterThan(far!.rx);
    // Face to face, the squishy fills a good part of a phone screen.
    expect(near!.rx * 2).toBeGreaterThan(view.width * 0.3);
  });
});

describe('idle personality', () => {
  it('has a move for every feeling (Silly spins, Sleepy nods, Brave puffs)', () => {
    expect(idleMoveFor('silly').motion).toBe('spin');
    expect(idleMoveFor('sleepy').motion).toBe('nod');
    expect(idleMoveFor('brave').motion).toBe('puff');
    expect(idleMoveFor('not-a-feeling')).toEqual(IDLE_BY_FEELING.joy);
  });

  it.each(Object.entries(IDLE_BY_FEELING))('%s starts and ends at rest', (_feeling, move) => {
    for (const t of [0, 1]) {
      const pose = idlePose(move, t);
      expect(pose.scale).toBeCloseTo(1);
      expect(pose.lift).toBeCloseTo(0);
      expect(Math.abs(Math.sin(pose.yaw))).toBeCloseTo(0);
    }
  });

  it('moves in the middle', () => {
    expect(idlePose(IDLE_BY_FEELING.silly, 0.5).yaw).toBeCloseTo(Math.PI);
    expect(idlePose(IDLE_BY_FEELING.brave, 0.5).scale).toBeCloseTo(1 + IDLE.puffScale);
    expect(idlePose(IDLE_BY_FEELING.sleepy, 0.4).lift).toBeLessThan(0);
    expect(idlePose(IDLE_BY_FEELING.joy, 0.25).lift).toBeGreaterThan(0);
  });

  it('waits a jittered while between idle moves', () => {
    expect(nextIdleIn(0.5)).toBe(IDLE.everyMs);
    expect(nextIdleIn(0)).toBe(IDLE.everyMs - IDLE.jitterMs);
  });
});

describe('framing', () => {
  const view = { width: 390, height: 844, fov: 0.7 };

  it('centres the squishy in the space above the card, small enough to fit', () => {
    const height = 1.6;
    const { pose, drop } = frameFor(CAMERA_POSES.face, height, view, 420);
    expect(drop).toBeGreaterThan(0);
    const box = screenEllipse(cameraFor(pose, height, drop), view, { width: height, height });
    expect(box!.y).toBeCloseTo(210, -1);
    expect(box!.y + box!.ry).toBeLessThan(420);
    // About FILL of the free space (perspective adds a little).
    expect(box!.ry * 2).toBeLessThan(420 * FILL * 1.1);
  });

  it('never comes closer than face to face, and with no card it stays centred', () => {
    const { pose, drop } = frameFor(CAMERA_POSES.face, 0.5, view, view.height);
    expect(pose.distance).toBe(CAMERA_POSES.face.distance);
    expect(drop).toBeCloseTo(0);
  });
});
