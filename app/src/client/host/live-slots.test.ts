import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
      "shell.sidebar",
      "sidebar.agents",
      "sidebar.sessions",
      "shell.center",
      "shell.files",
      "shell.activity",
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
      ["chat", "project", "settings", "team"],
    );
    slots.dispose();
  });
});
