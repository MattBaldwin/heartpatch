import type { FeelingId } from '../schemas/data/elements.js';
import type { EvolutionRules, Whisper } from '../schemas/data/evolution-odds.js';
import type { EvolutionForm } from './roll.js';

/**
 * The care sheet's whisper (#32): from `whisper.fromPercent` of the evolving
 * meter, a line that hints at what is shaping the next evolution. A line
 * with a feeling branch names the feeling that's winning; a line with only
 * rare branches hints at the first one's condition. A feeling whisper keeps
 * its second line only when that feeling leads to a branch. It never names a form
 * or a chance. Null with no meter (a top form, a secret step) or no branch.
 * `forms` are the squishy's next step (`stepForms(id, 100, …)`).
 */
export function whisperFor(
  squishy: {
    readonly name: string;
    readonly evolvingPercent: number | null;
    readonly dominant: FeelingId;
  },
  forms: readonly EvolutionForm[],
  rules: Pick<EvolutionRules, 'whisper'>,
): Whisper | null {
  const percent = squishy.evolvingPercent;
  if (percent === null || percent < rules.whisper.fromPercent) return null;
  const branches = forms.flatMap((f) => (f.trigger ? [f.trigger] : []));
  if (branches.length === 0) return null;
  const rare = branches.find((t) => t.kind === 'rare');
  const feeling = branches.some((t) => t.kind === 'feeling');
  const found = feeling
    ? rules.whisper.feelings[squishy.dominant]
    : rare?.kind === 'rare'
      ? rare.whisper
      : null;
  if (!found) return null;
  // "Something about it is changing" only when the winning feeling leads somewhere.
  const leads = branches.some((t) => t.kind === 'feeling' && t.feeling === squishy.dominant);
  const whisper = feeling && !leads ? { icon: found.icon, text: found.text } : found;
  const named = (text: string) => text.replaceAll('{name}', squishy.name);
  return {
    icon: whisper.icon,
    text: named(whisper.text),
    ...(whisper.sub !== undefined && { sub: named(whisper.sub) }),
  };
}
