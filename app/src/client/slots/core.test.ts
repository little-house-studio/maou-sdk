import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SlotCore } from "./core";
import { SlotRegistry } from "./registry";

const Box = () => null;

describe("SlotCore", () => {
  it("seeds root; register into undeclared slot throws", () => {
    const core = new SlotCore();
    assert.deepEqual(core.spec("root"), { kind: "single", scope: "root" });
    assert.throws(
      () => core.register({ name: "ghost" }, Box),
      /not declared/,
    );
  });

  it("parent children declare seats; dispose collapses the tree", () => {
    const core = new SlotCore();
    const off = core.register(
      {
        name: "root",
        registrant: "shell",
        children: {
          "shell.topbar": { kind: "single", scope: "root" },
          "shell.bottom": { kind: "single", scope: "root" },
        },
      },
      Box,
    );
    assert.equal(core.spec("shell.topbar")?.kind, "single");
    core.register({ name: "shell.topbar", registrant: "topbar" }, Box);
    assert.equal(core.entriesOfSlot("shell.topbar").length, 1);
    off();
    assert.equal(core.spec("shell.topbar"), undefined);
    assert.equal(core.entriesOfSlot("shell.topbar").length, 0);
    assert.throws(
      () => core.register({ name: "shell.topbar" }, Box),
      /not declared/,
    );
  });

  it("list orders by order; keyed addresses by key; chain elects select", () => {
    const core = new SlotCore();
    core.register(
      {
        name: "root",
        children: {
          "shell.overlay": { kind: "list", scope: "root" },
          "shell.center": { kind: "keyed", scope: "root" },
          "shell.composer": { kind: "chain", scope: "root" },
        },
      },
      Box,
    );
    core.register({ name: "shell.overlay", id: "b", order: 20 }, "B");
    core.register({ name: "shell.overlay", id: "a", order: 10 }, "A");
    assert.deepEqual(
      core.entriesOfSlot("shell.overlay").map((e) => e.options.id),
      ["a", "b"],
    );

    core.register({ name: "shell.center", key: "chat" }, "Chat");
    core.register({ name: "shell.center", key: "settings" }, "Settings");
    assert.equal(
      core.entriesOfSlot("shell.center").find((e) => e.options.key === "chat")
        ?.component,
      "Chat",
    );

    core.register(
      {
        name: "shell.composer",
        select: (p: { take?: boolean }) => (p.take ? "hit" : null),
      },
      "Grab",
    );
    const chain = core.entriesOfSlot("shell.composer");
    assert.equal(chain[0]?.select?.({ take: true }), "hit");
    assert.equal(chain[0]?.select?.({}), null);
  });

  it("duplicate single / keyed / list cell at same priority throws", () => {
    const core = new SlotCore();
    core.register(
      {
        name: "root",
        children: {
          one: { kind: "single", scope: "root" },
          keys: { kind: "keyed", scope: "root" },
          items: { kind: "list", scope: "root" },
        },
      },
      Box,
    );
    core.register({ name: "one" }, Box);
    assert.throws(() => core.register({ name: "one" }, Box), /already has/);
    core.register({ name: "keys", key: "chat" }, Box);
    assert.throws(
      () => core.register({ name: "keys", key: "chat" }, Box),
      /already has/,
    );
    core.register({ name: "items", id: "x" }, Box);
    assert.throws(
      () => core.register({ name: "items", id: "x" }, Box),
      /already has/,
    );
  });
});

describe("SlotRegistry inject", () => {
  it("late-binds until the parent declares the seat", () => {
    const slots = new SlotRegistry();
    const seen: string[] = [];
    slots.inject("shell.topbar", () => {
      const off = slots.register(
        { name: "shell.topbar", registrant: "plugin" },
        Box,
      );
      seen.push("in");
      return () => {
        off();
        seen.push("out");
      };
    });
    assert.deepEqual(seen, []);
    const shell = slots.register(
      {
        name: "root",
        registrant: "shell",
        children: { "shell.topbar": { kind: "single", scope: "root" } },
      },
      Box,
    );
    assert.deepEqual(seen, ["in"]);
    assert.equal(slots.entriesOfSlot("shell.topbar").length, 1);
    shell();
    assert.deepEqual(seen, ["in", "out"]);
    assert.equal(slots.spec("shell.topbar"), undefined);
  });
});
