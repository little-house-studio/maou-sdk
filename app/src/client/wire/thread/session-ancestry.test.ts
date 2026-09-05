import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  childrenOf,
  deriveAncestry,
  descendantCount,
  descendantStats,
  filterSessionsKeepingAncestors,
  flattenSessionForest,
  inferParentSessionId,
  projectSessionRail,
  SESSION_TREE_COLLAPSE_MANY,
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
    assert.deepEqual(descendantStats(all, root.id, new Set([mid.id])), {
      count: 3,
      runningCount: 1,
    });
    assert.equal(
      descendantStats(
        [{ ...leaf, lamp: "running" as const }, root, mid, sib],
        root.id,
      ).runningCount,
      1,
    );
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
    const ordered = flattenSessionForest([root, mid, leaf, sib]);
    assert.deepEqual(ordered.find((r) => r.node.id === mid.id)?.guides, ["tee"]);
    assert.deepEqual(ordered.find((r) => r.node.id === leaf.id)?.guides, [
      "pipe",
      "elbow",
    ]);
    assert.deepEqual(ordered.find((r) => r.node.id === sib.id)?.guides, [
      "elbow",
    ]);
    assert.equal(ordered.find((r) => r.node.id === root.id)?.guides.length, 0);
  });

  it("filter keeps ancestor chain so the tree does not split", () => {
    const { kept, matchedIds } = filterSessionsKeepingAncestors(
      [root, mid, leaf, sib],
      (n) => n.title.includes("抽取"),
    );
    assert.deepEqual(
      kept.map((n) => n.id),
      [root.id, mid.id, leaf.id],
    );
    assert.ok(matchedIds.has(leaf.id));
    assert.ok(!matchedIds.has(root.id));
    assert.ok(!kept.some((n) => n.id === sib.id));
  });

  it("projectSessionRail search keeps indent via ancestors", () => {
    const { rows, matchedIds, filtering } = projectSessionRail(
      [sib, leaf, root, mid],
      { query: "抽取" },
    );
    assert.equal(filtering, true);
    assert.equal(rows.find((r) => r.node.id === leaf.id)?.depth, 2);
    assert.equal(rows.find((r) => r.node.id === mid.id)?.depth, 1);
    assert.ok(rows.some((r) => r.node.id === root.id));
    assert.ok(!rows.some((r) => r.node.id === sib.id));
    assert.ok(matchedIds.has(leaf.id));
    assert.ok(!matchedIds.has(sib.id));
  });

  it("collapses crowded sibling branches but keeps the active path", () => {
    const kids = Array.from({ length: SESSION_TREE_COLLAPSE_MANY }, (_, i) => ({
      id: `s-root::fork::crowd::${i}`,
      title: `旁枝 ${i}`,
      parentSessionId: root.id,
    }));
    const all = [root, mid, leaf, ...kids];
    const { rows, collapsedIds } = projectSessionRail(all, {
      activeId: leaf.id,
    });
    assert.ok(!collapsedIds.has(root.id));
    assert.ok(rows.some((r) => r.node.id === mid.id));
    assert.ok(rows.some((r) => r.node.id === leaf.id));
    const other = {
      id: "s-other",
      title: "另一棵",
    };
    const crowdedOther = Array.from(
      { length: SESSION_TREE_COLLAPSE_MANY },
      (_, i) => ({
        id: `s-other::fork::x::${i}`,
        title: `挤 ${i}`,
        parentSessionId: other.id,
      }),
    );
    const mixed = [root, mid, leaf, sib, other, ...crowdedOther];
    const projected = projectSessionRail(mixed, { activeId: leaf.id });
    assert.ok(projected.collapsedIds.has(other.id));
    assert.ok(!projected.rows.some((r) => r.node.id.startsWith("s-other::")));
    assert.ok(projected.rows.some((r) => r.node.id === other.id));
    assert.ok(projected.rows.some((r) => r.node.id === leaf.id));
  });

  it("breaks cycles", () => {
    const a = { id: "a", title: "A", parentSessionId: "b" };
    const b = { id: "b", title: "B", parentSessionId: "a" };
    const chain = deriveAncestry([a, b], "a");
    assert.ok(chain.length >= 1);
    assert.ok(chain.length <= 2);
  });
});
