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
    // Resource buildings (#601): built from Timber and Stone too.
    {
      page: 'building:woodcutters-hut',
      line: 'Gather some Timber and Stone, and this page opens!',
    },
    {
      page: 'building:ember-kiln',
      line: 'Gather some Timber and Stone, and this page opens!',
    },
    {
      page: 'building:stone-quarry',
      line: 'Gather some Timber and Stone, and this page opens!',
    },
    {
      page: 'building:ice-cutter',
      line: 'Gather some Timber and Stone, and this page opens!',
    },
    {
      page: 'building:water-well',
      line: 'Gather some Timber and Stone, and this page opens!',
    },
    {
      page: 'building:greenhouse',
      line: 'Gather some Timber and Stone, and this page opens!',
    },
    {
      page: 'building:pumpkin-barn',
      line: 'Gather some Timber and Stone, and this page opens!',
    },
    // The Warehouse (#601 PR 9): lots of Timber and Stone, and some Glimmer.
    {
      page: 'building:warehouse',
      line: 'Gather some Timber, Stone and Glimmer, and this page opens!',
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
    // Wild Isle (#621 W1-8b): its works make all three.
    {
      page: 'recipe:bake-pies',
      line: 'Wild Isle works make Flour, Fish and Salt. Collect all three, and this page opens!',
    },
    // Rekindled (#306 PR 5): sealed by finds only a grey village gives.
    {
      page: 'recipe:joy-lantern',
      line: 'A Joy Ember glows somewhere in a Hollow. Search one by day, and this page opens!',
    },
    {
      page: 'building:joy-lantern',
      line: 'Make a Joy Lantern Kit from your recipe book first. Then this page opens!',
    },
    {
      page: 'recipe:heart-tea',
      line: 'Heart Petals bloom again in the Hollows. Search one by day, and this page opens!',
    },
    {
      page: 'recipe:shovel',
      line: 'Gather some Timber and Stone, and this page opens!',
    },
    {
      page: 'recipe:net',
      line: 'Get Greens from a meadow (a squishy gatherer picks them) and some Timber, and this page opens!',
    },
    {
      page: 'recipe:rope',
      line: 'Get some Greens from a meadow (a squishy gatherer picks them), and this page opens!',
    },
    {
      page: 'recipe:lantern',
      line: 'Find Glimmer in the mountains, plus Timber and Emberwood, and this page opens!',
    },
    {
      page: 'recipe:axe',
      line: 'Gather some Timber and Stone, and this page opens!',
    },
    {
      page: 'recipe:pickaxe',
      line: 'Gather some Timber and Stone, and this page opens!',
    },
    {
      page: 'recipe:spade',
      line: 'Gather some Timber and Stone, and this page opens!',
    },
  ],
};
