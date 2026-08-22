#!/usr/bin/env node
/**
 * cli postinstall 包装：源码树第一次 `pnpm install` 时还没有 dist，
 * 直接跑 `node dist/commands/postinstall.js` 会刷 Cannot find module。
 * 缺文件就静默退出；有文件才检查，失败也不阻断安装。
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "dist", "commands", "postinstall.js");
if (!existsSync(entry)) process.exit(0);
const r = spawnSync(process.execPath, [entry], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
process.exit(r.status === 0 ? 0 : 0);
