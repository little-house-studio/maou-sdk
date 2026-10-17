#!/usr/bin/env node
/**
 * 打包前把 Node hub 摊成自包含目录，给 Tauri 当资源（tauri.pack.conf.json → <Resources>/hub）。
 *
 *   app/.tauri-stage/hub/
 *     package.json dist/desktop/hub-main.js   ← build:hub 产物
 *     node_modules/                          ← 生产依赖（hoisted，无 symlink）
 *
 * Tauri 拷资源不跟随符号链接、遇到断链直接失败，所以这里把链接全部实体化 / 删掉。
 * 原生件（terminal-engine .node）只有本机平台的：必须在目标平台上打包。
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "..");
const stage = join(appRoot, ".tauri-stage", "hub");

function log(msg) {
  process.stdout.write(`[stage-hub] ${msg}\n`);
}
function die(msg) {
  process.stderr.write(`[stage-hub] ERROR: ${msg}\n`);
  process.exit(1);
}

if (!existsSync(join(appRoot, "dist", "desktop", "hub-main.js"))) {
  die("缺少 dist/desktop/hub-main.js，先 pnpm run build");
}

// pnpm deploy（legacy + hoisted）会顺手把被部署项目自己的 node_modules 重链成 hoisted 形态
// （express 的依赖被摊平、原链接挪成 .ignored_*），开发树随之坏掉；部署后比对，变了就按 lockfile 重建。
const devModules = join(appRoot, "node_modules");
const listing = () => (existsSync(devModules) ? readdirSync(devModules).sort().join("\n") : "");
const devBefore = listing();

rmSync(stage, { recursive: true, force: true });
const relOut = relative(repoRoot, stage).split(sep).join("/");
log(`pnpm deploy → ${relOut}`);
const r = spawnSync(
  "pnpm",
  [
    "deploy",
    "--filter=@little-house-studio/app",
    "--prod",
    "--legacy",
    "--config.node-linker=hoisted",
    relOut,
  ],
  { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" },
);
if (listing() !== devBefore) {
  log("pnpm deploy 改动了 app/node_modules，按 lockfile 重建");
  rmSync(devModules, { recursive: true, force: true });
  const fix = spawnSync("pnpm", ["install", "--prefer-offline", "--frozen-lockfile"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (fix.status !== 0) die("重建 app/node_modules 失败，请在仓库根手动 pnpm install");
}
if (r.status !== 0) die("pnpm deploy 失败");
if (!existsSync(join(stage, "dist", "desktop", "hub-main.js"))) {
  die("deploy 后缺少 dist/desktop/hub-main.js");
}

// 页面由 Tauri 自己从 dist/client 出，SDK 类型也用不上
for (const rel of ["dist/client", "dist/sdk", "node_modules/.bin"]) {
  rmSync(join(stage, rel), { recursive: true, force: true });
}

let materialized = 0;
let dropped = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      let target;
      try {
        target = realpathSync(p);
        statSync(target);
      } catch {
        rmSync(p, { force: true });
        dropped++;
        continue;
      }
      rmSync(p, { force: true });
      cpSync(target, p, { recursive: true, dereference: true });
      materialized++;
      if (statSync(p).isDirectory()) walk(p);
    } else if (st.isDirectory()) {
      walk(p);
    }
  }
}
walk(stage);
log(`符号链接：实体化 ${materialized}，删除断链 ${dropped}`);
log(`完成：${stage}`);
