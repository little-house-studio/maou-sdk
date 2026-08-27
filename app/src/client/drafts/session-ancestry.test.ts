import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  childrenOf,
  deriveAncestry,
  descendantCount,
  flattenSessionForest,
  inferParentSessionId,
} from "./session-ancestry";

const root = { id: "s-root", title: "你当前是团队干活吗" };
const mid = {
  id: "s-root::fork::research::a",
  title: "调研 JS NPC 方法全貌",
  parentSessionId: "s-root",
};
const leaf = {
  id: "s-root::fork::research::a::fork::npc::b",
  title: "抽取适配提示",
  parentSessionId: "s-root::fork::research::a",
};
const sib = {
  id: "s-root::fork::other::c",
  title: "另一条支线",
  parentSessionId: "s-root",
};

describe("session-ancestry", () => {
  it("infers parent from ::fork:: when meta is missing", () => {
    assert.equal(inferParentSessionId("p::fork::task::ts"), "p");
    assert.equal(
      inferParentSessionId("p::fork::t1::a::fork::t2::b"),
      "p::fork::t1::a",
    );
    assert.equal(inferParentSessionId("plain", undefined), undefined);
    assert.equal(inferParentSessionId("p::fork::x", "explicit"), "explicit");
  });

  it("walks parentId to the human root and includes current", () => {
    const chain = deriveAncestry([root, mid, leaf, sib], leaf.id);
    assert.deepEqual(
      chain.map((n) => n.title),
      [root.title, mid.title, leaf.title],
    );
  });

  it("single root is a one-crumb path", () => {
    const chain = deriveAncestry([root, mid], root.id);
    assert.equal(chain.length, 1);
    assert.equal(chain[0]!.id, root.id);
  });

  it("lists direct children and descendant count", () => {
    const all = [root, mid, leaf, sib];
    assert.deepEqual(
      childrenOf(all, root.id).map((n) => n.id).sort(),
      [mid.id, sib.id].sort(),
    );
    assert.equal(descendantCount(all, root.id), 3);
    assert.equal(descendantCount(all, mid.id), 1);
    assert.equal(descendantCount(all, leaf.id), 0);
  });

  it("flattens forest with children after parent", () => {
    const rows = flattenSessionForest([sib, leaf, root, mid]);
    assert.equal(rows[0]?.node.id, root.id);
    assert.equal(rows[0]?.depth, 0);
    assert.deepEqual(
      new Set(rows.map((r) => r.node.id)),
      new Set([root.id, mid.id, leaf.id, sib.id]),
    );
    assert.equal(rows.find((r) => r.node.id === leaf.id)?.depth, 2);
    assert.equal(rows.find((r) => r.node.id === sib.id)?.depth, 1);
  });

  it("breaks cycles", () => {
    const a = { id: "a", title: "A", parentSessionId: "b" };
    const b = { id: "b", title: "B", parentSessionId: "a" };
    const chain = deriveAncestry([a, b], "a");
    assert.ok(chain.length >= 1);
    assert.ok(chain.length <= 2);
  });
});
