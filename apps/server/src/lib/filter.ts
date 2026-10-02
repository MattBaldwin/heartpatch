import {
  DataSet,
  englishDataset,
  englishRecommendedTransformers,
  pattern,
  RegExpMatcher,
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

export type FilterReason = 'rude' | 'personal_info';
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

/** Checks one piece of player text. Pure; use `assertAllowedText` in services. */
export function checkText(text: string, kind: TextKind): FilterVerdict {
  const normalized = text.normalize('NFKC');
  if (PERSONAL_INFO_PATTERNS.some((re) => re.test(normalized))) {
    return { ok: false, reason: 'personal_info' };
  }
  const rude =
    matcher.hasMatch(normalized) || (kind === 'name' && matcher.hasMatch(squash(normalized)));
  return rude ? { ok: false, reason: 'rude' } : { ok: true };
}

/** Kid-readable messages (style guide §6). Never say which word matched. */
const MESSAGES: Readonly<Record<TextKind, Readonly<Record<FilterReason, string>>>> = {
  name: {
    rude: "Let's pick a kinder name. Try another one!",
    personal_info: "Names can't have phone numbers, emails, links or addresses. Try a fun one!",
  },
  message: {
    rude: "Let's say that a kinder way!",
    personal_info: "Let's keep phone numbers, emails, links and addresses secret!",
  },
};

/** Throws `VALIDATION_FAILED` with a friendly message when `text` isn't allowed. */
export function assertAllowedText(text: string, kind: TextKind): void {
  const verdict = checkText(text, kind);
  if (!verdict.ok) throw new AppError('VALIDATION_FAILED', MESSAGES[kind][verdict.reason]);
}
