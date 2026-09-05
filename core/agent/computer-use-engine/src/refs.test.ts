import { describe, expect, it } from "vitest";
import {
  MAX_SNAPSHOT_ELEMENTS,
  assignRefs,
  findElement,
  matchLocator,
  parseElementRef,
  pruneInteractive,
  toLocator,
} from "./refs.js";

describe("parseElementRef", () => {
  it("accepts [N] and bare integers", () => {
    expect(parseElementRef("[3]")).toBe(3);
    expect(parseElementRef("12")).toBe(12);
    expect(parseElementRef(4)).toBe(4);
  });

  it("rejects junk", () => {
    expect(parseElementRef("")).toBeNull();
    expect(parseElementRef("[x]")).toBeNull();
    expect(parseElementRef("0")).toBeNull();
    expect(parseElementRef("[0]")).toBeNull();
    expect(parseElementRef(undefined)).toBeNull();
  });
});

describe("pruneInteractive", () => {
  it("keeps actionable roles and assigns 1-based refs", () => {
    const els = pruneInteractive([
      { role: "AXGroup", enabled: true },
      { role: "AXButton", title: "OK", enabled: true, actions: ["AXPress"] },
      { role: "AXStaticText", title: "hello", enabled: true },
      { role: "AXStaticText", title: "linkish", enabled: true, actions: ["AXPress"] },
    ]);
    expect(els.map((e) => e.ref)).toEqual([1, 2]);
    expect(els[0]?.title).toBe("OK");
    expect(els[1]?.title).toBe("linkish");
  });

  it("caps the snapshot", () => {
    const raw = Array.from({ length: MAX_SNAPSHOT_ELEMENTS + 10 }, (_, i) => ({
      role: "AXButton",
      title: `b${i}`,
      enabled: true,
    }));
    expect(pruneInteractive(raw)).toHaveLength(MAX_SNAPSHOT_ELEMENTS);
  });
});

describe("locator", () => {
  it("round-trips identity across a fresh walk", () => {
    const [first] = assignRefs([
      { role: "AXButton", title: "Save", enabled: true },
      { role: "AXTextField", title: "Name", enabled: true },
    ]);
    const loc = toLocator(first!);
    const again = assignRefs([
      { role: "AXButton", title: "Cancel", enabled: true },
      { role: "AXButton", title: "Save", enabled: true },
    ]);
    expect(matchLocator(again, loc)?.title).toBe("Save");
    expect(findElement(again, 2)?.title).toBe("Save");
  });
});
