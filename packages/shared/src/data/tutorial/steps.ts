import type { TutorialStep } from '../../schemas/data/tutorial.js';
import { STARTERS } from '../starters.js';

/**
 * Tutorial steps, in order (design doc §26; the beats are #24's). The step
 * engine moves the player to the next step when a game event on their
 * tutorial map matches the current step's `completeOn`; finishing the last
 * step finishes the tutorial. Ids are stored in `users.tutorial_step`, so
 * never rename one.
 *
 * Design doc steps: 1 `plant`, 2 `gather`, 3 `hearthfire`, 4 `first-battle`,
 * 5 `befriend` + `name-partner`, 6 `care`, 7 `habitat`, 8 `territory`,
 * 9 `defend`, 10 `nightfall`, 11 `evolve`, 12 `wardrobe`, 13 `graduation`,
 * after Sprout's `welcome`. A step that waits on gameplay never blocks it: a
 * failed battle or a short bag just means trying again (nothing is lost).
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    goal: 'Say hello to Sprout',
    sproutLines: [
      "Ooh, hello! I'm Sprout, the little glow inside your Heart Seed.",
      "This is the Tutorial Glade. Let's bring the color back together!",
    ],
    highlightTarget: 'none',
    completeOn: {
      eventType: 'tutorial.acknowledged',
      actor: 'player',
      where: [{ op: 'equals', field: 'stepId', value: 'welcome' }],
    },
  },
  {
    id: 'plant',
    goal: 'Plant your Heart Seed',
    sproutLines: [
      "See that glowing spot? That's where your Heart Seed wants to grow.",
      'Plant it, and your home grows right here. Your home is always safe, no matter what!',
    ],
    highlightTarget: 'heart-seed',
    completeOn: {
      eventType: 'tutorial.acknowledged',
      actor: 'player',
      where: [{ op: 'equals', field: 'stepId', value: 'plant' }],
    },
  },
  {
    id: 'gather',
    goal: 'Gather Timber',
    sproutLines: [
      'Ooh, a tree full of Timber! Tap the tree tile by your seed, then Gather.',
      "Here it's quick! In a real patch it takes longer, and it pops into your Bag by itself.",
    ],
    highlightTarget: 'resource-node',
    completeOn: { eventType: 'resource.gathered', actor: 'player', where: [] },
  },
  {
    id: 'hearthfire',
    goal: 'Light a Hearthfire',
    sproutLines: [
      'A fire keeps squishies safe at night. Open My Home on the right, then Home, and build one!',
      'Then gather Emberwood from the old forest tile, and tap Add fuel.',
    ],
    highlightTarget: 'build-button',
    completeOn: { eventType: 'building.fueled', actor: 'player', where: [] },
  },
  {
    id: 'first-battle',
    goal: 'Meet a wild squishy',
    sproutLines: [
      'Wild squishies are peeking out! My friend Pebblesnooze will play on your side.',
      'Open Adventure on the left, tap Find a squishy, then pick a move!',
    ],
    highlightTarget: 'wild-squishy',
    completeOn: {
      eventType: 'battle.ended',
      actor: 'player',
      where: [{ op: 'equals', field: 'kind', value: 'wild' }],
    },
  },
  {
    id: 'befriend',
    goal: 'Make a new friend',
    sproutLines: [
      "Emberbun, Puddlepuff and Thistlepip live here. Let's make one your friend!",
      'Open Adventure, tap Find a squishy, then Use Heart Charm. Here it always works!',
    ],
    highlightTarget: 'capture-button',
    completeOn: {
      eventType: 'squishy.captured',
      actor: 'player',
      where: [{ op: 'oneOf', field: 'speciesId', values: [...STARTERS.speciesIds] }],
    },
  },
  {
    id: 'name-partner',
    goal: 'Name your Partner',
    sproutLines: [
      'Ta-da! Meet your Partner, your very first friend.',
      'What should we call them? Pick a name and tap Save.',
    ],
    highlightTarget: 'none',
    completeOn: {
      eventType: 'squishy.updated',
      actor: 'player',
      where: [{ op: 'exists', field: 'nickname' }],
    },
  },
  {
    id: 'care',
    goal: 'Show your Partner some love',
    sproutLines: [
      'Happy squishies learn more and grow up faster! Visit them often.',
      "Open My Home, then Home. Tap your Partner's name, then Pet, Play or Feed!",
    ],
    highlightTarget: 'care-buttons',
    completeOn: { eventType: 'squishy.cared', actor: 'player', where: [] },
  },
  {
    id: 'habitat',
    goal: 'Give them a home',
    sproutLines: [
      'Every squishy loves a cozy home. Gather more Timber, then build one at Home.',
      'Then tap Move in by your Partner. The right home helps them grow!',
    ],
    highlightTarget: 'habitat',
    completeOn: {
      eventType: 'squishy.housed',
      actor: 'player',
      where: [{ op: 'exists', field: 'habitatId' }],
    },
  },
  {
    id: 'territory',
    goal: 'Claim some land',
    sproutLines: [
      'See the gray land? Tap a tile next to yours and tap Claim.',
      'Win against its guardian and the color comes back. More land, more friends!',
    ],
    highlightTarget: 'neighbor-tile',
    completeOn: { eventType: 'tile.captured', actor: 'player', where: [] },
  },
  {
    id: 'defend',
    goal: 'Guard your new land',
    sproutLines: [
      'New land needs a guard, just in case! Your home is always safe.',
      'Tap your new tile, then Pick guards. Choose Pebblesnooze and tap Save.',
    ],
    highlightTarget: 'defense-stance',
    completeOn: {
      eventType: 'defenders.changed',
      actor: 'player',
      where: [{ op: 'atLeast', field: 'count', value: 1 }],
    },
  },
  {
    id: 'nightfall',
    goal: 'Watch the night come',
    sproutLines: [
      "Pebblesnooze is on watch. Brrr, now it's getting dark!",
      "Your fire keeps everyone safe from the Hollow Man. Tap Night falls when you're ready.",
    ],
    highlightTarget: 'hearthfire',
    completeOn: { eventType: 'hollow.nightfall', actor: 'anyone', where: [] },
  },
  {
    id: 'evolve',
    goal: 'One more battle',
    sproutLines: [
      'The Hollow Man stays away from the light! If he ever takes a squishy, you can always rescue them.',
      'Open Adventure and tap Find a squishy for one more battle. Something big might happen…',
    ],
    highlightTarget: 'wild-squishy',
    completeOn: { eventType: 'squishy.evolved', actor: 'player', where: [] },
  },
  {
    id: 'wardrobe',
    goal: 'Try on your scarf',
    sproutLines: [
      'Wow! You earned a Seedling Scarf!',
      'Tap Wardrobe, then Tops, and put it on. So snuggly!',
    ],
    highlightTarget: 'wardrobe-button',
    completeOn: { eventType: 'outfit.changed', actor: 'player', where: [] },
  },
  {
    id: 'graduation',
    goal: 'Find your patch',
    sproutLines: [
      "Ta-da! You're a real Keeper now, and I'm so proud!",
      'Other Keepers have Heart Seeds too… Start a patch, or join a friend!',
    ],
    highlightTarget: 'graduation-choices',
    completeOn: {
      eventType: 'tutorial.acknowledged',
      actor: 'player',
      where: [{ op: 'equals', field: 'stepId', value: 'graduation' }],
    },
  },
];
