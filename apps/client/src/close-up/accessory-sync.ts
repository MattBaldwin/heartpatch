import type { SetAccessoryResponse } from '@heartpatch/shared';
import { sendCommand, type SendDeps } from '../inventory/send-command.js';
import { messageOf } from '../ui/dom.js';

/*
 * Dress up (#340), the way the wardrobe tries Keeper clothes on (OutfitSync,
 * tech spec §6 "optimistic UI for cosmetic actions"): a tap shows the piece
 * on the squishy at once; the choice goes to the server once the player stops
 * tapping, one request at a time, and a refused choice rolls back to the
 * piece the server kept. No DOM, so it's unit-tested with a fake API and
 * fake timers.
 */

export interface AccessorySyncDeps extends SendDeps {
  /** `POST /maps/:mapId/squishies/:squishyId/accessory` with an `Idempotency-Key`. */
  put: (itemId: string | null, key: string) => Promise<SetAccessoryResponse>;
  /** How long after the last tap the choice goes. */
  sendAfterMs: number;
  /** What's shown changed (an answer, a rollback). */
  onChange: () => void;
  /** The server kept the latest choice (`itemId` null: nothing on). */
  onKept: (itemId: string | null) => void;
  /** The server refused the choice or couldn't be reached (a kid-readable message). */
  onError: (message: string) => void;
}

export class AccessorySync {
  readonly #deps: AccessorySyncDeps;
  /** The piece the server last said it wears. */
  #kept: string | null = null;
  /** What's drawn: the kept piece, or a tap not answered yet. */
  #shown: string | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #inFlight = false;
  #sends = 0;
  /** Bumped by `reset`, so a late answer can't land on another squishy. */
  #generation = 0;

  constructor(deps: AccessorySyncDeps) {
    this.#deps = deps;
  }

  get kept(): string | null {
    return this.#kept;
  }

  get shown(): string | null {
    return this.#shown;
  }

  /** Choices sent so far. */
  get sends(): number {
    return this.#sends;
  }

  /** A choice waiting to go, or on its way. */
  get sending(): boolean {
    return this.#timer !== null || this.#inFlight;
  }

  /** What the server says it wears (a fresh read); a tap not sent yet stays shown. */
  load(itemId: string | null): void {
    this.#kept = itemId;
    if (!this.sending) this.#shown = itemId;
  }

  /** Puts a piece on (null: takes it off); sent after a pause. */
  choose(itemId: string | null): void {
    this.#shown = itemId;
    this.#schedule();
  }

  /** Sends a choice not sent yet now (the picker or the close-up is closing). */
  flush(): void {
    if (!this.#timer) return;
    clearTimeout(this.#timer);
    this.#timer = null;
    void this.#send();
  }

  /** Forgets everything (another squishy, closing, logout). */
  reset(itemId: string | null = null): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#generation += 1;
    this.#inFlight = false;
    this.#kept = itemId;
    this.#shown = itemId;
  }

  #schedule(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#send();
    }, this.#deps.sendAfterMs);
  }

  async #send(): Promise<void> {
    const mine = this.#generation;
    if (this.#inFlight || this.#shown === this.#kept) return;
    const target = this.#shown;
    this.#inFlight = true;
    this.#sends += 1;
    try {
      const result = await sendCommand(
        this.#deps,
        (key) => this.#deps.put(target, key),
        () => mine === this.#generation,
      );
      if (mine !== this.#generation || !result) return;
      this.#kept = result.accessory;
      // A tap that came in meanwhile stays on and goes next.
      if (this.#shown === target) {
        this.#shown = result.accessory;
        this.#deps.onKept(result.accessory);
      }
    } catch (err) {
      if (mine !== this.#generation) return;
      // Roll back to what the server kept (tech spec §6).
      this.#shown = this.#kept;
      if (this.#timer) clearTimeout(this.#timer);
      this.#timer = null;
      this.#deps.onError(messageOf(err));
    } finally {
      if (mine === this.#generation) {
        this.#inFlight = false;
        if (this.#shown !== this.#kept && !this.#timer) this.#schedule();
        this.#deps.onChange();
      }
    }
  }
}
