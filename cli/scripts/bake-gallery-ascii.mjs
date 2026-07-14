#!/usr/bin/env node
/**
 * 用成熟工具 ascii-image-converter 烘焙画芯，再用我们自己的古典画框组装。
 *
 * 依赖：本机已安装 ascii-image-converter
 *   go install github.com/TheZoraiz/ascii-image-converter@latest
 *   或 PATH 中有该二进制
 *
 * 用法:
 *   node scripts/bake-gallery-ascii.mjs \
 *     --src /path/to/painting.png \
 *     --out src/gallery/works/fallen-angel \
 *     [--mode complex|braille]
 *     [--polarity dark|light]
 *       dark  (默认) = 黑底白字：亮部→密字符（亮），暗部→空格（暗）【不加 --negative】
 *       light        = 白底黑字：加 --negative
 *
 * 三档尺寸（画芯固定字符网格）: sm / md / lg
 *
 * 原理：终端字是「浅色前景画在黑底上」，密字符=亮。
 * converter 默认即 dark-pixel→稀 / light-pixel→密，黑底终端直接用默认即可。
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  mkdtempSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 画芯宽度（字符列）。高度由 converter 按原图比例 + 字符宽高比自动算，
 * 禁止 -d 强制高宽（会拉伸失真）。勿对源图做裁切。
 *
 * 约等于：sm 小窗 / md ~1080P / lg ~2K 内容区可用宽的一部分（画廊居中留白）。
 */
const SIZES = {
  sm: { w: 48 },
  md: { w: 72 },
  lg: { w: 100 },
};

function findConverter() {
  const candidates = [
    "ascii-image-converter",
    join(process.env.HOME ?? "", "go", "bin", "ascii-image-converter"),
    join(process.env.GOPATH ?? "", "bin", "ascii-image-converter"),
  ];
  for (const c of candidates) {
    if (!c) continue;
    const r = spawnSync(c, ["--help"], { encoding: "utf-8" });
    if (r.status === 0 || (r.stdout && r.stdout.includes("ascii"))) return c;
  }
  return null;
}

function padEqual(lines) {
  const w = Math.max(0, ...lines.map((l) => l.length));
  return lines.map((l) => l + " ".repeat(w - l.length));
}

/**
 * 内衬垫（画心与外框之间的卡纸）
 * @param side 左右垫宽（字符数）— 加大以平衡上下横线「粗」、竖线「细」的视觉差
 * @param topBot 上下垫行数
 */
function padMat(art, side = 2, topBot = 1, fill = " ") {
  art = padEqual(art);
  const w = art[0]?.length ?? 0;
  const blank = fill.repeat(w + side * 2);
  const s = fill.repeat(side);
  const mid = art.map((ln) => s + ln + s);
  const bars = Array.from({ length: topBot }, () => blank);
  return [...bars, ...mid, ...bars];
}

/**
 * 展厅画框：仅细线边（┌─┐│└┘）+ 卡纸留白。
 * 不再叠 █/▓ 实心外框——实心块留给 logo，画框保持轻、古典。
 */
function frameGallery(art, size) {
  // 侧垫比顶底略多，补偿竖笔画细
  const sidePad = size === "sm" ? 2 : size === "md" ? 3 : 4;
  const topPad = 1;
  let a = padMat(art, sidePad, topPad, " ");
  a = padEqual(a);
  const iw = a[0].length;

  const top = "┌" + "─".repeat(iw) + "┐";
  const bot = "└" + "─".repeat(iw) + "┘";
  const body = a.map((ln) => "│" + ln + "│");
  return padEqual([top, ...body, bot]);
}

const FRAMES = {
  sm: (art) => frameGallery(art, "sm"),
  md: (art) => frameGallery(art, "md"),
  lg: (art) => frameGallery(art, "lg"),
};

/**
 * @param polarity
 *   "dark"  = 黑底白字（Maou TUI 默认）→ **不加** --negative
 *   "light" = 白底黑字 → --negative
 */
function convertCore(bin, src, dims, mode, polarity) {
  const tmp = mkdtempSync(join(tmpdir(), "maou-ascii-"));
  try {
    // 只用 -W：高度跟原图比例走（converter 内部 c_ratio≈2 补偿字符格子）
    const args = [src, "-W", String(dims.w), "--only-save", "--save-txt", tmp + "/"];
    if (mode === "braille") {
      args.push("--braille", "--dither");
    } else if (mode === "dither") {
      // 经典 dither 字符集（暗→亮），黑底终端下亮部密
      args.push("-m", " .:-=+*#%@");
    } else if (mode === "block") {
      args.push("-m", " ░▒▓█");
    } else {
      args.push("--complex");
    }
    // 白底终端才需要反相；黑底直接用 converter 默认映射
    if (polarity === "light") {
      args.push("--negative");
    }
    const r = spawnSync(bin, args, { encoding: "utf-8" });
    if (r.status !== 0) {
      throw new Error(
        `ascii-image-converter failed (W=${dims.w}): ${r.stderr || r.stdout || r.status}`,
      );
    }
    const files = readdirSync(tmp).filter((f) => f.endsWith(".txt"));
    if (!files.length) throw new Error("no txt produced");
    const text = readFileSync(join(tmp, files[0]), "utf-8");
    return text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  // Maou TUI = 黑底浅字 → 默认 dark（无 --negative）
  // mode: complex | dither | block | braille
  const out = { mode: "dither", polarity: "dark" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--src") out.src = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--mode") out.mode = argv[++i];
    else if (a === "--polarity") out.polarity = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.src || !opts.out) {
    console.log(
      `Usage: node bake-gallery-ascii.mjs --src <img> --out <dir>\n` +
        `  [--mode complex|dither|block|braille]  (default: dither)\n` +
        `  [--polarity dark|light]                (default: dark = 黑底)\n` +
        `  高度自动按原图比例，禁止裁切/强制拉伸`,
    );
    process.exit(opts.help ? 0 : 1);
  }
  if (opts.polarity !== "dark" && opts.polarity !== "light") {
    console.error("--polarity must be dark|light");
    process.exit(1);
  }
  const bin = findConverter();
  if (!bin) {
    console.error(
      "ascii-image-converter not found.\n" +
        "  go install github.com/TheZoraiz/ascii-image-converter@latest\n" +
        "  ensure ~/go/bin is on PATH",
    );
    process.exit(1);
  }
  const src = resolve(opts.src);
  const outDir = resolve(opts.out);
  if (!existsSync(src)) {
    console.error("source image missing:", src);
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });

  console.log(`converter: ${bin}`);
  console.log(`mode: ${opts.mode}`);
  console.log(
    `polarity: ${opts.polarity} (${opts.polarity === "dark" ? "黑底白字·无negative" : "白底·negative"})`,
  );
  console.log(`src: ${src}`);

  for (const [size, dims] of Object.entries(SIZES)) {
    const core = convertCore(bin, src, dims, opts.mode, opts.polarity);
    const framed = padEqual(FRAMES[size](core));
    const widths = new Set(framed.map((l) => l.length));
    if (widths.size !== 1) {
      throw new Error(`${size}: uneven line widths ${[...widths]}`);
    }
    const path = join(outDir, `${size}.txt`);
    writeFileSync(path, framed.join("\n") + "\n", "utf-8");
    console.log(
      `${size}: core ${core.length}×${core[0]?.length ?? 0} → framed ${framed.length}×${framed[0].length} → ${path}`,
    );
  }
  console.log("done.");
}

main();
