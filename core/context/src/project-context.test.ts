import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileProjectContext } from "./project-context.js";
import { cachedFileReadCount, resetFileTextCache } from "./file-text-cache.js";

describe("compileProjectContext file cache", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    resetFileTextCache();
  });

  it("same mtime does not reread project files", () => {
    const dir = join(tmpdir(), `maou-pc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(join(dir, ".maou", "project"), { recursive: true });
    dirs.push(dir);
    writeFileSync(join(dir, ".maou", "project", "RULE.md"), "no force push\n", "utf-8");
    resetFileTextCache();
    const first = compileProjectContext(dir);
    const reads = cachedFileReadCount();
    expect(first).toContain("no force push");
    expect(reads).toBeGreaterThan(0);
    expect(compileProjectContext(dir)).toBe(first);
    expect(cachedFileReadCount()).toBe(reads);
  });
});
