/**
 * Run: pnpm exec tsx --test src/client/perf-client.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("perf-client", () => {
  it("posts occupancy to /api/perf/client", () => {
    const src = readFileSync(join(here, "perf-client.ts"), "utf8");
    assert.match(src, /\/api\/perf\/client/);
    assert.match(src, /longtask/);
    assert.match(src, /requestAnimationFrame/);
  });
});
