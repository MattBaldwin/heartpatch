import type { RecipeBookData } from '../schemas/data/recipe-book.js';

/**
 * The recipe book (owner decision 2026-10-05). Pages open the first time the
 * account has collected all their ingredients; these are open from the start
 * because the tutorial and a first session make them (the Heart Charm, the
 * Hearthfire and both habitats). Hints are public flavour: they only point at
 * gather, terrain and season facts the client already has. Checked by
 * `checkRecipeBook` in the recipe book tests.
 */
export const RECIPE_BOOK: RecipeBookData = {
  alwaysOpen: [
    'recipe:heart-charm',
    'building:hearthfire',
    'building:ember-den',
    'building:cozy-meadow',
  ],
  sealedHints: [
    {
      page: 'recipe:pumpkin-treats',
      line: 'Pumpkins grow in Pumpkin Fields around Halloween. Gather one, and this page opens!',
    },
    {
      page: 'recipe:jack-o-lantern-hearthfire',
      line: 'Psst… something purple and sparkly hides in Emberwood and Pumpkin piles. Find it, and this page opens!',
    },
    {
      page: 'building:jack-o-lantern-hearthfire',
      line: "Carve a Jack-o'-Lantern from your recipe book first. Then this page opens!",
    },
    {
      page: 'recipe:leafy-heart-charms',
      line: 'Crunchy golden leaves pile up at home around Thanksgiving. Gather some, and this page opens!',
    },
    {
      page: 'building:training-grounds',
      line: 'Gather some Timber and Stone, and this page opens!',
    },
  ],
};
