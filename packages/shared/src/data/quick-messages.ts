import type { QuickMessage, QuickMessageData } from '../schemas/data/quick-messages.js';

/**
 * Phase 1 chat (design doc §17): presets, emoji and squishy stickers. Ids are
 * stable keys stored in `quick_messages`, so never rename or remove one (a
 * retired message would leave old feed rows without words). Lines follow the
 * style guide (cozy, short, no avoided words); checked by
 * `checkQuickMessages` and the content test.
 */
export const QUICK_MESSAGES: QuickMessageData = {
  messages: [
    { id: 'hi', kind: 'phrase', line: 'Hi there!' },
    { id: 'thank-you', kind: 'phrase', line: 'Thank you!' },
    { id: 'nice-move', kind: 'phrase', line: 'Nice move!' },
    { id: 'so-cute', kind: 'phrase', line: 'So cute!' },
    { id: 'want-to-trade', kind: 'phrase', line: 'Want to trade?' },
    { id: 'getting-dark', kind: 'phrase', line: 'Watch out, it’s getting dark!' },
    { id: 'light-a-fire', kind: 'phrase', line: 'Let’s light a fire!' },
    { id: 'help-me', kind: 'phrase', line: 'Can you help me?' },
    { id: 'on-my-way', kind: 'phrase', line: 'On my way!' },
    { id: 'come-visit', kind: 'phrase', line: 'Come visit my patch!' },
    { id: 'good-game', kind: 'phrase', line: 'Good game!' },
    { id: 'oops', kind: 'phrase', line: 'Oopsie!' },
    { id: 'good-morning', kind: 'phrase', line: 'Good morning!' },
    { id: 'good-night', kind: 'phrase', line: 'Good night, squishies!' },
    { id: 'heart', kind: 'emoji', emoji: '💖', name: 'Heart' },
    { id: 'sparkles', kind: 'emoji', emoji: '✨', name: 'Sparkles' },
    { id: 'wave', kind: 'emoji', emoji: '👋', name: 'Wave' },
    { id: 'giggle', kind: 'emoji', emoji: '😆', name: 'Giggle' },
    { id: 'thumbs-up', kind: 'emoji', emoji: '👍', name: 'Thumbs up' },
    { id: 'pumpkin', kind: 'emoji', emoji: '🎃', name: 'Pumpkin' },
    { id: 'ghost', kind: 'emoji', emoji: '👻', name: 'Little ghost' },
    { id: 'sleepy', kind: 'emoji', emoji: '😴', name: 'Sleepy' },
    { id: 'sticker-puddlepuff', kind: 'sticker', speciesId: 'puddlepuff', name: 'Puddlepuff' },
    {
      id: 'sticker-pebblesnooze',
      kind: 'sticker',
      speciesId: 'pebblesnooze',
      name: 'Pebblesnooze',
    },
    { id: 'sticker-emberbun', kind: 'sticker', speciesId: 'emberbun', name: 'Emberbun' },
    { id: 'sticker-gourdon', kind: 'sticker', speciesId: 'gourdon', name: 'Gourdon' },
    { id: 'sticker-glowboo', kind: 'sticker', speciesId: 'glowboo', name: 'Glowboo' },
  ],
  feedLimit: 30, // TUNE: guess; a busy evening on a family patch
};

const BY_ID: ReadonlyMap<string, QuickMessage> = new Map(
  QUICK_MESSAGES.messages.map((m) => [m.id, m]),
);

/** A quick message by id, or undefined for an id nobody knows. */
export function quickMessageById(id: string): QuickMessage | undefined {
  return BY_ID.get(id);
}
