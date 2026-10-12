import {
  GAME_DATA,
  HOUSE_DATA,
  houseLevelData,
  maxHouseLevel,
  roomsAt,
  type HomeSquishy,
  type HouseView,
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
      now: NOW,
    },
    squishies,
    speciesDefs: [],
  };
}

/** Every level in the data, 1 to the top. */
export const sampleLevels = (): number[] =>
  Array.from({ length: maxHouseLevel(HOUSE_DATA) }, (_, i) => i + 1);
