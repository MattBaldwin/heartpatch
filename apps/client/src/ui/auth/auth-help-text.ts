import type { HelperReason } from '@heartpatch/shared';

// Words for account help (#197), from the approved mockup. Style guide:
// cozy, short, kid-readable.

export const AUTH_HELP_TEXT = {
  whoPlaying: "Who's playing?",
  someoneElse: 'Someone else',
  notYou: 'Not you?',
  forgetTitle: 'Forget these names?',
  forgetHint: "Nobody's account goes away. You just type your name next time.",
  forget: 'Forget them',
  keep: 'Keep them',
  forgotName: 'Forgot your name?',
  forgotNameSubtitle: "No worries! Here's how to find it.",
  ways: [
    {
      icon: '📱',
      title: 'Use the device you played on',
      body: 'It remembers your name on the log in screen.',
    },
    {
      icon: '💗',
      title: 'Ask your helper or patch owner',
      body: 'They can see your name in the game.',
    },
    {
      icon: '💬',
      title: 'Ask a grown-up for help',
      body: 'They can message the grown-up who runs Heartpatch.',
    },
  ],
  gotIt: 'Got it',
  helperTitle: 'Do you have a grown-up helper?',
  helperSubtitle: 'A helper can remind you of your name, and help if you forget your password.',
  helperLater: 'You can add a helper any time in Settings.',
  maybeLater: 'Maybe later',
  reasons: {
    'invited-you': 'Made your family code',
    'patch-owner': 'Owner of',
    'patch-mate': 'Plays in',
  } satisfies Record<HelperReason, string>,
} as const;

/** "Pip_42", "Pip_42 and Jojo", "Pip_42, MomBear and Jojo". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** The hint under a helper you could pick: why they're on your list. */
export function reasonLine(reason: HelperReason, patchName: string | null): string {
  if (reason === 'invited-you' || patchName === null) return AUTH_HELP_TEXT.reasons[reason];
  return `${AUTH_HELP_TEXT.reasons[reason]} ${patchName}`;
}
