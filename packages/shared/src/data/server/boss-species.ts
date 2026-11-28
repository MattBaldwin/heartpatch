import type { Move } from '../../schemas/data/moves.js';
import type { SecretEvolution } from '../../schemas/data/server-game-data.js';
import type { Species } from '../../schemas/data/species.js';

/*
 * The four mini-boss lines (#190, #234; art from #810): base → middle →
 * boss, each a `line: 'boss'` species. Secret (CLAUDE.md rule 6, DECISIONS
 * "Boss species live in SECRET_SPECIES"): server-only, sent to a Keeper only
 * once they have met one (`hiddenUntilSeen`). Never wild: no spawn,
 * guardian, shop or find table may hold them (`checkServerGameData`). The
 * boss forms visit from `BOSS_EVENTS.bag`; a befriended boss joins as its
 * line's base form and grows up by `BOSS_EVOLUTIONS`.
 *
 * Bodies and parts are public (`data/boss-parts.ts`), so a met boss is drawn
 * from `GAME_DATA`. Rarity: base and middle legendary, boss mythic
 * (`ART_RULES.finishByRarity`: iridescent, iridescent, shimmer). Sizes step
 * inside `ART_RULES.evolutionScale`.
 *
 * Base stats: base forms in the legendary band (~275, `species.ts`), middle
 * forms about ×1.15–1.18 like the #443 kids. Boss forms are tuned in
 * `pnpm sim:boss` (#234 ruling (A)) so a team of 3 at level wins 55–65%
 * against each, with `rules.boss` at 1.5× energy and one action a round:
 * totals 348–430, shaped by each line (the kart line fast, the dad line a
 * tank). All `// TUNE:`. Last run (#234 PR 2, 2000 games a cell): team of 3
 * at level wins 61/56/56/56% (Rakelet, Mommentum, Papa Brrr, Rickeyride),
 * 5 levels over 94–98%, a team of 1 3–14%, medians 6/6/8/6 rounds.
 *
 * Signature moves use the #234 engine effects (#846): Count to Three winds
 * up a round then lands (`windup`), Leaf Pile Pounce and Full Name Shout
 * can make a foe that hasn't moved yet lose its turn (`flinch`), Mama Bear
 * Charge hits harder the lower her energy (`low-energy`), and Ask Your
 * Mother calls in Mama Bear Charge (`assist`; the server sends its def with
 * the battle, so a kid who met Papa Brrr can read its name).
 *
 * The Christmas Eve BIG squishy (#37 X3, owner decision 4): Snowbundle, a
 * Christmas-only frost boss that never joins the weekly bag, and Bundlebit,
 * the tiny form that joins a patch. Both legendary, so iridescent: never the
 * shimmer (#866). Its signature pairs frost with `windup` (frost + `assist`
 * is Papa Brrr's).
 */

const RAKE_PALETTE = ['#9fd46e', '#fff6dc', '#f08a3c', '#b07a48']; // #810 round 8: wood-brown crossbar, not orange
const MOM_PALETTE = ['#ff8a6a', '#fff0e6', '#ffd166', '#8a3550'];
const DAD_PALETTE = ['#a9d4f5', '#f4fbff', '#e2574c', '#f7f1ea'];
const KART_PALETTE = ['#ffd84a', '#bff0ff', '#3f8fe8', '#4a3a5c'];
// #37 X3 (docs/art/37-frost-briefs.md): ice-blue, snow white, a gold lit
// crown (the accent, so `glow: 'accent'` lights only it) and the cranberry
// cap band (the detail colour, so it never glows).
const SNOW_PALETTE = ['#c2e2f9', '#f4fbff', '#ffd25a', '#d9485a']; // TUNE: a touch deeper than the brief's #d9eefc so the white belly reads; still lighter than Papa Brrr's #a9d4f5

