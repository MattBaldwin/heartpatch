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
      line: 'Pumpkins grow at home and in Pumpkin Fields around Halloween. Gather one, and this page opens!',
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
      page: 'recipe:brave-brew',
      line: 'Grow some Treats and gather Stone from the hills, and this page opens!',
    },
    {
      page: 'recipe:cozy-cocoa',
      line: 'Grow some Treats and gather Timber from the forest, and this page opens!',
    },
    {
      page: 'recipe:hearty-soup',
      line: 'Grow some Treats and gather Emberwood from the old forest, and this page opens!',
    },
    {
      page: 'recipe:cook-treats',
      line: 'Send a squishy to gather on a meadow, or find Greens in a forest, and this page opens!',
    },
    {
      page: 'recipe:freeze-water',
      line: 'Fetch some Water from a lakeside well, and this page opens!',
    },
    {
      page: 'building:training-grounds',
      line: 'Gather some Timber and Stone, and this page opens!',
    },
    {
      page: 'building:crafting-factory',
      line: 'Gather some Timber and Stone, and this page opens!',
    },
    {
      page: 'building:hedge',
      line: 'Get Greens from a meadow (a squishy gatherer picks them) and some Timber, and this page opens!',
    },
    {
      page: 'building:moat',
      line: 'Fetch Water from a lakeside well and some Stone, and this page opens!',
    },
    {
      page: 'building:stone-wall',
      line: 'Gather Stone from the hills and some Timber, and this page opens!',
    },
    {
      page: 'building:emberwood-palisade',
      line: 'Gather Emberwood from the old forest and some Timber, and this page opens!',
    },
    {
      page: 'building:glimmer-rail',
      line: 'Find Glimmer in the mountains and gather some Timber, and this page opens!',
    },
    {
      page: 'building:lantern-fence',
      line: 'Find Glimmer in the mountains and gather some Timber, and this page opens!',
    },
    {
      page: 'building:bramble-hedge',
      line: 'Gather Greens and some Emberwood, and this page opens!',
    },
    {
      page: 'building:ice-wall',
      line: 'Get Ice from the mountains (a squishy gatherer chips it) or freeze Water, plus some Stone, and this page opens!',
    },
  ],
};
