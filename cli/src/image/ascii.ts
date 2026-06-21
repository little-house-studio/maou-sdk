/**
 * 图片→ASCII 转换 pipeline（纯 JS，pngjs 解码）
 * asciiFromImage(path, opts) → string[]，可直接喂 <AsciiArt>
 */
import { readFileSync } from "node:fs";
// @ts-ignore pngjs 无类型声明
import pngjs from "pngjs";
const { PNG } = pngjs;

export type AsciiMode = "ramp" | "block" | "braille" | "half";

export interface AsciiOptions {
  width?: number;          // 目标字符宽（braille/half 模式为像素宽/2）
  mode?: AsciiMode;
  color?: boolean;         // truecolor 前景
  aspect?: number;         // 终端字符高宽比补偿，默认 0.5（字符比像素高）
  ramp?: string;           // ramp 模式字符集
  invert?: boolean;
}

const DEFAULT_RAMP = " .:-=+*#%@";

function decodePng(buf: Buffer): { w: number; h: number; data: Uint8Array } {
  const png = PNG.sync.read(buf);
  return { w: png.width, h: png.height, data: png.data as unknown as Uint8Array };
}

/** 解码图片（PNG 原生；其它格式需先转 PNG 或提供 RGBA） */
export function decodeImage(path: string): { w: number; h: number; data: Uint8Array } {
  const buf = readFileSync(path);
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return decodePng(buf);
  }
  throw new Error("仅原生支持 PNG；其它格式请先转 PNG（或传 RGBA）");
}

function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * 把图片转 ASCII。返回 { lines: string[]; colors?: string[][]（每行每字符 truecolor） }
 */
export function asciiFromImage(
  path: string,
  opts: AsciiOptions = {},
): { lines: string[]; colors?: string[][] } {
  const { width = 60, mode = "block", color = true, aspect = 0.5, ramp = DEFAULT_RAMP, invert = false } = opts;
  const img = decodeImage(path);
  const targetW = width;
  // 块/字符模式：目标像素宽 = targetW（每字符 1 像素列）；braille 每字符 2 列
  const pxPerCharX = mode === "braille" ? 2 : 1;
  const pxPerCharY = mode === "braille" ? 4 : mode === "half" ? 2 : 1;
  const pxW = targetW * pxPerCharX;
  const pxH = Math.round(pxW * (img.h / img.w) * aspect);

  // 采样
  const sample = (sx: number, sy: number): { v: number; c: string } => {
    const ix = Math.min(img.w - 1, Math.floor(sx / pxW * img.w));
    const iy = Math.min(img.h - 1, Math.floor(sy / pxH * img.h));
    const off = (iy * img.w + ix) * 4;
    const r = img.data[off]!, g = img.data[off + 1]!, b = img.data[off + 2]!;
    let v = luminance(r, g, b);
    if (invert) v = 1 - v;
    return { v, c: `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}` };
  };

  const colors: string[][] = [];
  if (mode === "braille") {
    const lines = [];
    for (let cy = 0; cy < pxH; cy += 4) {
      const line = [], lineColors: string[] = [];
      for (let cx = 0; cx < pxW; cx += 2) {
        let bits = 0, lastColor = "#888888";
        const dotMap = [0x01, 0x02, 0x04, 0x40, 0x08, 0x10, 0x20, 0x80];
        for (let dy = 0; dy < 4; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const { v, c } = sample(cx + dx, cy + dy);
            if (v > 0.5) { bits |= dotMap[dy * 2 + dx]!; lastColor = c; }
          }
        }
        line.push(String.fromCharCode(0x2800 + bits));
        lineColors.push(lastColor);
      }
      lines.push(line.join(""));
      colors.push(lineColors);
    }
    return color ? { lines, colors } : { lines };
  }

  if (mode === "half") {
    const lines = [];
    for (let cy = 0; cy < pxH; cy += 2) {
      const top = [], bot = [], lcTop: string[] = [], lcBot: string[] = [];
      for (let cx = 0; cx < pxW; cx++) {
        const t = sample(cx, cy), b2 = sample(cx, cy + 1);
        const tChar = t.v > 0.5 ? "▀" : " ";
        const bChar = b2.v > 0.5 ? "▄" : " ";
        top.push(tChar); lcTop.push(t.c); bot.push(bChar); lcBot.push(b2.c);
      }
      // 简化：每行用 top，合并显示靠渲染器；这里直接返回半块行
      lines.push(top.join(""));
      colors.push(lcTop);
    }
    return color ? { lines, colors } : { lines };
  }

  // ramp / block
  const rampChars = mode === "block" ? " ░▒▓█" : ramp;
  const lines: string[] = [];
  for (let cy = 0; cy < pxH; cy++) {
    let line = "";
    const lc: string[] = [];
    for (let cx = 0; cx < pxW; cx++) {
      const { v, c } = sample(cx, cy);
      const idx = Math.max(0, Math.min(rampChars.length - 1, Math.round(v * (rampChars.length - 1))));
      line += rampChars[idx];
      lc.push(c);
    }
    lines.push(line);
    colors.push(lc);
  }
  return color ? { lines, colors } : { lines };
}