/** The boss forms' signature moves (and two the middle forms learn first). */
export const BOSS_MOVES: Move[] = [
  // ── The rake line ──
  {
    id: 'rake-mouth',
    name: 'Rake Mouth',
    description: 'A big, scritchy rake-scoop. It might leave you a bit dizzy.',
    element: 'leaf',
    power: 90, // TUNE:
    accuracy: 95, // TUNE:
    effects: [{ type: 'status', status: 'dizzy', chance: 15 }], // TUNE:
  },
  {
    id: 'stink-bomb',
    name: 'Stink Bomb',
    description: 'Flings a soggy, smelly leaf pile at everyone. Phew!',
    element: 'leaf',
    power: 55, // TUNE:
    accuracy: 100,
    targets: 'all-foes',
    effects: [{ type: 'status', status: 'dizzy', chance: 20 }], // TUNE:
  },
  {
    id: 'leaf-pile-pounce',
    name: 'Leaf Pile Pounce',
    description: 'Leaps out of a leaf pile with a WHOOSH! You might flinch.',
    element: 'leaf',
    power: 75, // TUNE:
    accuracy: 100,
    effects: [{ type: 'flinch', chance: 25 }], // TUNE:
  },
  {
    id: 'count-to-three',
    name: 'Count to Three',
    description: 'One… two… THREE! A giant rake-swipe. It takes a round to wind up, so brace!',
    element: 'leaf',
    power: 170, // TUNE: about two Rake Mouths in one blow
    accuracy: 100,
    effects: [{ type: 'windup' }],
  },
  // ── The mom line ──
  {
    id: 'the-look',
    name: 'The Look',
    description: 'One raised eyebrow. Its target loses a little fight.',
    element: 'fire',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'stat', target: 'opponent', stat: 'attack', stages: -1, chance: 100 }], // TUNE:
  },
  {
    id: 'full-name-shout',
    name: 'Full Name Shout',
    description: 'Shouts your WHOLE name, middle name and all. You might flinch!',
    element: 'fire',
    power: 85, // TUNE:
    accuracy: 100,
    effects: [{ type: 'flinch', chance: 35 }], // TUNE: she is slow, so it bites less often
  },
  {
    id: 'mama-bear-charge',
    name: 'Mama Bear Charge',
    description: 'A big protective charge. The lower her energy, the harder it hits.',
    element: 'fire',
    power: 80, // TUNE:
    accuracy: 100,
    effects: [{ type: 'low-energy', extraPercent: 80 }], // TUNE: up to ×1.8 when nearly out (sim:boss; the plan drafted 100)
  },
  // ── The dad line ──
  {
    // "Confuses" is a dizzy chance.
    id: 'dad-joke',
    name: 'Dad Joke',
    description: 'A joke so groan-worthy it makes heads spin.',
    element: 'frost',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'status', status: 'dizzy', chance: 60 }], // TUNE:
  },
  {
    id: 'lawnmower-rumble',
    name: 'Lawnmower Rumble',
    description: 'Vroom! A frosty lawnmower rumbles over everyone at once.',
    element: 'frost',
    power: 65, // TUNE:
    accuracy: 100,
    targets: 'all-foes',
  },
  {
    id: 'thermostat-lock',
    name: 'Thermostat Lock',
    description: 'Turns the heat right down. Brr! Its target might slow down.',
    element: 'frost',
    power: 70, // TUNE:
    accuracy: 100,
    effects: [{ type: 'stat', target: 'opponent', stat: 'speed', stages: -1, chance: 50 }], // TUNE:
  },
  {
    id: 'ask-your-mother',
    name: 'Ask Your Mother',
    description:
      'Crosses his arms and calls for Mom. She charges in, and he might feel a bit sturdier.',
    element: 'frost',
    power: 0,
    accuracy: 100,
    effects: [
      { type: 'assist', move: 'mama-bear-charge' }, // TUNE: #234 ruling 2
      { type: 'stat', target: 'self', stat: 'defense', stages: 1, chance: 20 }, // TUNE: was +2 at 100% with a heal; sim:boss
    ],
  },
  // ── The kart line ──
  {
    id: 'pit-stop',
    name: 'Pit Stop',
    description: 'A quick tune-up and a juice box. Feels better and zips faster.',
    element: 'spark',
    power: 0,
    accuracy: 100,
    effects: [
      { type: 'heal', percent: 30 }, // TUNE:
      { type: 'stat', target: 'self', stat: 'speed', stages: 1, chance: 100 }, // TUNE:
    ],
  },
  {
    id: 'drift-spin',
    name: 'Drift Spin',
    description: 'A screeching, sparky drift right round everyone.',
    element: 'spark',
    power: 60, // TUNE:
    accuracy: 100,
    targets: 'all-foes',
  },
  {
    id: 'speed-bump',
    name: 'Speed Bump',
    description: 'Bonk! A bumpy hit that might slow its target down.',
    element: 'spark',
    power: 70, // TUNE:
    accuracy: 100,
    effects: [{ type: 'stat', target: 'opponent', stat: 'speed', stages: -1, chance: 30 }], // TUNE:
  },
  // ── The Christmas Eve BIG squishy (#37 X3) ──
  {
    id: 'snow-puff-flop',
    name: 'Snow Puff Flop',
    description: 'A big belly-flop into the snow. FWUMP! Flakes puff over everyone.',
    element: 'frost',
    power: 60, // TUNE:
    accuracy: 100,
    targets: 'all-foes',
  },
  {
    id: 'twinkle-twinkle',
    name: 'Twinkle Twinkle',
    description: 'Its gold crown twinkles so brightly that heads start to spin.',
    element: 'light',
    power: 55, // TUNE:
    accuracy: 100,
    effects: [{ type: 'status', status: 'dizzy', chance: 30 }], // TUNE:
  },
  {
    id: 'snug-scarf-wrap',
    name: 'Snug Scarf Wrap',
    description: 'Snuggles up all warm and cozy. Feels better and a bit sturdier.',
    element: 'frost',
    power: 0,
    accuracy: 100,
    effects: [
      { type: 'heal', percent: 20 }, // TUNE:
      { type: 'stat', target: 'self', stat: 'defense', stages: 1, chance: 50 }, // TUNE:
    ],
  },
  {
    id: 'big-chilly-sneeze',
    name: 'Big Chilly Sneeze',
    description: 'Ah… ah… AH-CHOO! A huge snowy sneeze. It takes a round to build up, so brace!',
    element: 'frost',
    power: 160, // TUNE: like Count to Three, a little softer
    accuracy: 100,
    effects: [{ type: 'windup' }],
  },
];

