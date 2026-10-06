import { describe, expect, it } from 'vitest';
import { foreignSheets, sheetCards, type OpenSheet } from './sheets.js';

/** A fake open sheet that holds `inside`. */
const sheet = (name: string, inside: object[]): OpenSheet =>
  ({
    element: { className: name, id: name, contains: (node: object) => inside.includes(node) },
    rect: { x: 0, y: 0, width: 10, height: 10 },
  }) as unknown as OpenSheet;

describe('foreignSheets (Sprout waits behind sheets, #127)', () => {
  const careButtons = { getAttribute: () => null };
  const care = sheet('care', [careButtons]);
  const report = sheet('hollow-card', []);

  it('is every open sheet when the step has no target on screen', () => {
    expect(foreignSheets([care, report], null)).toEqual([care, report]);
  });

  it("leaves out the sheet that holds the step's own target", () => {
    expect(foreignSheets([care, report], careButtons as unknown as HTMLElement)).toEqual([report]);
  });

  it('is empty with nothing open', () => {
    expect(foreignSheets([], null)).toEqual([]);
  });

  it("counts a tray as the step's own while its handle stands in (the tray still sliding)", () => {
    const tray = sheet('tray-adventure', []);
    const handle = {
      getAttribute: (name: string) => (name === 'aria-controls' ? 'tray-adventure' : null),
    };
    expect(foreignSheets([tray, report], handle as unknown as HTMLElement)).toEqual([report]);
  });
});

describe('sheetCards', () => {
  it("is each open sheet's own box when it's a card, not a backdrop", () => {
    const tray = {
      element: {},
      rect: { x: 112, y: 113, width: 278, height: 689 },
    } as unknown as OpenSheet;
    expect(sheetCards([tray], { width: 390, height: 844 })).toEqual([tray.rect]);
  });

  it('is empty with nothing open', () => {
    expect(sheetCards([], { width: 390, height: 844 })).toEqual([]);
  });
});
