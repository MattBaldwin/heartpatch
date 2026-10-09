import type { ExploreSky, SkyPhase } from '../schemas/data/explore.js';

// The explore sky (#335): which sky shows at a patch-local time, and how far
// the fade into the next one has got. Pure and public: the time of day isn't
// a secret, and the client works it out from the patch clock (CLAUDE.md
// rule 4: nothing ticks on the server).

const DAY_MINUTES = 24 * 60;

/** The sky at a moment: `phase` fading towards `next` by `blend` (0–1). */
export interface SkyAt {
  readonly phase: SkyPhase;
  readonly next: SkyPhase;
  /** 0 until `blendMinutes` before the change, then up to 1 at the change. */
  readonly blend: number;
}

/** The sky at `minute` minutes after the patch's local midnight (wrapped into the day). */
export function skyAt(minute: number, sky: ExploreSky): SkyAt {
  const m = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const { phases } = sky;
  let i = 0;
  while (i + 1 < phases.length && (phases[i + 1]?.from ?? DAY_MINUTES) <= m) i++;
  const current = phases[i];
  const following = phases[i + 1] ?? phases[0];
  if (!current || !following) throw new Error('the sky has no phases');
  const changeAt = i + 1 < phases.length ? following.from : DAY_MINUTES + following.from;
  const left = changeAt - m;
  const blend = sky.blendMinutes > 0 && left <= sky.blendMinutes ? 1 - left / sky.blendMinutes : 0;
  return { phase: current.phase, next: following.phase, blend };
}
