import { describe, expect, it } from 'vitest';
import { foreignSheets, sheetCards, type OpenSheet } from './sheets.js';

/** A fake open sheet that holds `inside`. */
const sheet = (name: string, inside: object[]): OpenSheet =>
  ({
    element: { className: name, contains: (node: object) => inside.includes(node) },
    rect: { x: 0, y: 0, width: 10, height: 10 },
  }) as unknown as OpenSheet;

describe('foreignSheets (Sprout waits behind sheets, #127)', () => {
  const careButtons = {};
  const care = sheet('care', [careButtons]);
  const report = sheet('hollow-card', []);

  it('is every open sheet when the step has no target on screen', () => {
    expect(foreignSheets([care, report], null)).toEqual([care, report]);
  });

  it("leaves out the sheet that holds the step's own target", () => {
    expect(foreignSheets([care, report], careButtons as HTMLElement)).toEqual([report]);
  });

  it('is empty with nothing open', () => {
    expect(foreignSheets([], null)).toEqual([]);
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
