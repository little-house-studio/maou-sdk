import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRustcVersion, rustcMeetsMin, semverGte, MIN_RUSTC } from "./rustc-version.mjs";

describe("parseRustcVersion", () => {
  it("parses rustc --version", () => {
    assert.deepEqual(parseRustcVersion("rustc 1.85.0 (4d91de4e4 2025-02-17)"), {
      major: 1,
      minor: 85,
      patch: 0,
    });
    assert.deepEqual(parseRustcVersion("rustc 1.88.0 (29483883e 2025-06-23)"), {
      major: 1,
      minor: 88,
      patch: 0,
    });
    assert.equal(parseRustcVersion("not rustc"), null);
  });
});

describe("rustcMeetsMin", () => {
  it("requires 1.88+", () => {
    assert.equal(MIN_RUSTC.minor, 88);
    assert.equal(rustcMeetsMin("rustc 1.85.0"), false);
    assert.equal(rustcMeetsMin("rustc 1.87.9"), false);
    assert.equal(rustcMeetsMin("rustc 1.88.0"), true);
    assert.equal(rustcMeetsMin("rustc 1.90.0"), true);
    assert.equal(semverGte({ major: 1, minor: 88, patch: 1 }, MIN_RUSTC), true);
  });
});
