import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const HELPER_NAME = "computer-use-helper";

let cached: string | null | undefined;

function discoverVendorBinDirs(): string[] {
  const dirs: string[] = [];
  const bundle = process.env.MAOU_BUNDLE_ROOT?.trim();
  if (bundle) dirs.push(join(bundle, "vendor", "bin"));
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) || existsSync(join(dir, "RELEASE.json"))) {
      dirs.push(join(dir, "scripts", "vendor", "bin"), join(dir, "vendor", "bin"));
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

function packageHelperPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "native", "darwin", "bin", HELPER_NAME);
}

export function resetHelperPathCache(): void {
  cached = undefined;
}

export function findHelperPath(env: NodeJS.ProcessEnv = process.env): string | null {
  if (cached !== undefined) return cached;
  const override = env.MAOU_COMPUTER_USE_HELPER?.trim();
  const candidates = [
    ...(override ? [override] : []),
    packageHelperPath(),
    ...discoverVendorBinDirs().map((d) => join(d, HELPER_NAME)),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) {
      cached = p;
      return p;
    }
  }
  cached = null;
  return null;
}

export function currentPlatform(): string {
  return platform();
}

export function isDarwin(p = currentPlatform()): boolean {
  return p === "darwin";
}
