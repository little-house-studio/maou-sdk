#!/usr/bin/env node
/**
 * maou-app —— 只启动桌面客户端（src-tauri 编出的 Tauri 二进制），不提供浏览器 HTTP。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "../..");
const exe = process.platform === "win32" ? "maou-app.exe" : "maou-app";

/**
 * 只认 release：debug 二进制（tauri dev 产物）页面指向 Vite dev server，单独起是白屏。
 */
function desktopBinary(): string | null {
  const candidates = [
    process.env.MAOU_APP_BIN?.trim(),
    join(appRoot, "src-tauri", "target", "release", exe),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p)) ?? null;
}

function main() {
  if (process.argv.includes("-h") || process.argv.includes("--help")) {
    process.stdout.write(`maou-app — Maou 桌面客户端

Usage:
  maou-app

只开桌面窗口，没有浏览器地址。
环境变量：MAOU_APP_BIN 指定客户端二进制；MAOU_NODE 指定跑 hub 的 node。
`);
    process.exit(0);
  }

  const bin = desktopBinary();
  if (!bin) {
    process.stderr.write(
      "[maou-app] 找不到桌面客户端二进制。\n" +
        "  开发：pnpm --filter @little-house-studio/app dev\n" +
        "  本机编译：pnpm --filter @little-house-studio/app tauri build --no-bundle\n",
    );
    process.exit(1);
  }

  const child = spawn(bin, process.argv.slice(2), {
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
