import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng } from './png.js';

describe('encodePng', () => {
  it('writes a valid RGB PNG', () => {
    const pixels = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]);
    const png = encodePng({ width: 2, height: 2, pixels });

    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    // IHDR: length 13, then width, height, depth 8, colour type 2.
    expect(png.readUInt32BE(8)).toBe(13);
    expect(png.toString('latin1', 12, 16)).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(2);
    expect([png[24], png[25]]).toEqual([8, 2]);
    expect(png.readUInt32BE(29)).toBe(crc32(png.subarray(12, 29)));

    const idatLength = png.readUInt32BE(33);
    expect(png.toString('latin1', 37, 41)).toBe('IDAT');
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    expect([...raw]).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 10, 20, 30]);
    expect(png.toString('latin1', png.length - 8, png.length - 4)).toBe('IEND');
  });

  it('rejects a pixel buffer of the wrong size', () => {
    expect(() => encodePng({ width: 2, height: 2, pixels: new Uint8Array(3) })).toThrow();
  });
});
