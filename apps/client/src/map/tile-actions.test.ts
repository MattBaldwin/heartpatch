import { describe, expect, it } from 'vitest';
import { emptyTileActions } from './tile-actions.js';

/** A feature's slot holding the last tile's buttons. */
class Slot {
  buttons = ['Send a gatherer'];
  replaceChildren(): void {
    this.buttons = [];
  }
}

describe('emptyTileActions (#621)', () => {
  it('empties every feature’s slot and keeps the slots for the next tile', () => {
    const slots = [new Slot(), new Slot(), new Slot()];
    const container = { children: slots };
    emptyTileActions(container);
    expect(container.children).toHaveLength(3);
    for (const slot of slots) expect(slot.buttons).toEqual([]);
  });
});