export const BOSS_SPECIES: Species[] = [
  // ── The rake line (leaf · silly): a leaf pile whose mouth is a rake ──
  {
    // base form
    id: 'pileup',
    name: 'Pileup',
    description: 'A little leaf pile with a rake for a mouth. It giggles when you jump in it.',
    element: 'leaf',
    feeling: 'silly',
    rarity: 'legendary',
    line: 'boss',
    baseStats: { hp: 65, attack: 75, defense: 55, speed: 80 }, // TUNE: total 275
    moves: ['leafy-tickle', 'pollen-puff', 'leaf-pile-leap'],
    evolutions: [],
    visual: {
      body: 'blob',
      palette: RAKE_PALETTE,
      parts: [
        'dot-eyes',
        'soft-brows',
        'rake-bar-small',
        'rake-tines-small',
        'rake-rivets-small',
        'rake-cavity-small',
        'face-freckles',
        'leaf-tuft',
        'stubby-arms',
        'biped-legs',
      ],
      size: 1,
      finish: 'iridescent',
      head: { body: 'orb', size: 0.9, forward: 0.06, up: 0.72 },
      stance: 0.25,
      pose: 'stand',
      attackPart: 'fangs',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['silly'] },
  },
  {
    // middle form
    id: 'rakeling',
    name: 'Rakeling',
    description: 'It rakes every leaf into one big pile. Then it jumps in. Every time.',
    element: 'leaf',
    feeling: 'silly',
    rarity: 'legendary',
    line: 'boss',
    baseStats: { hp: 77, attack: 88, defense: 65, speed: 95 }, // TUNE: total 325
    moves: ['pollen-puff', 'leaf-pile-leap', 'prickle-roll', 'acorn-stash'],
    evolutions: [],
    visual: {
      body: 'upright',
      palette: RAKE_PALETTE,
      parts: [
        'dot-eyes',
        'soft-brows',
        'rake-bar',
        'rake-tines-mid',
        'rake-rivets-mid',
        'rake-cavity',
        'face-freckles',
        'leaf-pile-hair',
        'lanky-arms',
        'lanky-legs',
      ],
      size: 1.36,
      finish: 'iridescent',
      head: { body: 'orb', size: 0.9, forward: 0.06, up: 0.78 },
      stance: 0.3,
      pose: 'upright',
      attackPart: 'fangs',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['silly'] },
  },
  {
    // boss form
    id: 'rakelet',
    name: 'Rakelet',
    description: 'A great big leaf-rake friend. His mouth is the rake, and he never stops raking.',
    element: 'leaf',
    feeling: 'silly',
    rarity: 'mythic',
    line: 'boss',
    baseStats: { hp: 100, attack: 95, defense: 85, speed: 105 }, // TUNE: total 385 (sim:boss)
    moves: ['rake-mouth', 'stink-bomb', 'leaf-pile-pounce', 'count-to-three'], // TUNE: lever A
    evolutions: [],
    visual: {
      body: 'upright',
      palette: RAKE_PALETTE,
      parts: [
        'sharp-eyes',
        'fierce-brows',
        'rake-tool-bar',
        'rake-tool-tines',
        'rake-tool-rivets',
        'rake-tool-cavity',
        'leaf-pile-hair',
        'falling-leaf-top',
        'droop-arms',
        'lanky-legs',
      ],
      size: 1.88,
      finish: 'shimmer',
      head: { body: 'rake-head', size: 0.86, forward: 0.06, up: 0.8 },
      stance: 0.38,
      pose: 'upright',
      attackPart: 'fangs',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['silly'] },
  },
  // ── The mom line (fire · brave): glow on the hair sticks (fire's `glow: 'accent'`) ──
  {
    // base form
    id: 'momo',
    name: 'Momo',
    description: 'A warm little helper with a tidy fringe. It already knows where everything goes.',
    element: 'fire',
    feeling: 'brave',
    rarity: 'legendary',
    line: 'boss',
    baseStats: { hp: 70, attack: 80, defense: 60, speed: 65 }, // TUNE: total 275
    moves: ['ember-boop', 'wiggle-wick', 'cozy-crackle'],
    evolutions: [],
    visual: {
      body: 'pear',
      palette: MOM_PALETTE,
      parts: [
        'oval-eyes',
        'brave-brows',
        'smile',
        'blush-cheeks',
        'fringe',
        'stubby-arms',
        'biped-legs',
      ],
      size: 1,
      finish: 'iridescent',
      glow: 'accent',
      head: { body: 'orb', size: 0.9, forward: 0.06, up: 0.72 },
      stance: 0.22,
      pose: 'stand',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['brave'] },
  },
  {
    // middle form
    id: 'mamarama',
    name: 'Mamarama',
    description: 'Hands on hips, bun piled high. One look and everybody tidies up.',
    element: 'fire',
    feeling: 'brave',
    rarity: 'legendary',
    line: 'boss',
    baseStats: { hp: 84, attack: 89, defense: 74, speed: 68 }, // TUNE: total 315, a little under ×1.18 so the boss still grows from it
    moves: ['toasty-tumble', 'wiggle-wick', 'cozy-crackle', 'the-look'],
    evolutions: [],
    visual: {
      body: 'upright',
      palette: MOM_PALETTE,
      parts: [
        'oval-eyes',
        'brave-brows',
        'smirk',
        'blush-cheeks',
        'fringe',
        'big-bun',
        'akimbo-arms',
        'akimbo-forearms',
        'biped-legs',
      ],
      size: 1.36,
      finish: 'iridescent',
      glow: 'accent',
      head: { body: 'orb', size: 0.8, forward: 0.06, up: 0.8 },
      stance: 0.28,
      pose: 'upright',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['brave'] },
  },
  {
    // boss form
    id: 'mommentum',
    name: 'Mommentum',
    description:
      'A big, bustling mom with a bun bigger than her head. Once she gets going, nothing stops her.',
    element: 'fire',
    feeling: 'brave',
    rarity: 'mythic',
    line: 'boss',
    baseStats: { hp: 100, attack: 92, defense: 86, speed: 70 }, // TUNE: total 348 (sim:boss)
    moves: ['full-name-shout', 'mama-bear-charge', 'the-look', 'bonfire-hug'],
    evolutions: [],
    visual: {
      body: 'cardigan',
      palette: MOM_PALETTE,
      parts: [
        'sharp-eyes',
        'brave-brows',
        'smirk',
        'blush-cheeks',
        'fringe',
        'big-bun',
        'hair-sticks',
        'akimbo-arms',
        'akimbo-forearms',
        'biped-legs',
      ],
      size: 1.88,
      finish: 'shimmer',
      glow: 'accent',
      head: { body: 'orb', size: 0.76, forward: 0.06, up: 0.82 },
      stance: 0.32,
      pose: 'upright',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['brave'] },
  },
  // ── The dad line (frost · cozy) ──
  {
    // base form
    id: 'snowpop',
    name: 'Snowpop',
    description: 'A chilly little fellow in a ball cap. It tells the same joke every day.',
    element: 'frost',
    feeling: 'cozy',
    rarity: 'legendary',
    line: 'boss',
    baseStats: { hp: 85, attack: 60, defense: 85, speed: 45 }, // TUNE: total 275
    moves: ['snowball-toss', 'chilly-yawn', 'snow-snuggle'],
    evolutions: [],
    visual: {
      body: 'blob',
      palette: DAD_PALETTE,
      parts: [
        'oval-eyes',
        'bushy-brows',
        'tiny-smile',
        'blush-cheeks',
        'moustache-small',
        'ball-cap',
        'cap-brim',
        'stubby-arms',
        'sneakers',
      ],
      size: 1,
      finish: 'iridescent',
      head: { body: 'orb', size: 0.9, forward: 0.06, up: 0.72 },
      stance: 0.2,
      pose: 'stand',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['cozy'] },
  },
  {
    // middle form
    id: 'frostpop',
    name: 'Frostpop',
    description: "It keeps the house nice and cold. Don't touch the thermostat!",
    element: 'frost',
    feeling: 'cozy',
    rarity: 'legendary',
    line: 'boss',
    baseStats: { hp: 100, attack: 71, defense: 100, speed: 54 }, // TUNE: total 325
    moves: ['frosty-pounce', 'chilly-yawn', 'snow-snuggle', 'dad-joke'],
    evolutions: [],
    visual: {
      body: 'dad-belly',
      palette: DAD_PALETTE,
      parts: [
        'oval-eyes',
        'bushy-brows',
        'smile',
        'blush-cheeks',
        'moustache-small',
        'ball-cap',
        'cap-brim',
        'dad-belly-patch',
        'dad-arms',
        'sneakers',
      ],
      size: 1.36,
      finish: 'iridescent',
      head: { body: 'orb', size: 0.74, forward: 0.06, up: 0.8 },
      stance: 0.2,
      pose: 'upright',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['cozy'] },
  },
  {
    // boss form
    id: 'papa-brrr',
    name: 'Papa Brrr',
    description: "A huge, frosty dad with a grand moustache. His jokes are so bad they're good.",
    element: 'frost',
    feeling: 'cozy',
    rarity: 'mythic',
    line: 'boss',
    baseStats: { hp: 120, attack: 80, defense: 120, speed: 65 }, // TUNE: total 385 (sim:boss)
    moves: ['lawnmower-rumble', 'thermostat-lock', 'dad-joke', 'ask-your-mother'],
    evolutions: [],
    visual: {
      body: 'dad-belly',
      palette: DAD_PALETTE,
      parts: [
        'oval-eyes',
        'bushy-brows',
        'smile',
        'blush-cheeks',
        'moustache',
        'ball-cap',
        'cap-brim',
        'dad-belly-patch',
        'dad-arms',
        'sneakers',
      ],
      size: 1.88,
      finish: 'shimmer',
      head: { body: 'orb', size: 0.7, forward: 0.06, up: 0.82 },
      stance: 0.22,
      pose: 'upright',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['cozy'] },
  },
  // ── The kart line (spark · silly; coordinator ruling 1 in #810: silly's open eyes) ──
  {
    // base form
    id: 'zoomlet',
    name: 'Zoomlet',
    description: 'A tiny kid in a bumper kart. It honks hello and zooms off before you can wave.',
    element: 'spark',
    feeling: 'silly',
    rarity: 'legendary',
    line: 'boss',
    baseStats: { hp: 60, attack: 70, defense: 50, speed: 95 }, // TUNE: total 275
    moves: ['zip-zap', 'static-fluff', 'zoomies'],
    evolutions: [],
    visual: {
      body: 'kart',
      palette: KART_PALETTE,
      parts: [
        'dot-eyes',
        'soft-brows',
        'open-mouth',
        'blush-cheeks',
        'wind-swoop-small',
        'kart-wheels',
        'steer-arms',
      ],
      size: 0.95,
      finish: 'iridescent',
      head: { body: 'orb', size: 1.02, forward: 0.06, up: 0.78 },
      stance: 0.16,
      pose: 'stand',
      attackPart: 'legs',
    },
    habitatPreferences: { elements: ['spark'], feelings: ['silly'] },
  },
  {
    // middle form
    id: 'revvy',
    name: 'Revvy',
    description: 'Goggles on, engine humming. It never, ever stands still.',
    element: 'spark',
    feeling: 'silly',
    rarity: 'legendary',
    line: 'boss',
    baseStats: { hp: 71, attack: 83, defense: 59, speed: 112 }, // TUNE: total 325
    moves: ['fizzy-pop', 'static-fluff', 'zoomies', 'pit-stop'],
    evolutions: [],
    visual: {
      body: 'kart',
      palette: KART_PALETTE,
      parts: [
        'dot-eyes',
        'soft-brows',
        'open-mouth',
        'blush-cheeks',
        'wind-swoop',
        'goggles',
        'kart-wheels',
        'steer-arms',
        'exhaust-pipes',
      ],
      size: 1.3,
      finish: 'iridescent',
      head: { body: 'orb', size: 0.98, forward: 0.06, up: 0.84 },
      stance: 0.18,
      pose: 'stand',
      attackPart: 'legs',
    },
    habitatPreferences: { elements: ['spark'], feelings: ['silly'] },
  },
  {
    // boss form
    id: 'rickeyride',
    name: 'Rickeyride',
    description: 'The fastest kart in the patch. Watch out for the drift!',
    element: 'spark',
    feeling: 'silly',
    rarity: 'mythic',
    line: 'boss',
    baseStats: { hp: 105, attack: 100, defense: 95, speed: 130 }, // TUNE: total 430 (sim:boss)
    // Fizzy Pop, not Zoomies (sim:boss): two non-hitting moves left it easy
    // for one squishy on its own.
    moves: ['drift-spin', 'speed-bump', 'fizzy-pop', 'pit-stop'],
    evolutions: [],
    visual: {
      body: 'kart',
      palette: KART_PALETTE,
      parts: [
        'dot-eyes',
        'fierce-brows',
        'open-mouth',
        'blush-cheeks',
        'wind-swoop',
        'goggles',
        'kart-wheels',
        'steer-arms-long',
        'exhaust-pipes',
        'kart-antenna',
      ],
      size: 1.8,
      finish: 'shimmer',
      head: { body: 'orb', size: 0.95, forward: 0.06, up: 0.88 },
      stance: 0.2,
      pose: 'stand',
      attackPart: 'legs',
    },
    habitatPreferences: { elements: ['spark'], feelings: ['silly'] },
  },
  // ── The Christmas Eve BIG squishy (#37 X3; frost · sleepy): Christmas-only,
  // never in the weekly bag. Owner decision 4 (2026-11-27): one boss form
  // and a tiny befriend form; Bundlebit is what joins your patch. ──
  {
    // befriend form
    id: 'bundlebit',
    name: 'Bundlebit',
    description:
      'A tiny snow-bundle in a bobble hat. It bounces on the spot and leaves little flakes.',
    element: 'frost',
    feeling: 'sleepy',
    rarity: 'legendary',
    line: 'boss',
    baseStats: { hp: 85, attack: 60, defense: 75, speed: 55 }, // TUNE: total 275
    moves: ['snowball-toss', 'snow-snuggle', 'night-light-hug'],
    evolutions: [],
    visual: {
      body: 'blob',
      palette: SNOW_PALETTE,
      parts: ['sleepy-eyes', 'tiny-smile', 'blush-cheeks', 'acorn-cup', 'lure-beads'],
      size: 1,
      finish: 'iridescent',
      glow: 'accent',
      pose: 'sit',
      attackPart: 'crown',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['sleepy'] },
  },
  {
    // boss form
    id: 'snowbundle',
    name: 'Snowbundle',
    description:
      'A great big, sleepy snow-heap with a twinkly gold crown. It came down from the hills to see the lights.',
    element: 'frost',
    feeling: 'sleepy',
    // Legendary, not mythic: its finish is iridescent, never the shimmer (#866).
    rarity: 'legendary',
    line: 'boss',
    // TUNE: total 309, tuned in `pnpm sim:boss` at the Eve floor (level 10),
    // where little Keepers fight; lower than the weekly bosses because the
    // sim's at-level team there is small (Partner 10 with friends at 7 and 4).
    baseStats: { hp: 95, attack: 70, defense: 88, speed: 56 },
    moves: ['snow-puff-flop', 'twinkle-twinkle', 'snug-scarf-wrap', 'big-chilly-sneeze'],
    evolutions: [],
    visual: {
      body: 'mochi',
      palette: SNOW_PALETTE,
      parts: [
        'sleepy-eyes',
        'tiny-smile',
        'blush-cheeks',
        'dad-belly-patch',
        'fringe',
        'crystal-crown',
        'round-hands',
      ],
      size: 1.4,
      finish: 'iridescent',
      glow: 'accent',
      head: { body: 'orb', size: 1.05, forward: 0.02, up: 0.82 },
      pose: 'sit',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['sleepy'] },
  },
];

