#!/usr/bin/env node
/**
 * 本机 macOS 冒烟：对 Finder 走 snapshot。需要辅助功能权限。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const helper = process.env.MAOU_COMPUTER_USE_HELPER
  || join(root, "native", "darwin", "bin", "computer-use-helper");

if (process.platform !== "darwin") {
  console.error("smoke-finder 只在 macOS 上跑");
  process.exit(2);
}
if (!existsSync(helper)) {
  console.error(`缺少 helper: ${helper}（先 pnpm --filter @little-house-studio/computer-use-engine build:helper）`);
  process.exit(2);
}

const req = JSON.stringify({ op: "snapshot", mode: "auto", app: "Finder" });
const r = spawnSync(helper, ["--json"], { input: req, encoding: "utf8", timeout: 60_000 });
if (r.error) {
  console.error(r.error);
  process.exit(1);
}
const out = (r.stdout || "").trim();
console.log(out || r.stderr);
try {
  const env = JSON.parse(out.slice(out.indexOf("{")));
  if (!env.ok) process.exit(1);
  if (!env.snapshotId || !String(env.snapshotId).startsWith("cu1_")) process.exit(1);
  process.exit(0);
} catch {
  process.exit(1);
}
