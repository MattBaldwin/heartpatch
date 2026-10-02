import { ApiRequestError } from '../net/api.js';

// Small helpers shared by the overlay UIs (tech spec §6).

export type Attrs = Record<string, string>;

/** Builds an element. Text always goes in as text, never as HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/** A message that's safe to show a player for any failure. */
export function messageOf(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : 'Oops, something went wobbly. Try again!';
}

/** The device's IANA time zone, for signup and new maps. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}
