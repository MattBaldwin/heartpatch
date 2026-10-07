// Pure formatting for the admin console (#196): times, labels and counts.
// No DOM, so it's unit-tested.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "6 min ago", "2 h ago", "yesterday", "3 days ago", else a date. */
export function ago(iso: string | null, now: Date): string {
  if (iso === null) return 'never';
  const then = new Date(iso);
  const ms = now.getTime() - then.getTime();
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${String(Math.floor(ms / MINUTE))} min ago`;
  if (ms < DAY) return `${String(Math.floor(ms / HOUR))} h ago`;
  if (ms < 2 * DAY) return 'yesterday';
  if (ms < 14 * DAY) return `${String(Math.floor(ms / DAY))} days ago`;
  return shortDate(iso);
}

/** How long something has waited: "4 h", "2 days". */
export function age(iso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(iso).getTime());
  if (ms < HOUR) return `${String(Math.max(1, Math.floor(ms / MINUTE)))} min`;
  if (ms < DAY) return `${String(Math.floor(ms / HOUR))} h`;
  const days = Math.floor(ms / DAY);
  return `${String(days)} day${days === 1 ? '' : 's'}`;
}

/** A request waiting a day or more is worth a nudge. */
export function waitingLong(iso: string, now: Date): boolean {
  return now.getTime() - new Date(iso).getTime() >= DAY;
}

/** "Oct 3" in the viewer's own time zone. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Oct 7, 2:14 PM". */
export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** A `YYYY-MM-DD` date, as the night of a nightfall: "Oct 6". */
export function nightLabel(date: string): string {
  return shortDate(`${date}T12:00:00Z`);
}

/** m:ss until a moment, never below zero. */
export function countdown(iso: string, now: Date): string {
  const s = Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 1000));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

const PVP: Record<string, string> = { on: 'On', gentle: 'Gentle', off: 'Off' };
export const pvpLabel = (mode: string): string => PVP[mode] ?? mode;

/** `admin_audit.action` names as people read them. */
const ACTIONS: Record<string, string> = {
  'admin.sign_in': 'Signed in',
  'admin.sign_out': 'Signed out',
  'admin.granted': 'Granted admin',
  'admin.revoked': 'Took admin away',
  'totp.started': 'Started authenticator setup',
  'totp.enrolled': 'Enrolled authenticator',
  'invite.revealed': 'Showed invite code',
  'invite.created': 'Made new invite code',
  'join_request.approved': 'Approved join request',
  'join_request.declined': 'Declined join request',
  'player.reset_password': 'Reset password',
  'player.logged_out_everywhere': 'Logged out everywhere',
  'player.lookup': 'Looked up a username',
  'signup_code.created': 'Made family code',
  'signup_code.extended': 'Extended family code',
  'signup_code.revoked': 'Turned off family code',
};
export const actionLabel = (action: string): string => ACTIONS[action] ?? action;

/** What an audit row was about, from its targets and non-secret detail. */
export function auditTarget(entry: {
  targetUser: string | null;
  targetMap: string | null;
  detail: Record<string, unknown>;
}): string {
  const { detail } = entry;
  const parts: string[] = [];
  if (entry.targetUser) parts.push(entry.targetUser);
  if (entry.targetMap) parts.push(entry.targetMap);
  if (typeof detail['patch'] === 'string') {
    parts.push(
      `patch "${detail['patch']}", joined ${String(detail['from'])} – ${String(detail['to'])}`,
    );
  }
  if (typeof detail['label'] === 'string') parts.push(`"${detail['label']}"`);
  if (typeof detail['days'] === 'number' && detail['label'] === undefined) {
    parts.push(`+${plural(detail['days'], 'day')}`);
  }
  if (detail['reason'] === 'code') parts.push('wrong authenticator code');
  if (detail['reason'] === 'password') parts.push('wrong password');
  return parts.length > 0 ? parts.join(' → ') : '—';
}

const CODE_STATUS: Record<string, string> = {
  live: 'live',
  used_up: 'used up',
  expired: 'expired',
  revoked: 'turned off',
};
export const codeStatusLabel = (status: string): string => CODE_STATUS[status] ?? status;

const PATCH_STATUS: Record<string, string> = {
  owner: 'owner',
  member: 'member',
  requested: 'asked to join',
  left: 'left',
};
export const patchStatusLabel = (status: string): string => PATCH_STATUS[status] ?? status;

/** Today and a week ago as `YYYY-MM-DD`, for the lookup form's defaults. */
export function lastWeek(now: Date): { from: string; to: string } {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { from: day(new Date(now.getTime() - 7 * DAY)), to: day(now) };
}
