import { GAME_EVENTS, rareFindTier, type Rarity, type WsEventMessage } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import './patch-line.css';

/*
 * The patch line (#391, owner decision 2026-10-12: Legendary finds only):
 * when a patch-mate befriends a Legendary squishy, everyone else on the map
 * sees "🌟 Sam befriended a Legendary Thunderplume!" for a few seconds, in the
 * map's own toast spot. The kind is named only to players who have met it
 * (the server's view leaves it out otherwise, CLAUDE.md rule 6). The line
 * waits its turn behind things that come and go quickly at the top (the
 * "What landed" banner, Sprout's hint, other toasts) and while the player is
 * off the map; the land chip, which can stay for days, steps aside for it.
 * Old news is dropped, so a reconnect's replay or a long wait shows nothing.
 */

export const PATCH_LINE = {
  /** How long a line shows (ms). Longer than the land toast's 2.6 s: it names two things. */
  showMs: 4000, // TUNE
  /** A line older than this is dropped instead of shown (ms). */
  staleMs: 3 * 60_000, // TUNE
  /** How often a waiting line looks again (ms). */
  retryMs: 1000,
  /** At most this many lines wait; older ones go first. */
  maxQueued: 3,
} as const;

// Player-facing text (style guide §2, §6).
export const PATCH_LINE_TEXT = {
  line: (name: string, label: string, kind: string | null) =>
    `🌟 ${name} befriended ${article(label)} ${label} ${kind ?? 'squishy'}!`,
  someone: 'Someone',
} as const;

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

export interface PatchLineNews {
  readonly userId: string;
  readonly rarity: Rarity;
  /** Only when the player has met this kind themselves. */
  readonly speciesId?: string;
  /** When it happened (ms since epoch). */
  readonly at: number;
}

/** A `squishy.celebrated` event for this map, if `event` is one. */
export function newsOf(event: WsEventMessage, mapId: string | null): PatchLineNews | null {
  if (event.type !== 'squishy.celebrated' || event.mapId !== mapId) return null;
  const parsed = GAME_EVENTS['squishy.celebrated'].public.safeParse(event.data);
  if (!parsed.success) return null;
  const at = Date.parse(event.at);
  return {
    userId: parsed.data.userId,
    rarity: parsed.data.rarity,
    ...(parsed.data.speciesId !== undefined && { speciesId: parsed.data.speciesId }),
    at: Number.isFinite(at) ? at : 0,
  };
}

/** The words for one piece of news; null for a tier that doesn't tell the patch. */
export function lineFor(
  news: PatchLineNews,
  names: { player: (userId: string) => string | null; kind: (speciesId: string) => string | null },
): string | null {
  const tier = rareFindTier(news.rarity);
  if (!tier?.patchLine || news.rarity === 'secret') return null;
  const kind = news.speciesId !== undefined ? names.kind(news.speciesId) : null;
  return PATCH_LINE_TEXT.line(
    names.player(news.userId) ?? PATCH_LINE_TEXT.someone,
    tier.label,
    kind,
  );
}

/**
 * The waiting lines (pure): newest last, at most `PATCH_LINE.maxQueued`.
 * `take` drops stale ones and hands out the oldest fresh one.
 */
export class PatchLineQueue {
  #items: { text: string; at: number }[] = [];

  add(text: string, at: number, now: number): void {
    if (now - at > PATCH_LINE.staleMs) return;
    this.#items.push({ text, at });
    while (this.#items.length > PATCH_LINE.maxQueued) this.#items.shift();
  }

  take(now: number): string | null {
    this.#items = this.#items.filter((item) => now - item.at <= PATCH_LINE.staleMs);
    return this.#items.shift()?.text ?? null;
  }

  get size(): number {
    return this.#items.length;
  }
}

export interface PatchLineOptions {
  readonly root: HTMLElement;
  /** The map on screen, or null. */
  readonly mapId: () => string | null;
  /** True while the line must wait (off the map, a sheet, another note at the top). */
  readonly busy: () => boolean;
  readonly playerName: (userId: string) => string | null;
  readonly kindName: (speciesId: string) => string | null;
  readonly now?: () => number;
}

export interface PatchLine {
  liveEvent: (event: WsEventMessage) => void;
  readonly debug: { readonly showing: string | null; readonly waiting: number };
  dispose: () => void;
}

export function createPatchLine(options: PatchLineOptions): PatchLine {
  const now = options.now ?? (() => Date.now());
  const queue = new PatchLineQueue();
  const line = el('p', { class: 'patch-line', role: 'status', 'data-testid': 'patch-line' });
  line.hidden = true;
  options.root.append(line);
  let showing: string | null = null;
  let timer = 0;

  const show = (text: string): void => {
    showing = text;
    line.textContent = text;
    line.hidden = false;
    // The land chip (it can stay for days) steps aside while the line shows.
    document.documentElement.dataset['patchLine'] = 'on';
    timer = window.setTimeout(() => {
      showing = null;
      line.hidden = true;
      delete document.documentElement.dataset['patchLine'];
      pump();
    }, PATCH_LINE.showMs);
  };

  /** Shows the next line if nothing is in its way; else looks again soon. */
  function pump(): void {
    window.clearTimeout(timer);
    timer = 0;
    if (showing !== null || queue.size === 0) return;
    if (options.busy()) {
      timer = window.setTimeout(pump, PATCH_LINE.retryMs);
      return;
    }
    const text = queue.take(now());
    if (text !== null) show(text);
  }

  return {
    liveEvent: (event) => {
      const news = newsOf(event, options.mapId());
      if (!news) return;
      const text = lineFor(news, { player: options.playerName, kind: options.kindName });
      if (text === null) return;
      queue.add(text, news.at, now());
      if (showing === null) pump();
    },
    get debug() {
      return { showing, waiting: queue.size };
    },
    dispose: () => {
      window.clearTimeout(timer);
      delete document.documentElement.dataset['patchLine'];
      line.remove();
    },
  };
}
