import { CinematicSchema, type Cinematic } from '../../schemas/data/cinematic.js';
import { GREAT_SCATTER } from './great-scatter.js';

export { GREAT_SCATTER };

/**
 * The opening cinematic with its defaults filled in, ready to play. Checked
 * by `checkCinematic` in tests.
 */
export const OPENING_CINEMATIC: Cinematic = CinematicSchema.parse(GREAT_SCATTER);
