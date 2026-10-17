/**
 * Node hub 入口（Tauri 壳拉起的子进程）→ dist/desktop/hub-main.js。
 * 依赖保持 external：运行时从包根 node_modules 解析（dev = app/，打包 = 资源里的 hub/）。
 */
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = dirname(fileURLToPath(import.meta.url));
const appRoot = join(root, "..");
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

// 清掉旧产物（含 Electron 时代的 main.js / preload.cjs），免得被 stage:hub 一起打包
const outDir = join(appRoot, "dist/desktop");
rmSync(outDir, { recursive: true, force: true });

await esbuild.build({
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  sourcemap: true,
  logLevel: "info",
  entryPoints: [join(appRoot, "src/desktop/hub-main.ts")],
  outfile: join(outDir, "hub-main.js"),
});
