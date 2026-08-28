import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SlotRegistry } from "../slots";
import {
  ASIDE_LEFT_PANE,
  ASIDE_LEFT_TAB,
  ASIDE_RIGHT_PANE,
  ASIDE_RIGHT_TAB,
} from "../slots/map";
import { toggleAsideTab } from "./activity";
import { registerAsideTab } from "./aside-tab";

const Icon = () => null;
const Pane = () => null;

function seats() {
  const slots = new SlotRegistry();
  slots.register(
    {
      name: "root",
      children: {
        [ASIDE_LEFT_TAB]: { kind: "list", scope: "root" },
        [ASIDE_LEFT_PANE]: { kind: "keyed", scope: "root" },
        [ASIDE_RIGHT_TAB]: { kind: "list", scope: "root" },
        [ASIDE_RIGHT_PANE]: { kind: "keyed", scope: "root" },
      },
    },
    () => null,
  );
  return slots;
}

describe("registerAsideTab", () => {
  it("toggles the open tab id without a whitelist", () => {
    assert.equal(toggleAsideTab(null, "search"), "search");
    assert.equal(toggleAsideTab("search", "search"), null);
    assert.equal(toggleAsideTab("files", "search"), "search");
  });

  it("posts a tab button and a pane under the same id", () => {
    const slots = seats();
    const off = registerAsideTab(slots, {
      edge: "right",
      id: "search",
      label: "搜索",
      icon: Icon,
      order: 20,
      pane: Pane,
    });
    assert.deepEqual(
      slots.entriesOfSlot(ASIDE_RIGHT_TAB).map((e) => e.options.id),
      ["search"],
    );
    assert.equal(
      slots.entriesOfSlot(ASIDE_RIGHT_PANE).find((e) => e.options.key === "search")
        ?.component,
      Pane,
    );
    off();
    assert.equal(slots.entriesOfSlot(ASIDE_RIGHT_TAB).length, 0);
    assert.equal(slots.entriesOfSlot(ASIDE_RIGHT_PANE).length, 0);
  });

  it("late-binds until the edge seats exist", () => {
    const slots = new SlotRegistry();
    registerAsideTab(slots, {
      edge: "right",
      id: "search",
      label: "搜索",
      icon: Icon,
      pane: Pane,
    });
    assert.equal(slots.entriesOfSlot(ASIDE_RIGHT_TAB).length, 0);
    slots.register(
      {
        name: "root",
        children: {
          [ASIDE_LEFT_TAB]: { kind: "list", scope: "root" },
          [ASIDE_LEFT_PANE]: { kind: "keyed", scope: "root" },
          [ASIDE_RIGHT_TAB]: { kind: "list", scope: "root" },
          [ASIDE_RIGHT_PANE]: { kind: "keyed", scope: "root" },
        },
      },
      () => null,
    );
    assert.deepEqual(
      slots.entriesOfSlot(ASIDE_RIGHT_TAB).map((e) => e.options.id),
      ["search"],
    );
  });

  it("keeps product tabs and stacks an extra one by order", () => {
    const slots = seats();
    registerAsideTab(slots, {
      edge: "left",
      id: "sidebar",
      label: "侧栏",
      icon: Icon,
      order: 10,
      pane: Pane,
    });
    registerAsideTab(slots, {
      edge: "left",
      id: "search",
      label: "搜索",
      icon: Icon,
      order: 20,
      pane: Pane,
    });
    assert.deepEqual(
      slots.entriesOfSlot(ASIDE_LEFT_TAB).map((e) => e.options.id),
      ["sidebar", "search"],
    );
    assert.deepEqual(
      slots
        .entriesOfSlot(ASIDE_LEFT_PANE)
        .map((e) => e.options.key)
        .sort(),
      ["search", "sidebar"],
    );
  });
});
