import type { ComputerPersona } from '../schemas/data/computer-mates.js';

/**
 * The six computer patch-mates (#386, owner decision 1, 2026-11-15). Public:
 * names and blurbs only. How they play is server-only
 * (`@heartpatch/shared/server`, `COMPUTER_MATES`).
 */
export const COMPUTER_PERSONAS: ComputerPersona[] = [
  { id: 'bramble', name: 'Bramble', blurb: 'Loves a tidy patch and a good berry pile.' },
  { id: 'marigold', name: 'Marigold', blurb: 'Always up for a trade. Mostly fair. Very fair!' },
  { id: 'pocket', name: 'Pocket', blurb: 'Small, quick, and full of snacks.' },
  { id: 'thistle', name: 'Thistle', blurb: 'Guards the borders. Secretly very cuddly.' },
  { id: 'wren', name: 'Wren', blurb: 'Hums while tending land. Off key.' },
  { id: 'fennel', name: 'Fennel', blurb: 'Lights the coziest fires on the patch.' },
];
