#!/usr/bin/env node
/**
 * 把 src/sounds/*.wav 拷到 dist/sounds/，供生产路径
 * resolve(__dirname, "..", "sounds") 在 dist/hooks/useSound.js 下可用。
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const src = join(root, "src", "sounds");
const dest = join(root, "dist", "sounds");

if (!existsSync(src)) {
  console.warn("[copy-sounds] src/sounds missing, skip");
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
for (const name of readdirSync(src)) {
  if (!name.endsWith(".wav")) continue;
  cpSync(join(src, name), join(dest, name));
}
console.log(`[copy-sounds] ${readdirSync(dest).filter((n) => n.endsWith(".wav")).length} wav → dist/sounds`);
