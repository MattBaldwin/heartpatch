import type { SignupCodeStatus, SignupCodeSummary } from '@heartpatch/shared';

// Words for the owner's "Family codes" section (#195). Pure, so the lines are
// tested without a DOM. Copy follows docs/STYLE_GUIDE.md.

const DAY_MS = 86_400_000;

/** A badge for a code that stopped working; null while it's live. */
export function familyCodeBadge(status: SignupCodeStatus): string | null {
  switch (status) {
    case 'live':
      return null;
    case 'used_up':
      return 'All used up';
    case 'expired':
      return 'Too old';
    case 'revoked':
      return 'Turned off';
  }
}

/** "3 of 8 used · 12 days left" (live), or just the uses once it has ended. */
export function familyCodeMeta(code: SignupCodeSummary, now: number): string {
  const used = `${String(code.uses)} of ${String(code.maxUses)} used`;
  if (code.status !== 'live') return used;
  const days = Math.ceil((Date.parse(code.expiresAt) - now) / DAY_MS);
  return `${used} · ${days <= 1 ? 'last day!' : `${String(days)} days left`}`;
}

/** "Used by maple_leaf, oakley and fern", or null if nobody has yet. */
export function familyCodeUsedBy(code: SignupCodeSummary): string | null {
  const names = code.usedBy;
  if (names.length === 0) return null;
  if (names.length === 1) return `Used by ${names[0] ?? ''}`;
  return `Used by ${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/** Live codes count against the owner's cap. */
export function liveFamilyCodes(codes: readonly SignupCodeSummary[]): number {
  return codes.filter((c) => c.status === 'live').length;
}
