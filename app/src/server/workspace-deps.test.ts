/**
 * 防止 app 再引用未声明的 workspace 包（官方 `pnpm -r build` 会 TS2307 死掉）。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function walkTs(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, acc);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

describe("app workspace deps", () => {
  it("every @little-house-studio import is declared in package.json", () => {
    const pkg = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
    const missing = new Set<string>();
    const re = /from\s+["'](@little-house-studio\/[^/"']+)/g;
    for (const f of walkTs(join(appRoot, "src"))) {
      const text = readFileSync(f, "utf8");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const spec = m[1]!;
        if (!declared.has(spec)) missing.add(spec);
      }
    }
    assert.deepEqual([...missing].sort(), []);
    assert.ok(declared.has("@little-house-studio/llm"));
  });
});
