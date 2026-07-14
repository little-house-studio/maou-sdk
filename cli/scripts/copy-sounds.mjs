#!/usr/bin/env node
/**
 * 构建后静态资源拷贝：
 *   - src/sounds/*.wav → dist/sounds/
 *   - src/gallery/works/** → dist/gallery/works/（ASCII 画廊预烘焙）
 *   - assets/** → dist/assets/
 *       · gallery/ + gallery-images.json  画廊
 *       · themes/<name>.json             配色方案（与画廊分离）
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// ── sounds ──
{
  const src = join(root, "src", "sounds");
  const dest = join(root, "dist", "sounds");
  if (existsSync(src)) {
    mkdirSync(dest, { recursive: true });
    for (const name of readdirSync(src)) {
      if (!name.endsWith(".wav")) continue;
      cpSync(join(src, name), join(dest, name));
    }
    console.log(
      `[copy-sounds] ${readdirSync(dest).filter((n) => n.endsWith(".wav")).length} wav → dist/sounds`,
    );
  } else {
    console.warn("[copy-sounds] src/sounds missing, skip");
  }
}

// ── gallery works (ASCII txt) ──
{
  const src = join(root, "src", "gallery", "works");
  const dest = join(root, "dist", "gallery", "works");
  if (existsSync(src)) {
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
    console.log(`[copy-gallery] works → dist/gallery/works`);
  } else {
    console.warn("[copy-gallery] src/gallery/works missing, skip");
  }
}

// ── assets（gallery-images.json + 源图）──
{
  const src = join(root, "assets");
  const dest = join(root, "dist", "assets");
  if (existsSync(src)) {
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
    console.log(`[copy-assets] assets → dist/assets`);
  } else {
    console.warn("[copy-assets] assets/ missing, skip");
  }
}
