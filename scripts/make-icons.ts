// Draws the Tickwise icon (three lines of text, the middle one highlighted in lime, on an ink rounded square) as
// PNGs for the extension, with no dependencies: each pixel is supersampled 6 x 6 and written with node:zlib.
// The shapes match LOGO_SVG in app/index.html and extension/popup.html.
//
//   node scripts/make-icons.ts      -> extension/icons/icon-{16,32,48,96,128}.png
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

const OUT = join(import.meta.dirname, "..", "extension", "icons");
type RGB = [number, number, number];
const INK: RGB = [0x14, 0x14, 0x13];
const LIME: RGB = [0xb5, 0xcc, 0x45];
const GREY: RGB = [0x6e, 0x6c, 0x64];
const SAMPLES = 6;

/** In the logo's 32 x 32 space, painted in order (later shapes on top). */
type Shape = { color: RGB; rect: [number, number, number, number, number] };
const SHAPES: Shape[] = [
  { color: INK, rect: [0, 0, 32, 32, 7] },
  { color: GREY, rect: [7, 7.5, 18, 3, 1.5] },
  { color: LIME, rect: [5.5, 13.5, 21, 5, 1.5] },
  { color: GREY, rect: [7, 21.5, 13, 3, 1.5] },
];

/** Transparent margin around the square, in pixels; store icons want room at 128. */
const MARGIN: Record<number, number> = { 16: 0, 32: 1, 48: 2, 96: 4, 128: 10 };

function colorAt(x: number, y: number): RGB | null {
  let c: RGB | null = null;
  for (const s of SHAPES) if (inRoundedRect(x, y, ...s.rect)) c = s.color;
  return c;
}

function draw(size: number): Buffer {
  const m = MARGIN[size] ?? 0;
  const scale = 32 / (size - 2 * m);
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0, then RGBA
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const c = colorAt((x + (sx + 0.5) / SAMPLES - m) * scale, (y + (sy + 0.5) / SAMPLES - m) * scale);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; hits++;
        }
      }
      const at = 1 + x * 4;
      if (hits > 0) {
        row[at] = Math.round(r / hits);
        row[at + 1] = Math.round(g / hits);
        row[at + 2] = Math.round(b / hits);
        row[at + 3] = Math.round((255 * hits) / (SAMPLES * SAMPLES));
      }
    }
    rows.push(row);
  }
  return png(size, size, Buffer.concat(rows));
}

function inRoundedRect(x: number, y: number, rx: number, ry: number, w: number, h: number, r: number): boolean {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function png(width: number, height: number, raw: Buffer): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of Object.keys(MARGIN).map(Number)) {
  writeFileSync(join(OUT, `icon-${size}.png`), draw(size));
  console.log(`wrote extension/icons/icon-${size}.png`);
}
