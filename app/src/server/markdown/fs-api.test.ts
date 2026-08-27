/**
 * Unit tests for shipped fs-api (path safety + md tree/read/write).
 * Run: pnpm exec tsx --test src/server/markdown/fs-api.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveSafePath,
  listMarkdownTree,
  readProjectFile,
  writeProjectFile,
  createMarkdownFile,
} from "./fs-api.js";

const root = join(tmpdir(), `maou-fs-api-test-${process.pid}`);

before(() => {
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "a.md"), "# A\n", "utf8");
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveSafePath", () => {
  it("rejects path traversal", () => {
    assert.throws(() => resolveSafePath(root, "../x.md"), /outside/);
    assert.throws(() => resolveSafePath(root, "/etc/passwd"), /outside/);
  });

  it("accepts in-root relative path", () => {
    const abs = resolveSafePath(root, "docs/a.md");
    assert.ok(abs.endsWith("a.md"));
  });
});

describe("markdown tree and files", () => {
  it("lists md tree", () => {
    const tree = listMarkdownTree(root);
    assert.ok(JSON.stringify(tree).includes("a.md"));
  });

  it("reads and writes markdown", () => {
    writeProjectFile(root, "docs/a.md", "# A\n\nchanged\n");
    const f = readProjectFile(root, "docs/a.md");
    assert.ok(f.content.includes("changed"));
  });

  it("creates markdown", () => {
    const c = createMarkdownFile(root, "docs/b.md", "# B\n");
    assert.equal(c.path, "docs/b.md");
    assert.ok(readProjectFile(root, "docs/b.md").content.includes("# B"));
  });

  it("rejects non-markdown", () => {
    assert.throws(() => writeProjectFile(root, "docs/x.txt", "nope"), /markdown/);
  });
});