/**
 * Growing up (#234 plan, open question 2): base → middle at 30, the
 * legendary evolution level (`species.ts` header), and middle → boss at 50,
 * a grown-up one rarity up (kid + 20). A befriended boss joins its line's
 * base form held below its first evolution (care rules' `befriendBelowEvolution`), so it always has the whole
 * line ahead of it.
 */
export const BOSS_EVOLUTIONS: SecretEvolution[] = [
  { from: 'pileup', into: 'rakeling', level: 30 }, // TUNE:
  { from: 'rakeling', into: 'rakelet', level: 50 }, // TUNE: kid + 20
  { from: 'momo', into: 'mamarama', level: 30 }, // TUNE:
  { from: 'mamarama', into: 'mommentum', level: 50 }, // TUNE: kid + 20
  { from: 'snowpop', into: 'frostpop', level: 30 }, // TUNE:
  { from: 'frostpop', into: 'papa-brrr', level: 50 }, // TUNE: kid + 20
  { from: 'zoomlet', into: 'revvy', level: 30 }, // TUNE:
  { from: 'revvy', into: 'rickeyride', level: 50 }, // TUNE: kid + 20
  // #37 X3: the server joins a befriended boss as its line's base form
  // (`baseFormOf`), so this row is what makes Snowbundle join as Bundlebit.
  // Owner answer (2026-11-28, #37): yes, Bundlebit can grow into Snowbundle at 50.
  { from: 'bundlebit', into: 'snowbundle', level: 50 }, // TUNE:
];
