import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeLocalPath, splitPathTokens } from "./open-local.ts";

describe("local paths", () => {
  it("splits a project-relative and absolute path", () => {
    const parts = splitPathTokens("see ./src/a.ts and /tmp/out");
    assert.ok(parts.some((p) => p.path === "./src/a.ts"));
    assert.ok(parts.some((p) => p.path === "/tmp/out"));
  });

  it("rejects urls", () => {
    assert.equal(looksLikeLocalPath("https://example.com/a.ts"), false);
    assert.equal(looksLikeLocalPath("./src/a.ts"), true);
  });
});
