/** Style guide §9: words never used in player-facing text. */
export const AVOIDED_WORDS = [
  'die',
  'dead',
  'death',
  'kill',
  'faint',
  'hurt',
  'injure',
  'wound',
  'bleed',
  'blood',
  'damage',
  'destroy',
  'crush',
  'slash',
  'stab',
  'bite',
  'attack',
  'weapon',
  'enemy',
  'hate',
  'stupid',
  'loser',
] as const;

/** Data fields that hold player-facing text (names, descriptions, lines, captions). */
export const PLAYER_FACING_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'line',
  'lines',
  'caption',
  'captions',
]);

/**
 * Irregular forms the suffix rule below can't build. Not "bit": "a little
 * bit sticky" is everyday cozy wording (style guide §5).
 */
const IRREGULAR_FORMS = ['dying', 'bitten', 'biting', 'killer', 'hating'];

// Regular inflections too: "dies", "died", "bites", "attacked", "enemies".
const AVOIDED_PATTERN = new RegExp(
  `\\b(?:(?:${AVOIDED_WORDS.map((w) => (w.endsWith('y') ? `${w.slice(0, -1)}(?:y|ies)` : w)).join('|')})(?:s|es|d|ed|ing)?|${IRREGULAR_FORMS.join('|')}s?)\\b`,
  'gi',
);

/** Avoided words found in a piece of text, lowercased, in order. */
export function findAvoidedWords(text: string): string[] {
  return Array.from(text.matchAll(AVOIDED_PATTERN), (m) => m[0].toLowerCase());
}

/**
 * Walks data and reports every player-facing string field that uses an
 * avoided word, as `<path>: "<word>"`. Rows are named by id when they have one.
 */
export function scanPlayerFacingText(root: unknown, label: string): string[] {
  const problems: string[] = [];
  const visit = (node: unknown, path: string, field: string | undefined): void => {
    if (typeof node === 'string') {
      if (field !== undefined && PLAYER_FACING_FIELDS.has(field)) {
        for (const word of findAvoidedWords(node)) problems.push(`${path}: "${word}"`);
      }
    } else if (Array.isArray(node)) {
      node.forEach((item: unknown, i) => {
        const id =
          typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string'
            ? `"${item.id}"`
            : String(i);
        visit(item, `${path}[${id}]`, field);
      });
    } else if (typeof node === 'object' && node !== null) {
      for (const [key, value] of Object.entries(node)) visit(value, `${path}.${key}`, key);
    }
  };
  visit(root, label, undefined);
  return problems;
}
