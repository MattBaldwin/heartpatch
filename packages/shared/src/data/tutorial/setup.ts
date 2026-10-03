import type { TutorialSetup } from '../../schemas/data/tutorial.js';

/**
 * What a new Tutorial Glade run starts with (#24). Pebblesnooze lives in the
 * Glade and plays the first battle with the player, who has no squishy yet;
 * the starter they befriend in it is their Partner. Sprout's little bag holds
 * the Stone for the Hearthfire and a habitat, Heart Charms, and Treats to
 * feed with, so the early steps teach gathering once rather than again and
 * again.
 */
export const TUTORIAL_SETUP: TutorialSetup = {
  // TUNE: strong enough to beat a level-1 wild squishy and a strength-1 guardian.
  helper: { speciesId: 'pebblesnooze', level: 5 },
  // TUNE: Hearthfire stone 5 + a habitat's 2–3; spare Heart Charms in case of a second friend.
  bag: { stone: 10, 'heart-charm': 3, treats: 3 },
};
