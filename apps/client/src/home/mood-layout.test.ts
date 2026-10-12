import { describe, expect, it } from 'vitest';
import {
  createMoodLayoutFrame,
  ensureMoodLayoutFrame,
  layoutMoodMarks,
  type MoodLayoutSize,
} from './mood-layout.js';

const SIZE: MoodLayoutSize = {
  width: 30,
  height: 26,
  gap: 6,
  maxLift: 48,
  step: 4,
  slide: 10,
  faceWidth: 0.8,
  faceHeight: 0.5,
  faceCover: 0.25,
};

/** Squishies as [x, top, foot, marked], nearest first. */
function frameOf(rows: [number, number, number, boolean][], size: MoodLayoutSize = SIZE) {
  const frame = createMoodLayoutFrame(2);
  ensureMoodLayoutFrame(frame, rows.length);
  frame.count = rows.length;
  rows.forEach(([x, top, foot, marked], i) => {
    frame.x[i] = x;
    frame.top[i] = top;
    frame.foot[i] = foot;
    frame.marked[i] = marked ? 1 : 0;
    frame.face[i] = 1;
  });
  layoutMoodMarks(frame, size);
  return frame;
}

describe('mood bubble layout (#393)', () => {
  it('sits a lone bubble just over its own head', () => {
    const f = frameOf([[100, 200, 260, true]]);
    expect(f.y[0]).toBe(200 - SIZE.gap);
    expect(f.hidden[0]).toBe(0);
  });

  it('climbs clear of a face it would touch, its stem passing beside it', () => {
    // Strict (any touch counts): a face just behind and to the right
    // (x 101..149, y 150..180) meets the bubble's spot; the stem at x 100
    // passes beside it.
    const f = frameOf(
      [
        [100, 200, 260, true],
        [125, 150, 210, false],
      ],
      { ...SIZE, faceCover: 0 },
    );
    expect(f.y[0]!).toBeLessThanOrEqual(150);
    expect(f.hidden[0]).toBe(0);
  });

  it('keeps two bubbles from covering each other, the nearer one keeping its spot', () => {
    const f = frameOf([
      [100, 200, 260, true],
      [110, 200, 260, true],
    ]);
    expect(f.y[0]).toBe(194);
    // The second climbs above the first bubble (which reaches up to 194 − 26).
    expect(f.y[1]!).toBeLessThanOrEqual(194 - SIZE.height);
  });

  it('hides a bubble with no room clear of faces, rather than covering one', () => {
    // A wall of tall faces right behind: no clear spot within maxLift.
    const f = frameOf([
      [100, 200, 260, true],
      [100, 60, 400, false],
    ]);
    expect(f.hidden[0]).toBe(1);
    expect(f.y[0]).toBe(194);
  });

  it('never lets its stem cross another face: it hides instead', () => {
    // Its own head is hidden low behind a big face in front: climbing over
    // that face would run the stem across it.
    const f = frameOf([
      [100, 120, 300, false],
      [100, 200, 230, true],
    ]);
    expect(f.hidden[1]).toBe(1);
    expect(f.y[1]).toBe(194);
  });

  it('may cover a sliver of a face, but not a real share of it', () => {
    // Its spot clips a corner of a face behind (well under a quarter): it stays.
    const sliver = frameOf([
      [140, 200, 260, true],
      [184, 150, 210, false],
    ]);
    expect(sliver.y[0]).toBe(194);
    expect(sliver.hidden[0]).toBe(0);
    // Right over a face behind: it can't climb (its stem would cross the
    // face), so it hides.
    const share = frameOf([
      [170, 200, 260, true],
      [170, 172, 232, false],
    ]);
    expect(share.hidden[0]).toBe(1);
  });

  it('ignores the face of a squishy tucked out of sight', () => {
    const frame = createMoodLayoutFrame(2);
    frame.count = 2;
    frame.x.set([100, 100]);
    frame.top.set([200, 150]);
    frame.foot.set([260, 210]);
    frame.marked.set([1, 0]);
    frame.face.set([1, 0]);
    layoutMoodMarks(frame, SIZE);
    expect(frame.y[0]).toBe(194);
    expect(frame.hidden[0]).toBe(0);
  });

  it('slides a little sideways before climbing, its tail still over its head', () => {
    // A face behind and to the right (x 94..142, y 170..200) blocks the spot
    // straight up; a step to the left clears it at the same height.
    const f = frameOf([
      [100, 200, 260, true],
      [118, 170, 230, false],
    ]);
    expect(f.hidden[0]).toBe(0);
    expect(f.y[0]).toBe(194);
    expect(f.bx[0]).toBe(90);
  });

  it('leaves unmarked squishies without a bubble', () => {
    const f = frameOf([[100, 200, 260, false]]);
    expect(f.hidden[0]).toBe(0);
    expect(f.y[0]).toBe(0);
  });
});
