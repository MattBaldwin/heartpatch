import type { HouseNote } from '../schemas/data/house.js';

/*
 * The notes residents leave with the daily gift (#381 PR H, plan §1c). A
 * fixed table, never free text (rule 9): `{name}` is the giver's name. Notes
 * with a `feeling` go only with a giver of that feeling; the rest suit anyone.
 * Checked by `checkHouseNotes` (avoided words, one `{name}` each).
 */
export const HOUSE_NOTES: HouseNote[] = [
  { id: 'thought-of-you', line: '{name} found this and thought of you 💛' },
  { id: 'wrapped-it', line: '{name} wrapped this all by themselves! 🎁' },
  { id: 'tiny-bow', line: '{name} left this by the door with a tiny bow 🎀' },
  { id: 'comfy-bed', line: '{name} says thanks for the comfy bed 🛏️' },
  { id: 'pancakes', feeling: 'joy', line: '{name} dreamed about pancakes 🥞' },
  { id: 'happy-wiggle', feeling: 'joy', line: '{name} did a happy wiggle while wrapping this ✨' },
  { id: 'hummed', feeling: 'joy', line: '{name} hummed a song the whole time 🎶' },
  { id: 'by-the-fire', feeling: 'cozy', line: '{name} kept this warm by the fire for you 🔥' },
  { id: 'blanket', feeling: 'cozy', line: '{name} tucked this under a fluffy blanket 🧣' },
  { id: 'cocoa', feeling: 'cozy', line: '{name} made cocoa, then forgot to drink it ☕' },
  { id: 'garden-trip', feeling: 'brave', line: '{name} went on a big trip to the garden 🌻' },
  {
    id: 'kept-watch',
    feeling: 'brave',
    line: '{name} kept watch over this all night. Very serious!',
  },
  { id: 'bookshelf', feeling: 'brave', line: '{name} climbed the bookshelf to find this 📚' },
  { id: 'hat', feeling: 'silly', line: '{name} wore this as a hat for an hour 🙃' },
  { id: 'wrapped-self', feeling: 'silly', line: '{name} tried to wrap themselves too 😂' },
  { id: 'sock', feeling: 'silly', line: '{name} hid this in a sock. Surprise! 🧦' },
  { id: 'dream-find', feeling: 'sleepy', line: '{name} found this in a dream, probably 💤' },
  { id: 'big-yawn', feeling: 'sleepy', line: '{name} yawned so big they dropped this 🥱' },
  { id: 'napped-on-it', feeling: 'sleepy', line: '{name} napped on it to keep it safe 😴' },
  { id: 'cobweb', feeling: 'spooky', line: '{name} found this in a cobweb. Boo! 🕸️' },
  { id: 'moon-said', feeling: 'spooky', line: '{name} says the moon told them where to look 🌙' },
  { id: 'friendly-boo', feeling: 'spooky', line: '{name} left this with a tiny, friendly boo 👻' },
];
