#!/usr/bin/env node
/**
 * 根 postinstall —— 尽力补齐外部二进制，任何一步失败都不阻断安装。
 *
 * 以前这里是 `a || true; b || true` 的 shell 串联，在 Windows 的 cmd.exe 下
 * 语义不成立（`;` 不是分隔符），等于 postinstall 在 Windows 上行为不可预期。
 * 改成 Node 脚本，三系统一致。
 *
 * 跳过：MAOU_POSTINSTALL_SKIP=1（CI 里想手工控制顺序时用）
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

if (process.env.MAOU_POSTINSTALL_SKIP === "1") {
  console.log("[postinstall] MAOU_POSTINSTALL_SKIP=1，跳过");
  process.exit(0);
}

const scripts = [
  "ensure-dcg.mjs",
  "ensure-rg.mjs",
  "ensure-sqry.mjs",
  "ensure-ddgr.mjs",
  "ensure-terminal-engine.mjs",
  "ensure-maou-tui.mjs",
];

for (const name of scripts) {
  const p = join(REPO_ROOT, "scripts", name);
  if (!existsSync(p)) continue;
  const r = spawnSync(process.execPath, [p], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
  });
  if (r.status !== 0) {
    console.warn(`[postinstall] ${name} 未成功（不阻断安装；可稍后 maou doctor）`);
  }
}

process.exit(0);
