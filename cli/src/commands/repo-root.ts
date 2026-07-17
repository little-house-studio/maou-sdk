/**
 * monorepo / git 仓库根解析（doctor + update 共用）。
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function hasWorkspace(dir: string): boolean {
  return existsSync(join(dir, "pnpm-workspace.yaml"));
}

function hasGit(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

function walkUp(start: string, pred: (dir: string) => boolean, max = 10): string | null {
  let dir = resolve(start);
  for (let i = 0; i < max; i++) {
    if (pred(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 找 monorepo 根（pnpm-workspace.yaml），不要求 .git。
 */
export function findMonorepoRoot(from?: string): string | null {
  const starts: string[] = [];
  if (from) starts.push(from);
  try {
    starts.push(dirname(fileURLToPath(import.meta.url)));
  } catch {
    /* ignore */
  }
  starts.push(process.cwd());
  if (typeof process.argv[1] === "string") {
    try {
      const entry = realpathSync(process.argv[1]);
      starts.push(dirname(entry));
    } catch {
      starts.push(dirname(resolve(process.argv[1])));
    }
  }

  for (const s of starts) {
    const hit = walkUp(s, hasWorkspace);
    if (hit) return hit;
  }
  return null;
}

/**
 * 找可 git 更新的 SDK 根：pnpm-workspace + .git。
 */
export function findSdkGitRoot(from?: string): string | null {
  const mono = findMonorepoRoot(from);
  if (mono && hasGit(mono)) return mono;

  const starts: string[] = [];
  if (from) starts.push(from);
  starts.push(process.cwd());
  if (typeof process.argv[1] === "string") {
    try {
      starts.push(dirname(realpathSync(process.argv[1])));
    } catch {
      starts.push(dirname(resolve(process.argv[1])));
    }
  }
  try {
    starts.push(dirname(fileURLToPath(import.meta.url)));
  } catch {
    /* ignore */
  }

  for (const s of starts) {
    const hit = walkUp(s, (d) => hasWorkspace(d) && hasGit(d));
    if (hit) return hit;
  }
  return null;
}

/** CLI 包根（@little-house-studio/cli 的 package.json） */
export function resolveCliPackageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", ".."), // dist/commands → cli  or src/commands → cli
    join(here, ".."),
    process.cwd(),
  ];
  if (typeof process.argv[1] === "string") {
    try {
      candidates.unshift(dirname(realpathSync(process.argv[1])));
    } catch {
      candidates.unshift(dirname(resolve(process.argv[1])));
    }
  }
  for (const c of candidates) {
    const pkg = join(c, "package.json");
    if (!existsSync(pkg)) continue;
    try {
      const name = JSON.parse(readFileSync(pkg, "utf-8")).name as string;
      if (name === "@little-house-studio/cli" || name === "maou") return c;
    } catch {
      /* next */
    }
  }
  return join(here, "..", "..");
}
