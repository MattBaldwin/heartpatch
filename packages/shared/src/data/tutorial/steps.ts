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
      'Plant it, and your home grows right here. Nobody can ever take a home!',
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
      'Ooh, trees full of Timber! Tap a tree tile next to your seed, then Gather.',
      'Here it only takes a few seconds. Out in a real patch, things take longer.',
    ],
    highlightTarget: 'resource-node',
    completeOn: { eventType: 'resource.gathered', actor: 'player', where: [] },
  },
  {
    id: 'hearthfire',
    goal: 'Light a Hearthfire',
    sproutLines: [
      'A fire keeps squishies safe at night. Open Home and build a Hearthfire!',
      'Then fuel it with Emberwood. The old forest tile has lots.',
    ],
    highlightTarget: 'build-button',
    completeOn: { eventType: 'building.fueled', actor: 'player', where: [] },
  },
  {
    id: 'first-battle',
    goal: 'Meet a wild squishy',
    sproutLines: [
      'Wild squishies are peeking out! My friend Pebblesnooze wants to play.',
      'Tap a tile next to your home, then Battle. Pick a move and see what happens!',
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
      'Emberbun, Puddlepuff or Thistlepip: which one makes you smile most?',
      'Battle it, then tap Use Heart Charm. Here it always works!',
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
    goal: 'Say hello up close',
    sproutLines: [
      'Happy squishies learn faster! Open Home and tap your Partner.',
      'Pet them, boop them or feed them a treat. Look at that wiggle!',
    ],
    highlightTarget: 'care-buttons',
    completeOn: { eventType: 'squishy.cared', actor: 'player', where: [] },
  },
  {
    id: 'habitat',
    goal: 'Give them a home',
    sproutLines: [
      'Every squishy loves a cozy home. Build a habitat at Home.',
      'Then move your Partner in. The right home helps them grow!',
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
      'See the grey land? Tap a tile next to yours and tap Claim.',
      'Win against its guardian and the color comes back. More land, more friends!',
    ],
    highlightTarget: 'neighbor-tile',
    completeOn: { eventType: 'tile.captured', actor: 'player', where: [] },
  },
  {
    id: 'defend',
    goal: 'Guard your new land',
    sproutLines: [
      'Uh-oh, a shadowy echo is sniffing around your new land!',
      'Tap your new tile and put a squishy on watch. Your home is always safe.',
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
      "Phew, your guard shooed the echo away! Brrr, now it's getting dark.",
      "Your fire keeps everyone safe. Tap Night falls when you're ready.",
    ],
    highlightTarget: 'hearthfire',
    completeOn: { eventType: 'hollow.nightfall', actor: 'anyone', where: [] },
  },
  {
    id: 'evolve',
    goal: 'One more battle',
    sproutLines: [
      'He stays away from the light! If he ever takes a squishy, you can always rescue them.',
      'Now, one more battle with your Partner. Something big might happen…',
    ],
    highlightTarget: 'wild-squishy',
    completeOn: { eventType: 'squishy.evolved', actor: 'player', where: [] },
  },
  {
    id: 'wardrobe',
    goal: 'Try on your scarf',
    sproutLines: [
      'Wow! You earned the First Patch and a Seedling Scarf!',
      'Open the Wardrobe and put it on. So snuggly!',
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
