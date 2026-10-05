import {
  DataSet,
  englishDataset,
  englishRecommendedTransformers,
  englishRecommendedWhitelistMatcherTransformers,
  pattern,
  RegExpMatcher,
  resolveConfusablesTransformer,
  resolveLeetSpeakTransformer,
  toAsciiLowerCaseTransformer,
} from 'obscenity';
import { AppError } from './errors.js';

/**
 * The server-side text filter (tech spec §9). Every piece of player-typed
 * text (usernames, nicknames, outfit names, quick-message text, chat) passes
 * through here before it is stored or broadcast. The client never filters.
 */

/**
 * What the text is. Names (usernames, nicknames, outfit names) are also
 * checked with separators removed, so "b_a_d" counts as "bad". Messages
 * aren't squashed, since joining every word would flag innocent sentences.
 */
export type TextKind = 'name' | 'message';

export type FilterReason = 'rude' | 'potty' | 'personal_info';
export type FilterVerdict = { ok: true } | { ok: false; reason: FilterReason };

// Extra phrases the English dataset doesn't cover (hate symbols aimed at kids'
// spaces). Keep this short: obscenity handles leetspeak and look-alikes.
const extraPhrases = new DataSet<{ originalWord: string }>()
  .addPhrase((p) => p.setMetadata({ originalWord: 'hitler' }).addPattern(pattern`hitler`))
  .addPhrase((p) => p.setMetadata({ originalWord: 'nazi' }).addPattern(pattern`nazi`));

const matcher = new RegExpMatcher({
  ...new DataSet<{ originalWord: string }>().addAll(englishDataset).addAll(extraPhrases).build(),
  ...englishRecommendedTransformers,
});

/**
 * Mild potty words, kept out of player-chosen names only (owner decision
 * 2026-10-05, #155: "Mr Poop Butt" was showing on every screen). Not rude
 * enough for the English dataset, and fine in a future message. `|` marks a
 * word boundary (obscenity's pattern syntax) where the word hides inside
 * everyday ones ("Saturday", "scrapbook", "peek", "Dumbo"); the rest are
 * matched anywhere, with the everyday words that contain them whitelisted,
 * so a squashed name ("MrPoopButt") still counts. TUNE: the list.
 */
const POTTY_WORDS: readonly {
  readonly word: string;
  readonly pattern: ReturnType<typeof pattern>;
  /** Everyday words that hold it; never a reason to refuse a name. */
  readonly allow?: readonly string[];
}[] = [
  { word: 'poop', pattern: pattern`poop` },
  { word: 'poo', pattern: pattern`|poo|` },
  {
    word: 'butt',
    pattern: pattern`butt`,
    allow: ['butter', 'button', 'buttress', 'rebuttal', 'abutting'],
  },
  { word: 'fart', pattern: pattern`fart`, allow: ['farther', 'farthest', 'farthing'] },
  { word: 'booger', pattern: pattern`booger` },
  { word: 'puke', pattern: pattern`puke` },
  { word: 'barf', pattern: pattern`|barf|` },
  { word: 'pee', pattern: pattern`|pee|` },
  { word: 'wee', pattern: pattern`|wee wee|` },
  { word: 'crap', pattern: pattern`|crap|` },
  { word: 'dumb', pattern: pattern`|dumb|` },
  { word: 'stupid', pattern: pattern`stupid` },
  { word: 'loser', pattern: pattern`loser` },
];

const pottyDataset = new DataSet<{ originalWord: string }>();
for (const { word, pattern: p, allow = [] } of POTTY_WORDS) {
  pottyDataset.addPhrase((phrase) => {
    phrase.setMetadata({ originalWord: word }).addPattern(p);
    for (const term of allow) phrase.addWhitelistedTerm(term);
    return phrase;
  });
}
// The English set's transformers also collapse repeated letters ("butt"
// reads as "but") and skip separators (so "|pee|" could never find a
// boundary inside "Sir Pee"); its own patterns allow for both. These are
// plain words with their doubles and boundaries, so they get look-alikes,
// leetspeak and case handled here, and separators through `squash`.
const pottyMatcher = new RegExpMatcher({
  ...pottyDataset.build(),
  blacklistMatcherTransformers: [
    resolveConfusablesTransformer(),
    resolveLeetSpeakTransformer(),
    toAsciiLowerCaseTransformer(),
  ],
  whitelistMatcherTransformers: englishRecommendedWhitelistMatcherTransformers,
});

/**
 * Personal details a kid shouldn't share (design doc §17): phone numbers,
 * emails, links and street addresses.
 */
const PERSONAL_INFO_PATTERNS: readonly RegExp[] = [
  // Phone numbers: 7+ digits, allowing spaces, dots, dashes, underscores, parens.
  /(?:\d[\s._()-]*){7,}/,
  // Emails, including "name at host dot com" spellings.
  /[\w.+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[\w-]+\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z]{2,}/i,
  // Links: schemes, www., and bare domains with a common top-level domain.
  /\b(?:https?:\/\/|www\.)\S/i,
  /\b[\w-]+\s*(?:\.|\(dot\)|\sdot\s)\s*(?:com|net|org|io|co|us|uk|ca|au|gg|tv|me|app|dev|xyz|info|biz|ly)\b/i,
  // Street addresses: a house number followed by a street name and type.
  /\b\d{1,6}\s+(?:[a-z]+\s+){1,3}(?:st|street|rd|road|ave|avenue|blvd|boulevard|ln|lane|dr|drive|ct|court|way|pl|place|terrace|cir|circle|hwy|highway)\b/i,
];

/** Letters and digits only, so separators can't hide a word in a name. */
const squash = (text: string): string => text.replace(/[^\p{L}\p{N}]+/gu, '');

/** The words of a name on their own ("crap_pal" → "crap", "pal"), so a bounded pattern can see their edges. */
const words = (text: string): string[] => text.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');

/** Checks one piece of player text. Pure; use `assertAllowedText` in services. */
export function checkText(text: string, kind: TextKind): FilterVerdict {
  const normalized = text.normalize('NFKC');
  if (PERSONAL_INFO_PATTERNS.some((re) => re.test(normalized))) {
    return { ok: false, reason: 'personal_info' };
  }
  const rude =
    matcher.hasMatch(normalized) || (kind === 'name' && matcher.hasMatch(squash(normalized)));
  if (rude) return { ok: false, reason: 'rude' };
  // Names only (owner decision 2026-10-05): a name is on every screen, for everyone.
  const potty =
    kind === 'name' &&
    (words(normalized).some((w) => pottyMatcher.hasMatch(w)) ||
      pottyMatcher.hasMatch(squash(normalized)));
  return potty ? { ok: false, reason: 'potty' } : { ok: true };
}

/** Kid-readable messages (style guide §6). Never say which word matched. */
const MESSAGES: Readonly<Record<TextKind, Readonly<Record<FilterReason, string>>>> = {
  name: {
    rude: "Let's pick a kinder name. Try another one!",
    potty: "Let's keep names sweet, not stinky! Try another one.",
    personal_info: "Names can't have phone numbers, emails, links or addresses. Try a fun one!",
  },
  message: {
    rude: "Let's say that a kinder way!",
    potty: "Let's keep it sweet, not stinky!",
    personal_info: "Let's keep phone numbers, emails, links and addresses secret!",
  },
};

/** Throws `VALIDATION_FAILED` with a friendly message when `text` isn't allowed. */
export function assertAllowedText(text: string, kind: TextKind): void {
  const verdict = checkText(text, kind);
  if (!verdict.ok) throw new AppError('VALIDATION_FAILED', MESSAGES[kind][verdict.reason]);
}
