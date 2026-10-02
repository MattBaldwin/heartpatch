import type { Wardrobe } from '@heartpatch/shared';
import { sendCommand, type SendDeps } from '../../inventory/send-command.js';
import { messageOf } from '../dom.js';
import { sameOutfit, toggleWorn } from './wardrobe-view.js';

/*
 * Trying clothes on (tech spec §6 "optimistic UI for cosmetic actions"): a
 * tap changes what the preview wears at once; the outfit goes to the server
 * once the player stops tapping, one request at a time, and a refused outfit
 * rolls back to the last one the server kept. No DOM, so it's unit-tested
 * with a fake API and fake timers.
 */

export interface OutfitSyncDeps extends SendDeps {
  /** `POST /wardrobe/wear` with an `Idempotency-Key`. */
  wear: (wearing: readonly string[], key: string) => Promise<Wardrobe>;
  /** How long after the last tap the outfit goes. */
  sendAfterMs: number;
  /** Something the screen shows changed (an answer, a rollback). */
  onChange: () => void;
  /** The server refused the outfit or couldn't be reached (a kid-readable message). */
  onError: (message: string) => void;
}

export class OutfitSync {
  readonly #deps: OutfitSyncDeps;
  #server: Wardrobe | null = null;
  #trying: string[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;
  #inFlight = false;
  #sends = 0;
  /** Bumped by `reset`, so a late answer can't land on another player. */
  #generation = 0;

  constructor(deps: OutfitSyncDeps) {
    this.#deps = deps;
  }

  /** The wardrobe as the server last described it. */
  get server(): Wardrobe | null {
    return this.#server;
  }

  /** What the preview wears: the server's outfit plus taps not sent yet. */
  get trying(): readonly string[] {
    return this.#trying;
  }

  /** Outfits sent so far. */
  get sends(): number {
    return this.#sends;
  }

  /** An outfit waiting to go, or on its way. */
  get sending(): boolean {
    return this.#timer !== null || this.#inFlight;
  }

  /** A fresh wardrobe from the server (open, a find); taps not sent yet stay on. */
  load(wardrobe: Wardrobe): void {
    this.#server = wardrobe;
    if (!this.sending) this.#trying = [...wardrobe.wearing];
  }

  /**
   * A reply that changed the wardrobe but not what's worn (a saved preset, a
   * dev grant): keep the worn outfit we know, since a wear may still be going.
   */
  adoptOwned(wardrobe: Wardrobe): void {
    this.#server = { ...wardrobe, wearing: this.#server?.wearing ?? wardrobe.wearing };
  }

  /** A preset went on: the server says what's worn now, and it replaces taps not sent yet. */
  wore(wardrobe: Wardrobe): void {
    this.cancel();
    this.#server = wardrobe;
    this.#trying = [...wardrobe.wearing];
  }

  /** Taps an item: on, off, or swapped into its slot; sent after a pause. */
  tryOn(itemId: string): void {
    this.#trying = toggleWorn(this.#trying, itemId);
    this.#schedule();
  }

  /** Drops taps not sent yet (a preset is going on instead). */
  cancel(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** Sends taps not sent yet now (the wardrobe is closing). */
  flush(): void {
    if (!this.#timer) return;
    this.cancel();
    void this.#send();
  }

  /** Forgets everything (logout or another player). */
  reset(): void {
    this.cancel();
    this.#generation += 1;
    this.#server = null;
    this.#trying = [];
    this.#inFlight = false;
  }

  #schedule(): void {
    this.cancel();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#send();
    }, this.#deps.sendAfterMs);
  }

  async #send(): Promise<void> {
    const server = this.#server;
    const mine = this.#generation;
    if (!server || this.#inFlight || sameOutfit(this.#trying, server.wearing)) return;
    const target = [...this.#trying];
    this.#inFlight = true;
    this.#sends += 1;
    try {
      const result = await sendCommand(
        this.#deps,
        (key) => this.#deps.wear(target, key),
        () => mine === this.#generation,
      );
      if (mine !== this.#generation || !result) return;
      this.#server = result;
      // Taps that came in meanwhile stay on and go next.
      if (sameOutfit(this.#trying, target)) this.#trying = [...result.wearing];
    } catch (err) {
      if (mine !== this.#generation) return;
      // Roll back to what the server kept (tech spec §6).
      this.#trying = [...(this.#server?.wearing ?? [])];
      this.#deps.onError(messageOf(err));
    } finally {
      if (mine === this.#generation) {
        this.#inFlight = false;
        const kept = this.#server?.wearing ?? [];
        if (!sameOutfit(this.#trying, kept) && !this.#timer) this.#schedule();
        this.#deps.onChange();
      }
    }
  }
}
