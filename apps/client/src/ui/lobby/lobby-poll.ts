import type { MyMapsResponse } from '@heartpatch/shared';

// While a join request waits (#145), the lobby asks the server again every
// few seconds, so the row flips to the patch soon after the owner says yes
// (the joiner isn't on the patch's live channel until then). Pure, so it's
// unit-tested.

/** How often the patch list asks again while a request waits, ms. */
export const WAITING_POLL_MS = 5_000; // TUNE: soon enough to feel live, light on the server

/** A fingerprint of what the patch list shows; a change means redraw. */
export function listKey(mine: MyMapsResponse): string {
  const maps = mine.maps.map((m) => `${m.id}:${String(m.memberCount)}`).sort();
  const requests = mine.requests.map((r) => r.id).sort();
  return `${maps.join(',')}|${requests.join(',')}`;
}

/** Patches that showed up since `before`: where a waiting request was answered yes. */
export function joinedSince(before: MyMapsResponse, after: MyMapsResponse): string[] {
  const had = new Set(before.maps.map((m) => m.id));
  return after.maps.filter((m) => !had.has(m.id)).map((m) => m.name);
}
