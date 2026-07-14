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
 * 右侧文案（不隔行贴顶，再隔一行写版本）：
 *   MAOU-AGENT
 *   （空一行）
 *   v <package.json version>
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
const GAP = "  ";

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

/**
 * 固定标：5 行。
 *
 *   ██████████████  MAOU-AGENT     ← 顶行右侧，不隔行
 *   ██  ██████  ██                 ← 隔一行（右侧空）
 *   ████  ██  ████  v 0.3.0        ← 版本（自动读 package.json）
 *   ██  ██  ██  ██
 *   ██████████████
 */
function buildFixedLogo(version: string): string[] {
  const verLabel = version.startsWith("v") ? version : `v ${version}`;
  return [
    MONO[0]! + GAP + TITLE,
    MONO[1]!,
    MONO[2]! + GAP + verLabel,
    MONO[3]!,
    MONO[4]!,
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
