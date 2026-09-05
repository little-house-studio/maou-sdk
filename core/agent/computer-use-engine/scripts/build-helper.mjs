#!/usr/bin/env node
/**
 * 本机编 darwin Swift helper。无 swift / 非 macOS 时跳过（isAvailable().helper=false）。
 * 预编译包禁止现场编 Swift，走 vendor/bin。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "native", "darwin");
const destDir = join(pkg, "bin");
const dest = join(destDir, "computer-use-helper");

if (process.platform !== "darwin") {
  console.log("[computer-use-helper] 非 macOS，跳过 Swift 构建");
  process.exit(0);
}
if (process.env.MAOU_NATIVE_SKIP === "1") {
  console.log("[computer-use-helper] MAOU_NATIVE_SKIP=1，跳过");
  process.exit(0);
}
if (existsSync(join(process.cwd(), "RELEASE.json")) && process.env.MAOU_BUILD_HELPER !== "1") {
  console.log("[computer-use-helper] bundle 轨不现场编 Swift");
  process.exit(0);
}

const swift = spawnSync("swift", ["--version"], { encoding: "utf8" });
if (swift.status !== 0) {
  console.warn("[computer-use-helper] 未找到 swift，跳过本机构建");
  process.exit(0);
}

console.log("[computer-use-helper] swift build -c release …");
const built = spawnSync(
  "swift",
  ["build", "-c", "release", "--package-path", pkg, "--product", "computer-use-helper"],
  { stdio: "inherit" },
);
if (built.status !== 0) {
  console.warn("[computer-use-helper] swift build 失败（引擎测试仍可用 fixture runner）");
  process.exit(0);
}

const bin = spawnSync(
  "swift",
  ["build", "-c", "release", "--package-path", pkg, "--show-bin-path"],
  { encoding: "utf8" },
);
const binDir = (bin.stdout || "").trim();
const src = join(binDir, "computer-use-helper");
if (!existsSync(src)) {
  console.warn(`[computer-use-helper] 未找到产物: ${src}`);
  process.exit(0);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
chmodSync(dest, 0o755);
console.log(`[computer-use-helper] → ${dest}`);
