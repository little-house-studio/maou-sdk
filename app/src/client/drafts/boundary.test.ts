/**
 * 边界守卫：生产代码不得 import 草稿站（drafts/）。
 * 允许的例外：草稿站自身、草稿宿主（host/draft-*）、main-draft 入口。
 * 测试文件可引用 drafts/fixtures（纯数据）。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "..");

/** 草稿站宿主——草稿站在 client/ 下的合法引用方 */
const DRAFT_HOST_FILES = new Set([
  "main-draft.tsx",
  "host/draft-state.ts",
  "host/draft-slots.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|import\s+)(["'])(\.[^"']+)\1/g;

it("no production module imports the draft station", () => {
  const offenders: string[] = [];
  for (const f of walk(clientRoot)) {
    const rel = relative(clientRoot, f).split(sep).join("/");
    if (rel.startsWith("drafts/")) continue;
    if (/\.test\.tsx?$/.test(rel)) continue;
    if (DRAFT_HOST_FILES.has(rel)) continue;
    const src = readFileSync(f, "utf8");
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(src))) {
      const spec = m[2]!;
      if (
        spec.includes("/drafts/") ||
        spec.endsWith("/drafts") ||
        spec === "./drafts"
      ) {
        offenders.push(`${rel} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
