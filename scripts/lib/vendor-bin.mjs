/**
 * 第三方工具落盘目录（dcg / rg / sqry / ddgr / maou-tui-ratatui）。
 *
 * 源码树：scripts/vendor/bin（跟 ensure-* 走，不占仓库根）
 * 预编译包：<bundle>/vendor/bin（包根自包含，用户包布局不变）
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export function isBundleRoot(root) {
  return existsSync(join(root, "RELEASE.json"));
}

/**
 * @param {string} repoRoot monorepo 根或 bundle 根
 * @param {string} [scriptsDir]
 */
export function vendorBinDir(repoRoot, scriptsDir) {
  const scripts = scriptsDir ?? join(repoRoot, "scripts");
  if (isBundleRoot(repoRoot)) return join(repoRoot, "vendor", "bin");
  return join(scripts, "vendor", "bin");
}

/** ensure-* 在 scripts/ 下：bundle 写包根 vendor/bin，源码树写 scripts/vendor/bin */
export function vendorBinDirFromScriptsDir(scriptsDir) {
  return vendorBinDir(join(scriptsDir, ".."), scriptsDir);
}
