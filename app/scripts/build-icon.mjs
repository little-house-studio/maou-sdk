/**
 * Rasterize the Maou square seal into app icon files.
 * Bitmap matches cli/src/gallery/maou-logo.ts (1 = ink, 0 = paper).
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SEAL = ["1111111", "1011101", "1101011", "1010101", "1111111"];
const PAPER = [0xed, 0xed, 0xed, 0xff];
const INK = [0x00, 0x00, 0x00, 0xff];

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function paintSeal(size) {
  const cols = SEAL[0].length;
  const rows = SEAL.length;
  const inner = Math.round(size * 0.68);
  const gap = Math.max(1, Math.round(inner * 0.035));
  const cell = Math.floor((inner - gap * (cols - 1)) / cols);
  const gridW = cols * cell + (cols - 1) * gap;
  const gridH = rows * cell + (rows - 1) * gap;
  const ox = Math.floor((size - gridW) / 2);
  const oy = Math.floor((size - gridH) / 2);
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba.set(PAPER, i * 4);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (SEAL[r][c] !== "1") continue;
      const x0 = ox + c * (cell + gap);
      const y0 = oy + r * (cell + gap);
      for (let y = y0; y < y0 + cell; y++) {
        for (let x = x0; x < x0 + cell; x++) {
          rgba.set(INK, (y * size + x) * 4);
        }
      }
    }
  }
  return encodePng(size, size, rgba);
}

function sealSvg() {
  const cols = SEAL[0].length;
  const rows = SEAL.length;
  const cell = 10;
  const gap = 2;
  const pad = 18;
  const gridW = cols * cell + (cols - 1) * gap;
  const gridH = rows * cell + (rows - 1) * gap;
  const size = Math.max(gridW, gridH) + pad * 2;
  const ox = (size - gridW) / 2;
  const oy = (size - gridH) / 2;
  const rects = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (SEAL[r][c] !== "1") continue;
      rects.push(
        `<rect x="${ox + c * (cell + gap)}" y="${oy + r * (cell + gap)}" width="${cell}" height="${cell}" fill="#000"/>`,
      );
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="#ededed"/>
  ${rects.join("\n  ")}
</svg>
`;
}

const resources = join(appRoot, "resources");
const publicDir = join(appRoot, "src/client/public");
mkdirSync(resources, { recursive: true });
mkdirSync(publicDir, { recursive: true });

const svg = sealSvg();
writeFileSync(join(resources, "icon.svg"), svg);
writeFileSync(join(publicDir, "icon.svg"), svg);
writeFileSync(join(resources, "icon.png"), paintSeal(1024));
writeFileSync(join(publicDir, "icon.png"), paintSeal(256));

console.log("wrote resources/icon.{svg,png} and src/client/public/icon.{svg,png}");
