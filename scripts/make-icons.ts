// Draws the Tickwise icon (an ink rounded square with a lime tick) as PNGs for the extension, with no
// dependencies: each pixel is supersampled 6 x 6 and written with node:zlib.
//
//   node scripts/make-icons.ts      -> extension/icons/icon-{16,32,48,96,128}.png
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

const OUT = join(import.meta.dirname, "..", "extension", "icons");
const INK = [0x14, 0x14, 0x13];
const LIME = [0x9d, 0xb3, 0x3a];
/** The tick, in the square's own 0..1 space (the same path as the logo in the app). */
const TICK: [number, number][] = [[0.22, 0.53], [0.42, 0.72], [0.78, 0.31]];
const SAMPLES = 6;

/** Transparent margin around the square, in pixels; store icons want room at 128. */
const MARGIN: Record<number, number> = { 16: 0, 32: 1, 48: 2, 96: 4, 128: 10 };

function draw(size: number): Buffer {
  const m = MARGIN[size] ?? 0;
  const side = size - 2 * m;
  const radius = side * 0.22;
  // Thicker at 16px so the tick survives the toolbar.
  const half = (side * (size <= 16 ? 0.15 : 0.13)) / 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0, then RGBA
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) / SAMPLES - m;
          const py = y + (sy + 0.5) / SAMPLES - m;
          if (!inRoundedSquare(px, py, side, radius)) continue;
          const c = nearPolyline(px / side, py / side, half / side) ? LIME : INK;
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

function inRoundedSquare(x: number, y: number, side: number, r: number): boolean {
  if (x < 0 || y < 0 || x > side || y > side) return false;
  const cx = Math.min(Math.max(x, r), side - r);
  const cy = Math.min(Math.max(y, r), side - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Within `half` of the tick's line segments: round caps and joins come for free. */
function nearPolyline(x: number, y: number, half: number): boolean {
  for (let i = 0; i < TICK.length - 1; i++) {
    const [ax, ay] = TICK[i];
    const [bx, by] = TICK[i + 1];
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    if ((x - ax - t * (bx - ax)) ** 2 + (y - ay - t * (by - ay)) ** 2 <= half * half) return true;
  }
  return false;
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
