/**
 * 左上角 MAOU 标识 —— 固定样式（不随终端宽高切换）。
 *
 * 方印编码约定（终端半角高≈两倍宽，一格正方形 = 两列）：
 *   1 → "██"
 *   0 → "  "（两格空格）
 *
 * 位图：
 *   1111111
 *   1011101
 *   1101011
 *   1010101
 *   1111111
 *
 * 右侧文案区：与方印同高的细线边框（贴邻、无间隙）：
 *   ┌──────────────┐
 *   │ MAOU-AGENT   │
 *   │              │
 *   │ v <version>  │
 *   └──────────────┘
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 1 = ██，0 = 两空格 */
const BITMAP = [
  "1111111",
  "1011101",
  "1101011",
  "1010101",
  "1111111",
] as const;

function bitsToRow(bits: string): string {
  let out = "";
  for (const b of bits) {
    out += b === "1" ? "██" : "  ";
  }
  return out;
}

const MONO: string[] = BITMAP.map(bitsToRow);

const TITLE = "MAOU-AGENT";

/**
 * 读 CLI 包 version（package.json）。
 * dist/gallery → ../../package.json；src/gallery → ../../package.json
 */
export function readCliPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "package.json"), // dist/gallery 或 src/gallery → cli/package.json
    join(here, "..", "package.json"),
    join(here, "package.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const pkg = JSON.parse(readFileSync(p, "utf-8")) as { version?: string };
      const v = (pkg.version ?? "").trim();
      if (v) return v;
    } catch {
      /* try next */
    }
  }
  return "0.0.0";
}

/** 框内左对齐：前导 1 空格，右侧 pad 到 innerW */
function boxPad(text: string, innerW: number): string {
  const body = ` ${text}`;
  if (body.length >= innerW) return body.slice(0, innerW);
  return body + " ".repeat(innerW - body.length);
}

/**
 * 固定标：5 行。方印 + 右侧同高边框文案区（贴邻）。
 *
 *   ██████████████┌──────────────┐
 *   ██  ██████  ██│ MAOU-AGENT   │
 *   ████  ██  ████│              │
 *   ██  ██  ██  ██│ v 0.1a       │
 *   ██████████████└──────────────┘
 */
function buildFixedLogo(version: string): string[] {
  const verLabel = version.startsWith("v") || version.startsWith("V")
    ? version
    : `v ${version}`;
  // 内宽：最长文案 + 左右各 1 空格；至少能装下 TITLE
  const innerW = Math.max(TITLE.length, verLabel.length) + 2;
  const top = `┌${"─".repeat(innerW)}┐`;
  const midEmpty = `│${" ".repeat(innerW)}│`;
  const titleRow = `│${boxPad(TITLE, innerW)}│`;
  const verRow = `│${boxPad(verLabel, innerW)}│`;
  const bot = `└${"─".repeat(innerW)}┘`;
  return [
    MONO[0]! + top,
    MONO[1]! + titleRow,
    MONO[2]! + midEmpty,
    MONO[3]! + verRow,
    MONO[4]! + bot,
  ];
}

/** 唯一固定 logo（进程内缓存版本号） */
let cachedLogo: string[] | null = null;

export function getMaouLogo(): string[] {
  if (!cachedLogo) {
    cachedLogo = buildFixedLogo(readCliPackageVersion());
  }
  return cachedLogo;
}

/** @deprecated 用 getMaouLogo()；保留静态导出兼容 */
export const MAOU_LOGO: string[] = getMaouLogo();

export const MAOU_LOGO_MD = MAOU_LOGO;
export const MAOU_LOGO_SM = MAOU_LOGO;
export const MAOU_LOGO_XS = MAOU_LOGO;
export const MAOU_LOGO_COMPACT = MAOU_LOGO;

/**
 * 返回固定 logo 行。
 * cols / compact 保留签名兼容，已忽略。
 */
export function maouLogoLines(_cols?: number, _compact?: boolean): string[] {
  return getMaouLogo();
}

/** 测试用：清缓存 */
export function clearMaouLogoCache(): void {
  cachedLogo = null;
}
