import type { WsEventMessage } from '@heartpatch/shared';

/**
 * Applies a map's events in `seq` order (tech spec §7 "Ordering on the wire").
 * Events that arrive early wait here until the ones before them come, and
 * anything already applied is dropped, so a replay never applies twice.
 */
export class ReorderBuffer {
  private readonly pending = new Map<number, WsEventMessage>();
  private appliedSeq: number;

  /** `applied`: the last seq already in the client's state (0 = none). */
  constructor(applied: number) {
    this.appliedSeq = applied;
  }

  /** The last seq applied; send it as `afterSeq` to resume. */
  get applied(): number {
    return this.appliedSeq;
  }

  /** True while an event is waiting for an earlier one that hasn't come. */
  get hasGap(): boolean {
    return this.pending.size > 0;
  }

  /** Adds an event; returns the events that are now ready, in order. */
  push(event: WsEventMessage): WsEventMessage[] {
    if (event.seq > this.appliedSeq) this.pending.set(event.seq, event);
    return this.drain();
  }

  /**
   * The server says everything up to `seq` meant for us was sent
   * (`ws.cursor`, `ws.subscribed`). Seqs still missing below it aren't ours,
   * so the waiting events go out and the cursor moves past them.
   */
  advanceTo(seq: number): WsEventMessage[] {
    const ready = [...this.pending.values()]
      .filter((e) => e.seq <= seq)
      .sort((a, b) => a.seq - b.seq);
    for (const e of ready) this.pending.delete(e.seq);
    this.appliedSeq = Math.max(this.appliedSeq, seq);
    return [...ready, ...this.drain()];
  }

  private drain(): WsEventMessage[] {
    const ready: WsEventMessage[] = [];
    for (;;) {
      const next = this.pending.get(this.appliedSeq + 1);
      if (!next) break;
      this.pending.delete(next.seq);
      this.appliedSeq = next.seq;
      ready.push(next);
    }
    // Anything at or below the cursor now is a duplicate.
    for (const seq of this.pending.keys()) if (seq <= this.appliedSeq) this.pending.delete(seq);
    return ready;
  }
}
