#!/usr/bin/env node
/**
 * maou 命令 wrapper —— 通过 `node --import preload.mjs` 拉起真正的 TS 入口。
 *
 * 用法（任意项目目录）：
 *   cd /your/project
 *   maou <agent>            # 例如 maou @little-house-studio/coding-agent/cli-config
 *   maou <agent> --cwd dir
 *
 * preload.mjs 提供 Bun shim + tsx 转译 + bun:ffi stub，让 Pi TUI（TS 源码）
 * 在 Node 下跑。本脚本从自身位置定位同包的 preload.mjs 和 src/maou-entry.ts。
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// bin/maou.mjs → preload.mjs（上一级）+ src/maou-entry.ts（上一级进 src）
const preloadPath = join(__dirname, "..", "preload.mjs");
// 开发态直接跑 src TS；生产态跑 dist。优先 src（preload 支持 TS）。
const entryCandidates = [
  join(__dirname, "..", "src", "maou-entry.ts"),
  join(__dirname, "..", "dist", "maou-entry.js"),
];
const entry = entryCandidates.find(p => existsSync(p));

if (!entry || !existsSync(preloadPath)) {
  process.stderr.write(
    `❌ maou 入口文件缺失：\n` +
    `  preload: ${preloadPath}\n` +
    `  entry:   ${entry ?? "(未找到)"}\n` +
    `请确认 @little-house-studio/tui 已正确安装。\n`
  );
  process.exit(1);
}

const child = spawn(process.execPath, ["--import", preloadPath, entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 0));
