// `admin_audit.action` names (#196), shared by the console and the host scripts.

/**
 * Audit action names (`admin_audit.action`). The host scripts write
 * `admin.granted`, `admin.revoked`, `totp.enrolled` and `player.reset_password`.
 */
export const AUDIT_ACTIONS = {
  signIn: 'admin.sign_in',
  signOut: 'admin.sign_out',
  granted: 'admin.granted',
  revoked: 'admin.revoked',
  totpStarted: 'totp.started',
  totpEnrolled: 'totp.enrolled',
  revealInvite: 'invite.revealed',
  newInvite: 'invite.created',
  approve: 'join_request.approved',
  decline: 'join_request.declined',
  resetPassword: 'player.reset_password',
  logoutEverywhere: 'player.logged_out_everywhere',
  lookup: 'player.lookup',
  createCode: 'signup_code.created',
  extendCode: 'signup_code.extended',
  revokeCode: 'signup_code.revoked',
} as const;
