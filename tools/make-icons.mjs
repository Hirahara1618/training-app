// アプリのアイコン（PNG 180/192/512）を作る。外部ライブラリなしで描いて書き出す。
// maskable 用に、絵は中央 60% に収める。出力: src/pwa/icons/

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/pwa/icons");

const BG = [0x1f, 0x26, 0x2e];
const FG = [0xf2, 0xee, 0xe6];
const ACCENT = [0xc8, 0x46, 0x3a];

// 0..1 の座標で描く図形（後に書いたものが上）
const shapes = [
  { c: FG, x0: 0.24, x1: 0.76, y0: 0.475, y1: 0.525 },       // バー
  { c: ACCENT, x0: 0.27, x1: 0.33, y0: 0.32, y1: 0.68 },      // 左プレート（大）
  { c: ACCENT, x0: 0.67, x1: 0.73, y0: 0.32, y1: 0.68 },      // 右プレート（大）
  { c: FG, x0: 0.21, x1: 0.26, y0: 0.38, y1: 0.62 },          // 左プレート（小）
  { c: FG, x0: 0.74, x1: 0.79, y0: 0.38, y1: 0.62 },          // 右プレート（小）
];

function colorAt(u, v) {
  let c = BG;
  for (const s of shapes) if (u >= s.x0 && u < s.x1 && v >= s.y0 && v < s.y1) c = s.c;
  return c;
}

function render(size) {
  const SS = 4; // 4×4 のスーパーサンプリングで縁をなめらかに
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
      const c = colorAt((x + (i + 0.5) / SS) / size, (y + (j + 0.5) / SS) / size);
      r += c[0]; g += c[1]; b += c[2];
    }
    const o = (y * size + x) * 4, n = SS * SS;
    px[o] = r / n; px[o + 1] = g / n; px[o + 2] = b / n; px[o + 3] = 255;
  }
  return px;
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [180, 192, 512]) {
  fs.writeFileSync(path.join(OUT, `icon-${size}.png`), png(size, render(size)));
  console.log(`icon-${size}.png`);
}
