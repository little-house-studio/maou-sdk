#!/usr/bin/env node
/**
 * 将各工具目录下的 schema.json / TOOL.md 拷到 dist 对应路径，
 * 保证仅发布 dist 时 nativeToolSchemas()/toolPrompt() 仍可读到文件。
 * （runtime 的 toolDir 也会在 dist 缺失时回退到 src）
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const srcRoot = join(root, "src");
const distRoot = join(root, "dist");

const ASSETS = new Set(["schema.json", "TOOL.md"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (ASSETS.has(name)) out.push(p);
  }
  return out;
}

let n = 0;
for (const file of walk(srcRoot)) {
  const rel = relative(srcRoot, file);
  const dest = join(distRoot, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(file, dest);
  n++;
}
console.log(`[copy-tool-assets] ${n} files → dist/`);
