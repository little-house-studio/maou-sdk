import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerSlotPlugin, slotPlugins } from "./plugins";

describe("registerSlotPlugin", () => {
  it("installs by id and refuses a duplicate", () => {
    const off = registerSlotPlugin({ id: "dup-test", apply: () => undefined });
    try {
      assert.equal(slotPlugins().some((p) => p.id === "dup-test"), true);
      assert.throws(
        () => registerSlotPlugin({ id: "dup-test", apply: () => undefined }),
        /already registered/,
      );
    } finally {
      off();
    }
    assert.equal(slotPlugins().some((p) => p.id === "dup-test"), false);
  });
});
