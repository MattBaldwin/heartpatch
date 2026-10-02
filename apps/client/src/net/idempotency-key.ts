/**
 * A fresh `Idempotency-Key` (tech spec §5) for a command the client may
 * retry. 128 random bits as hex from `crypto.getRandomValues`, which works on
 * plain `http://` too (a phone on the LAN hitting the dev server);
 * `crypto.randomUUID` needs a secure context and would throw there.
 */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
