import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SHELL_FOCUS_REGIONS,
  closestShellRegion,
  isShellFocusRegion,
  shouldAcceptFocusMove,
} from "./focus";

describe("shell focus regions", () => {
  it("names the five chrome modules", () => {
    assert.deepEqual([...SHELL_FOCUS_REGIONS], [
      "topbar",
      "left",
      "center",
      "right",
      "bottom",
    ]);
  });

  it("accepts only declared region ids", () => {
    assert.equal(isShellFocusRegion("left"), true);
    assert.equal(isShellFocusRegion("center"), true);
    assert.equal(isShellFocusRegion("sidebar"), false);
    assert.equal(isShellFocusRegion(null), false);
  });

  it("walks up to data-shell-region", () => {
    const root = {
      getAttribute: (n: string) => (n === "data-shell-region" ? "left" : null),
      closest(sel: string) {
        return sel === "[data-shell-region]" ? this : null;
      },
    };
    assert.equal(closestShellRegion(root as unknown as EventTarget), "left");
    assert.equal(closestShellRegion(null), null);
  });

  it("keeps the clicked region through a follow-up autofocus", () => {
    const click = { region: "left" as const, at: 1000 };
    assert.equal(shouldAcceptFocusMove(click, "center", 1100), false);
    assert.equal(shouldAcceptFocusMove(click, "left", 1100), true);
    assert.equal(shouldAcceptFocusMove(click, "center", 1500), true);
    assert.equal(shouldAcceptFocusMove(null, "center", 1100), true);
  });
});
