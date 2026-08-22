/**
 * 第三方工具目录：源码树 scripts/vendor/bin，预编译包 <root>/vendor/bin。
 * 查找时两条都查，避免形态判断出错。
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function guessInstallRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(join(dir, "pnpm-workspace.yaml")) ||
      existsSync(join(dir, "RELEASE.json")) ||
      existsSync(join(dir, "scripts", "ensure-dcg.mjs"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function vendorBinDirs(root: string): string[] {
  return [join(root, "scripts", "vendor", "bin"), join(root, "vendor", "bin")];
}

export function resolveVendorBinary(root: string | null, name: string): string | null {
  if (!root) return null;
  for (const dir of vendorBinDirs(root)) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}
