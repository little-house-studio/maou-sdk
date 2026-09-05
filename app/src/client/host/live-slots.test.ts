import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerAsideTab } from "../shell/aside-tab";
import { registerSlotPlugin } from "../slots";
import { createLiveHostSlots } from "./live-slots";

describe("live host slots", () => {
  it("registers the wire seat tree", () => {
    const slots = createLiveHostSlots();
    const snap = slots.snapshot("root");
    assert.equal(snap.length, 1);
    const names = new Set<string>();
    const walk = (n: { name: string; children: typeof snap }) => {
      names.add(n.name);
      for (const c of n.children) walk(c);
    };
    walk(snap[0]!);
    for (const name of [
      "root",
      "shell.topbar",
      "shell.body",
      "aside.left.tab",
      "aside.left.pane",
      "aside.right.tab",
      "aside.right.pane",
      "sidebar.agents",
      "sidebar.sessions",
      "shell.center",
      "shell.bottom",
      "conversation.composer",
      "conversation.messages",
      "composer.model",
      "composer.queue",
      "composer.footer",
      "composer.plan",
    ]) {
      assert.ok(names.has(name), `missing seat ${name}`);
    }
    const center = slots.entriesOfSlot("shell.center");
    assert.deepEqual(
      center.map((e) => e.options.key).sort(),
      ["chat", "plugins", "project", "settings"],
    );
    assert.deepEqual(
      slots.entriesOfSlot("aside.left.tab").map((e) => e.options.id),
      ["sidebar"],
    );
    assert.deepEqual(
      slots.entriesOfSlot("aside.right.tab").map((e) => e.options.id),
      ["files"],
    );
    slots.dispose();
  });

  it("applies an extra aside tab from a plugin", () => {
    const Search = () => null;
    const slots = createLiveHostSlots([
      {
        id: "search",
        apply: (s) =>
          registerAsideTab(s, {
            edge: "right",
            id: "search",
            label: "搜索",
            icon: Search,
            order: 20,
            pane: Search,
          }),
      },
    ]);
    assert.deepEqual(
      slots.entriesOfSlot("aside.right.tab").map((e) => e.options.id),
      ["files", "search"],
    );
    slots.dispose();
  });

  it("picks up registerSlotPlugin before the host table is built", () => {
    const Search = () => null;
    const off = registerSlotPlugin({
      id: "search-global",
      apply: (s) =>
        registerAsideTab(s, {
          edge: "left",
          id: "search",
          label: "搜索",
          icon: Search,
          order: 20,
          pane: Search,
        }),
    });
    try {
      const slots = createLiveHostSlots();
      assert.deepEqual(
        slots.entriesOfSlot("aside.left.tab").map((e) => e.options.id),
        ["sidebar", "search"],
      );
      slots.dispose();
    } finally {
      off();
    }
  });
});
