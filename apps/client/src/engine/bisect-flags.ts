/**
 * Device bisect switches (#501): each one turns a single cost off, so the
 * owner can run the same lake once per flag with `?fps=1` and see which one
 * brings the frame rate back. Read from the address once in `main.ts`, like
 * `?rareglow=0` (#391). Without them nothing changes.
 */
export interface BisectFlags {
  /** `?nopost=1`: no bloom or FXAA pass (tone mapping stays in the materials). */
  readonly noPost: boolean;
  /** `?nowater=1`: a plain lake bed, with no caustics and no haze. */
  readonly noWater: boolean;
  /** `?nograss=1`: no grass tufts on explored land. */
  readonly noGrass: boolean;
  /** `?nosky=1`: no sky dome, sun, moon, clouds or stars in explore. */
  readonly noSky: boolean;
  /** `?noportraits=1`: no squishy portraits drawn (the sheets show their placeholder). */
  readonly noPortraits: boolean;
  /** `?cap30=1`: the render loop draws at most 30 frames a second, on every scene (`FRAME_CAP_30`). */
  readonly cap30: boolean;
}

export const NO_BISECT: BisectFlags = {
  noPost: false,
  noWater: false,
  noGrass: false,
  noSky: false,
  noPortraits: false,
  cap30: false,
};

const PARAMS: Readonly<Record<keyof BisectFlags, string>> = {
  noPost: 'nopost',
  noWater: 'nowater',
  noGrass: 'nograss',
  noSky: 'nosky',
  noPortraits: 'noportraits',
  cap30: 'cap30',
};

export function readBisectFlags(params: URLSearchParams): BisectFlags {
  const flags = { ...NO_BISECT };
  for (const key of Object.keys(PARAMS) as (keyof BisectFlags)[]) {
    flags[key] = params.get(PARAMS[key]) === '1';
  }
  return flags;
}

// One set for the whole page: set once from `main.ts` before anything is built.
let current: BisectFlags = NO_BISECT;

export function setBisectFlags(flags: BisectFlags): void {
  current = flags;
}

export function bisectFlags(): BisectFlags {
  return current;
}

/** The flags that are on, as the address spells them (for the badge), or ''. */
export function bisectLabel(flags: BisectFlags): string {
  return (Object.keys(PARAMS) as (keyof BisectFlags)[])
    .filter((key) => flags[key])
    .map((key) => PARAMS[key])
    .join(' ');
}
