import { createHash } from 'node:crypto';

/**
 * A name-based uuid (RFC 9562 version 5: SHA-1 of the namespace and the
 * name). The same namespace and name always give the same uuid, so a
 * one-per-account grant can key a unique `ref_id` per player (the Seedling
 * Scarf, #24) and retries land on the same row.
 */
export function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  if (ns.length !== 16) throw new Error(`uuidV5: "${namespace}" is not a uuid`);
  const bytes = createHash('sha1').update(ns).update(name, 'utf8').digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
