import { describe, expect, it } from 'vitest';
import { foreignSheets, type OpenSheet } from './sheets.js';

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
