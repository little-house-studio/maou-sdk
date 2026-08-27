/**
 * Dist-level gate: production index.html entry + modulepreload + static import
 * closure must not pull CodeMirror / xterm into first paint.
 *
 * Runs against shipped `app/dist/client` after `vite build`.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const distClient = join(here, "../../../dist/client");
const assetsDir = join(distClient, "assets");

const HEAVY = [
  "CodeMirror",
  "EditorView",
  "@codemirror",
  "react-codemirror",
  "WebLinksAddon",
  "@xterm/xterm",
  "FitAddon",
];

function readAsset(name: string): string {
  return readFileSync(join(assetsDir, name), "utf8");
}

/** Collect script src + modulepreload hrefs from index.html */
function entryAndPreloads(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(
    /(?:src|href)=["'](\/assets\/[^"']+\.js)["']/g,
  )) {
    const p = m[1]!;
    out.push(p.replace(/^\/assets\//, ""));
  }
  return [...new Set(out)];
}

/**
 * Static ESM import edges from a chunk body (relative ./file.js only).
 * Dynamic import() is intentionally ignored — those are not first-paint.
 */
function staticImportTargets(js: string): string[] {
  const out: string[] = [];
  for (const m of js.matchAll(
    /(?:from|import)\s*["'](\.\/[^"']+\.js)["']/g,
  )) {
    out.push(m[1]!.replace(/^\.\//, ""));
  }
  return out;
}

function firstPaintClosure(entryFiles: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entryFiles];
  while (queue.length) {
    const name = queue.pop()!;
    if (seen.has(name)) continue;
    if (!existsSync(join(assetsDir, name))) continue;
    seen.add(name);
    const body = readAsset(name);
    for (const dep of staticImportTargets(body)) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return seen;
}

describe("first-paint dist graph (no CodeMirror/xterm)", () => {
  it("dist/client build exists with index.html", () => {
    assert.ok(
      existsSync(join(distClient, "index.html")),
      "run vite build before this test (missing dist/client/index.html)",
    );
    assert.ok(existsSync(assetsDir), "missing dist/client/assets");
  });

  it("entry + modulepreload static closure is free of CodeMirror/xterm", () => {
    const html = readFileSync(join(distClient, "index.html"), "utf8");
    const seeds = entryAndPreloads(html);
    assert.ok(seeds.length >= 1, "expected main script in index.html");
    assert.ok(
      seeds.some((s) => s.startsWith("main-")),
      `expected main-*.js in seeds, got ${seeds.join(",")}`,
    );

    const closure = firstPaintClosure(seeds);
    assert.ok(closure.size >= 1, "empty first-paint closure");

    const hits: string[] = [];
    for (const name of closure) {
      const body = readAsset(name);
      for (const needle of HEAVY) {
        if (body.includes(needle)) {
          hits.push(`${name} contains ${needle}`);
        }
      }
    }
    assert.equal(
      hits.length,
      0,
      `first-paint graph must not embed heavy editors:\n${hits.join("\n")}\n` +
        `closure=${[...closure].join(",")}`,
    );
  });

  it("codemirror / xterm live in separate async chunks (not only main)", () => {
    const files = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
    const withCm = files.filter((f) => {
      const b = readAsset(f);
      return b.includes("CodeMirror") || b.includes("@codemirror");
    });
    const withXterm = files.filter((f) => {
      const b = readAsset(f);
      return b.includes("WebLinksAddon") || b.includes("@xterm");
    });
    // Heavy code may exist in dist, but not on first paint (async chunks OK)
    assert.ok(
      withCm.length >= 1,
      "expected a CodeMirror-bearing chunk somewhere in dist (lazy)",
    );
    assert.ok(
      withXterm.length >= 1,
      "expected an xterm-bearing chunk somewhere in dist (lazy)",
    );
    const html = readFileSync(join(distClient, "index.html"), "utf8");
    const seeds = new Set(entryAndPreloads(html));
    for (const f of withCm) {
      assert.ok(
        !seeds.has(f),
        `CodeMirror chunk ${f} must not be a direct entry/modulepreload seed`,
      );
    }
    for (const f of withXterm) {
      assert.ok(
        !seeds.has(f),
        `xterm chunk ${f} must not be a direct entry/modulepreload seed`,
      );
    }
  });
});
