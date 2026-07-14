/**
 * 加载预烘焙 ASCII 画作（三种尺寸）。
 * 运行时不解析图片，避免拖慢启动。
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GallerySize } from "./catalog.js";

function worksRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "works");
}

/** 读取 works/<id>/<size>.txt，失败返回 null */
export function loadFramedArt(workId: string, size: GallerySize): string[] | null {
  const path = join(worksRoot(), workId, `${size}.txt`);
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf-8");
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines.length ? lines : null;
  } catch {
    return null;
  }
}

/**
 * 画廊 ASCII 显示宽度：
 * - █ ▓ ░ 框线等：终端里几乎都是半角宽 1
 * - 普通 CJK：宽 2
 * 之前把 █(U+2588) 当宽 2，导致 centerBlock 以为画比终端更宽 → 不居中/被截断。
 */
export function galleryDisplayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c <= 0x7f) {
      w += 1;
      continue;
    }
    // 块元素 / box-drawing / 常见装饰：等宽 1
    if (
      (c >= 0x2500 && c <= 0x257f) || // box drawing
      (c >= 0x2580 && c <= 0x259f) || // block elements █▓▒░
      (c >= 0x25a0 && c <= 0x25ff) || // geometric ◆ ◈
      c === 0x00b7 || // ·
      c === 0x2039 || // ‹
      c === 0x203a // ›
    ) {
      w += 1;
      continue;
    }
    // 其余（CJK 等）
    w += 2;
  }
  return w;
}

/** 将多行块水平居中到 contentCols 宽 */
export function centerBlock(lines: string[], contentCols: number): string[] {
  if (!lines.length) return lines;
  const maxW = Math.max(...lines.map((l) => galleryDisplayWidth(l)));
  if (maxW >= contentCols) {
    // 过宽：不瞎截 █ 框；尽量原样（Ink 会裁），避免左偏
    return lines;
  }
  const pad = Math.floor((contentCols - maxW) / 2);
  const left = " ".repeat(Math.max(0, pad));
  return lines.map((l) => left + l);
}

export function centerTextLine(text: string, contentCols: number): string {
  const w = galleryDisplayWidth(text);
  if (w >= contentCols) return text;
  const pad = Math.floor((contentCols - w) / 2);
  return " ".repeat(pad) + text;
}

/**
 * 画廊垂直留白（美学 / 光学补偿）
 *
 * 博物馆挂画：光学中心略高于几何中心 → 上方略紧、下方略松。
 * - free 行按上≈38% / 下≈62% 拆
 * - free≥3 时上下都至少 1 行空气
 * - free≥6 时下方至少比上方多 1 行（强化「沉一点」的视觉）
 *
 * @param availableRows 可用来挂「画+铭牌」的行数（通常已扣掉左上 logo）
 * @param contentRows   画+铭牌实际行数（不含 logo）
 */
export function galleryVerticalPads(
  availableRows: number,
  contentRows: number,
): { top: number; bottom: number } {
  const free = Math.max(0, availableRows - contentRows);
  if (free === 0) return { top: 0, bottom: 0 };
  if (free === 1) return { top: 0, bottom: 1 }; // 仅 1 行：留给下方 → 画略偏上
  if (free === 2) return { top: 0, bottom: 2 }; // 两行也沉底，避免 1/1 无光学差
  if (free === 3) return { top: 1, bottom: 2 };

  // 光学偏上：上侧约 36%（floor 保证 free=4 → 1/3，而非 round 的 2/2）
  let top = Math.floor(free * 0.36);
  top = Math.max(1, Math.min(top, free - 2)); // 下方至少 2
  let bottom = free - top;
  // 强制下方 ≥ 上方（博物馆墙：画心略高于几何中心）
  if (bottom < top) {
    top = Math.floor(free / 2);
    bottom = free - top;
  }
  if (bottom === top && free >= 4) {
    top -= 1;
    bottom += 1;
  }
  return { top, bottom };
}
