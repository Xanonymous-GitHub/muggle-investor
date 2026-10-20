// One-off generator for public/icons/icon-maskable-512.png. The result is committed; run this
// only when the artwork changes: `bun scripts/make-maskable-icon.ts`.
//
// A maskable icon is cropped by the OS to a circle, a squircle or a rounded square, so the
// background must be full-bleed and the artwork must sit inside the central safe zone: a circle
// of radius 40% of the side (204.8 px of 512). The bars are the ones in icon-512.png, measured
// from that file (a 512 px canvas, colours rgb(15,23,42) and rgb(34,197,94), no anti-aliasing),
// then shrunk about the centre. Output is deterministic: same bytes on every run.
//
// Only node built-ins, so no dependency is added for a file that changes once.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const SIZE = 512;
const BACKGROUND = [15, 23, 42] as const;
const BARS_COLOUR = [34, 197, 94] as const;
/** Bars of icon-512.png as half-open pixel ranges [x0, x1) x [y0, y1). */
const BARS = [
  { x0: 128, x1: 180, y0: 308, y1: 385 },
  { x0: 216, x1: 267, y0: 231, y1: 385 },
  { x0: 303, x1: 354, y0: 144, y1: 385 },
];
/** The artwork's scale about the centre; the original already fits, this leaves air for masks. */
const SCALE = 0.85;
const SAFE_RADIUS = SIZE * 0.4;

const OUTPUT = path.resolve(import.meta.dirname, "../public/icons/icon-maskable-512.png");

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function scaled(value: number): number {
  const centre = SIZE / 2;
  return Math.round(centre + (value - centre) * SCALE);
}

function render(): Buffer {
  const stride = SIZE * 3 + 1; // one filter byte (0 = none) per row
  const raw = Buffer.alloc(stride * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const at = y * stride + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[at + c] = BACKGROUND[c] as number;
    }
  }
  let farthest = 0;
  for (const bar of BARS) {
    const [x0, x1, y0, y1] = [scaled(bar.x0), scaled(bar.x1), scaled(bar.y0), scaled(bar.y1)];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const at = y * stride + 1 + x * 3;
        for (let c = 0; c < 3; c++) raw[at + c] = BARS_COLOUR[c] as number;
      }
    }
    for (const x of [x0, x1]) {
      for (const y of [y0, y1])
        farthest = Math.max(farthest, Math.hypot(x - SIZE / 2, y - SIZE / 2));
    }
  }
  if (farthest > SAFE_RADIUS) {
    throw new Error(`artwork reaches ${farthest.toFixed(1)} px, safe radius is ${SAFE_RADIUS} px`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(OUTPUT, render());
console.log(`wrote ${path.relative(process.cwd(), OUTPUT)}`);
