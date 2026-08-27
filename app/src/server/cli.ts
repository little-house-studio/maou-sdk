#!/usr/bin/env node
/**
 * maou-app —— 只启动桌面客户端，不提供浏览器 HTTP。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mainJs = join(here, "../desktop/main.js");

function electronBin(): string {
  const require = createRequire(import.meta.url);
  try {
    return require("electron") as string;
  } catch {
    throw new Error(
      "找不到 Electron。开发请运行：pnpm --filter @little-house-studio/app dev",
    );
  }
}

function main() {
  if (process.argv.includes("-h") || process.argv.includes("--help")) {
    process.stdout.write(`maou-app — Maou 桌面客户端

Usage:
  maou-app

只开桌面窗口，没有浏览器地址。
`);
    process.exit(0);
  }

  if (!existsSync(mainJs)) {
    process.stderr.write(
      "[maou-app] 缺少 dist/desktop/main.js。先运行：pnpm --filter @little-house-studio/app build\n",
    );
    process.exit(1);
  }

  const child = spawn(electronBin(), [mainJs, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 0);
  });
}

try {
  main();
} catch (e) {
  process.stderr.write(
    `[maou-app] failed: ${e instanceof Error ? e.message : e}\n`,
  );
  process.exit(1);
}
