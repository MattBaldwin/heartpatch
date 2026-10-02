import { crc32, deflateSync } from 'node:zlib';

// A minimal PNG encoder (8-bit RGB, no alpha), so the icons and splash screens
// can be drawn at build time without an image dependency.

/** An 8-bit RGB image, rows top to bottom, 3 bytes per pixel. */
export interface Raster {
  width: number;
  height: number;
  pixels: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng({ width, height, pixels }: Raster): Buffer {
  if (pixels.length !== width * height * 3) {
    throw new Error(`expected ${width * height * 3} bytes for ${width}x${height}`);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  // Compression, filter and interlace methods stay 0.

  // Every row starts with filter type 0 (None). The art is mostly flat colour,
  // which deflate packs well without per-row filters.
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
