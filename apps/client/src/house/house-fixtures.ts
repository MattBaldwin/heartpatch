import {
  CARE_RULES,
  EMPTY_PROGRESS_FACTS,
  evaluateRequirements,
  GAME_DATA,
  HOUSE_DATA,
  HOUSE_NOTES,
  houseLevelData,
  maxHouseLevel,
  nextHouseLevel,
  roomsAt,
  type HomeSquishy,
  type HouseView,
  type ProgressFacts,
} from '@heartpatch/shared';

/*
 * Sample houses for the dev gallery (`/house.html`), house-shots and the
 * unit tests (#381): any level's rooms straight from `HOUSE_DATA`, with
 * residents in their beds. Never used by the game itself.
 */

const NOW = '2026-10-12T18:00:00.000Z';
const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** Who lives in each room in the samples, by room id (room ids are data; unknown rooms get nobody). */
const SAMPLE_RESIDENTS: Readonly<Record<string, readonly string[]>> = {
  snug: ['emberbun', 'puddlepuff'],
  playroom: ['fuzzbolt', 'bubbletub'],
  kitchen: ['pebblesnooze', 'mossmuffin'],
  'heart-hall': ['candlekit', 'flurrypup', 'thistlepip', 'gourdon'],
};

export interface HouseSample {
  readonly view: HouseView;
  /** The squishies the residents are, as the home reply lists them. */
  readonly squishies: HomeSquishy[];
  readonly speciesDefs: [];
}

/** The house at `level` (clamped to the data); `residents: false` leaves every bed empty. */
export function sampleHouse(level: number, residents = true): HouseSample {
  const top = houseLevelData(HOUSE_DATA, level);
  const squishies: HomeSquishy[] = [];
  let n = 1;
  const rooms = roomsAt(HOUSE_DATA, top.level).map((room) => {
    const kinds = residents ? (SAMPLE_RESIDENTS[room.id] ?? []).slice(0, room.beds) : [];
    const lived = kinds.flatMap((speciesId) => {
      const species = GAME_DATA.species.find((s) => s.id === speciesId);
      if (!species) return [];
      const squishyId = id(n++);
      squishies.push({
        id: squishyId,
        speciesId,
        element: species.element,
        feeling: species.feeling,
        nickname: null,
        level: 8,
        habitatId: null,
        trainingId: null,
        job: 'resting',
        accessory: null,
        houseRoomId: room.id,
      });
      return [{ squishyId, since: NOW, away: null }];
    });
    const added = HOUSE_DATA.levels.find((l) => l.room.id === room.id)?.level ?? 1;
    return { ...room, level: added, residents: lived };
  });
  return {
    view: {
      level: top.level,
      levelName: top.name,
      exterior: top.exterior,
      final: top.final === true,
      rooms,
      next: null,
      items: {},
      gift: null,
      cooldowns: [],
      now: NOW,
    },
    squishies,
    speciesDefs: [],
  };
}

/** Who left the sample gift: a resident of this room (its first, or `index`), or nobody drawn. */
export interface SampleGift {
  readonly room?: string;
  readonly index?: number;
  /** A giver no longer in the house (traded away): the box goes by the hearth. */
  readonly away?: boolean;
  readonly claimed?: boolean;
  readonly itemId?: string;
  readonly count?: number;
}

/**
 * The sample with today's gift from a resident (#381 H2), as the server
 * rolls it: a note with the giver's name in it, 3 Timber unless asked.
 */
export function withGift(sample: HouseSample, gift: SampleGift = {}): HouseSample {
  const room =
    sample.view.rooms.find((r) => r.id === (gift.room ?? 'snug')) ?? sample.view.rooms[0];
  const resident = room?.residents[gift.index ?? 0] ?? null;
  const giver = gift.away ? id(999) : (resident?.squishyId ?? null);
  const squishy = sample.squishies.find((s) => s.id === giver);
  const name = GAME_DATA.species.find((s) => s.id === squishy?.speciesId)?.name ?? 'A friend';
  return {
    ...sample,
    view: {
      ...sample.view,
      gift: {
        day: NOW.slice(0, 10),
        giverSquishyId: giver,
        itemId: gift.itemId ?? 'timber',
        count: gift.count ?? 3,
        note: (HOUSE_NOTES[0]?.line ?? '{name} left you this').replace('{name}', name),
        claimed: gift.claimed ?? false,
      },
    },
  };
}

/** Every level in the data, 1 to the top. */
export const sampleLevels = (): number[] =>
  Array.from({ length: maxHouseLevel(HOUSE_DATA) }, (_, i) => i + 1);

/** Grow the house in the samples: not yet (a few rows and the bag short) or ready to build. */
export type SampleGrow = 'not-yet' | 'ready';

const HABITATS = GAME_DATA.buildings.filter((b) => b.kind === 'habitat');

/** A Keeper part of the way there: one habitat, one fire, one sleepy resident, the home ring. */
const SOME_FACTS: ProgressFacts = {
  ...EMPTY_PROGRESS_FACTS,
  buildings: HABITATS.slice(0, 1).map((b) => ({ buildingId: b.id, kind: b.kind })),
  litFires: 1,
  residents: [{ contentment: 20, level: 3, evolved: false }],
  tilesTended: 7,
};

/** A Keeper with everything any level asks for. */
const ALL_FACTS: ProgressFacts = {
  ...EMPTY_PROGRESS_FACTS,
  heartSeedLevel: 99,
  buildings: Array.from({ length: 12 }, (_, i) => ({
    buildingId: HABITATS[i % HABITATS.length]?.id ?? 'habitat',
    kind: 'habitat',
  })),
  litFires: 9,
  decorations: 9,
  residents: Array.from({ length: 10 }, () => ({ contentment: 100, level: 30, evolved: true })),
  trades: Array.from({ length: 12 }, (_, i) => ({
    kind: 'trade' as const,
    partnerUserId: id(900 + (i % 4)),
  })),
  postsUsed: 9,
  tilesTended: 99,
  homesteads: 9,
};

const BUILDING_NAMES = new Map(GAME_DATA.buildings.map((b) => [b.id, b.name]));

/**
 * The sample with the next level's Grow sheet filled in as the server would
 * (the shared evaluator over sample facts, on a solo patch so the invite
 * hint shows), and the bag short (`not-yet`) or covering the cost (`ready`).
 */
export function withGrow(sample: HouseSample, grow: SampleGrow): HouseSample {
  const next = nextHouseLevel(HOUSE_DATA, sample.view.level);
  if (!next) return sample;
  const requirements = evaluateRequirements(
    next.requirements,
    grow === 'ready' ? ALL_FACTS : SOME_FACTS,
    {
      care: CARE_RULES,
      buildingName: (b) => BUILDING_NAMES.get(b) ?? b,
      trackName: (t) => t,
      solo: true,
    },
  );
  // Not yet: the first cost item covered, the rest about half there.
  const items = Object.fromEntries(
    Object.entries(next.cost).map(([item, n], i) => [
      item,
      grow === 'ready' || i === 0 ? n : Math.floor(n / 2),
    ]),
  );
  return {
    ...sample,
    view: {
      ...sample.view,
      next: {
        level: next.level,
        name: next.name,
        room: { id: next.room.id, name: next.room.name, beds: next.room.beds },
        final: next.final === true,
        requirements,
        cost: next.cost,
        unlocked: requirements.every((r) => r.done),
        affordable: Object.entries(next.cost).every(([item, n]) => (items[item] ?? 0) >= n),
      },
      items,
    },
  };
}
