/**
 * Project session persistence + outline/graph drift helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeDraftsWithFixtures,
  outlineGraphDrift,
  parseProjectSession,
  projectSessionKey,
  serializeProjectSession,
  isValidGraphState,
  pushRecentPath,
  cycleRecentPath,
  closeRecentPath,
  listDirtyDocPaths,
  sanitizeRecentPaths,
} from "./project-session";
import { PROJECT_DOCS } from "./project-docs";
import {
  createTextNode,
  emptyGraph,
  graphFingerprint,
  graphFromOutline,
  layoutChildren,
  reverseEdge,
  selectNode,
  connectNodes,
} from "./project-graph";

describe("project-session", () => {
  it("projectSessionKey is stable per project path", () => {
    assert.match(projectSessionKey("~/a"), /maou-draft-project-session/);
    assert.equal(
      projectSessionKey("p1"),
      projectSessionKey("p1"),
    );
    assert.notEqual(projectSessionKey("p1"), projectSessionKey("p2"));
  });

  it("mergeDraftsWithFixtures prefers saved drafts", () => {
    const path = PROJECT_DOCS[0]!.path;
    const merged = mergeDraftsWithFixtures(PROJECT_DOCS, {
      [path]: "# edited\n",
    });
    assert.equal(merged[path], "# edited\n");
    assert.equal(
      merged[PROJECT_DOCS[1]!.path],
      PROJECT_DOCS[1]!.content,
    );
  });

  it("parse/serialize round-trip keeps drafts and graphs", () => {
    let g = createTextNode(emptyGraph(), { text: "A", x: 1, y: 2 });
    const snap = {
      v: 1 as const,
      activePath: PROJECT_DOCS[0]!.path,
      drafts: { [PROJECT_DOCS[0]!.path]: "# hi\n" },
      contentBaselines: {},
      graphs: { [PROJECT_DOCS[0]!.path]: g },
      graphBaselines: {},
      hideTree: true,
      hideOutline: false,
    };
    const raw = serializeProjectSession(snap);
    const back = parseProjectSession(raw);
    assert.ok(back);
    assert.equal(back!.drafts[PROJECT_DOCS[0]!.path], "# hi\n");
    assert.ok(isValidGraphState(back!.graphs[PROJECT_DOCS[0]!.path]));
    assert.equal(back!.hideTree, true);
    assert.equal(parseProjectSession("not-json"), null);
    assert.equal(parseProjectSession('{"v":99}'), null);
  });

  it("outlineGraphDrift detects title tree mismatch", () => {
    const outline = [
      { level: 1, title: "Root" },
      { level: 2, title: "A" },
    ];
    const g = graphFromOutline(outline);
    assert.equal(outlineGraphDrift(outline, g), false);
    assert.equal(
      outlineGraphDrift(
        [
          { level: 1, title: "Root" },
          { level: 2, title: "B" },
        ],
        g,
      ),
      true,
    );
  });

  it("layoutChildren stacks kids to the right of parent", () => {
    let g = createTextNode(emptyGraph(), { text: "P", x: 0, y: 0 });
    const p = g.selectedId!;
    g = createTextNode(g, { text: "C1", x: 10, y: 200 });
    const c1 = g.selectedId!;
    g = createTextNode(g, { text: "C2", x: 20, y: 10 });
    const c2 = g.selectedId!;
    g = connectNodes(g, p, c1);
    g = connectNodes(g, p, c2);
    g = selectNode(g, p);
    g = layoutChildren(g);
    const n1 = g.nodes.find((n) => n.id === c1)!;
    const n2 = g.nodes.find((n) => n.id === c2)!;
    const parent = g.nodes.find((n) => n.id === p)!;
    assert.ok(n1.x > parent.x + parent.width - 1);
    assert.ok(n2.x > parent.x + parent.width - 1);
    // y-sorted: original C2 was higher (y=10) than C1 (y=200)
    assert.ok(n2.y < n1.y);
  });

  it("pushRecentPath MRU + listDirtyDocPaths", () => {
    assert.deepEqual(pushRecentPath(["a", "b"], "c", 3), ["c", "a", "b"]);
    assert.deepEqual(pushRecentPath(["a", "b"], "b", 3), ["b", "a"]);
    assert.deepEqual(pushRecentPath(["a", "b", "c"], "d", 2), ["d", "a"]);

    const path = PROJECT_DOCS[0]!.path;
    const dirty = listDirtyDocPaths(
      PROJECT_DOCS,
      { [path]: PROJECT_DOCS[0]!.content + "\n# x\n" },
      {},
      {},
      {},
      graphFingerprint,
    );
    assert.ok(dirty.includes(path));
    assert.equal(
      listDirtyDocPaths(
        PROJECT_DOCS,
        {},
        {},
        {},
        {},
        graphFingerprint,
      ).length,
      0,
    );
  });

  it("cycleRecentPath and closeRecentPath", () => {
    assert.equal(cycleRecentPath(["a", "b", "c"], "a", 1), "b");
    assert.equal(cycleRecentPath(["a", "b", "c"], "c", 1), "a");
    assert.equal(cycleRecentPath(["a", "b", "c"], "b", -1), "a");
    const closed = closeRecentPath(["a", "b", "c"], "a", "a");
    assert.deepEqual(closed.recent, ["b", "c"]);
    assert.equal(closed.active, "b");
    const closedOther = closeRecentPath(["a", "b"], "b", "a");
    assert.deepEqual(closedOther.recent, ["a"]);
    assert.equal(closedOther.active, "a");
  });

  it("sanitizeRecentPaths drops unknown and restores fallback", () => {
    const known = PROJECT_DOCS.map((d) => d.path);
    const fb = PROJECT_DOCS[0]!.path;
    assert.deepEqual(
      sanitizeRecentPaths([fb, "nope/x.md", known[1]!], known, fb),
      [fb, known[1]!],
    );
    assert.deepEqual(sanitizeRecentPaths(["gone"], known, fb), [fb]);
    assert.deepEqual(sanitizeRecentPaths(undefined, known, fb), [fb]);
  });

  it("parse/serialize keeps recentPaths", () => {
    const path = PROJECT_DOCS[0]!.path;
    const raw = serializeProjectSession({
      v: 1,
      activePath: path,
      recentPaths: [path, PROJECT_DOCS[1]!.path],
      drafts: { [path]: "# x\n" },
      contentBaselines: {},
      graphs: {},
      graphBaselines: {},
    });
    const back = parseProjectSession(raw);
    assert.deepEqual(back?.recentPaths, [path, PROJECT_DOCS[1]!.path]);
  });

  it("reverseEdge swaps direction", () => {
    let g = createTextNode(emptyGraph(), { text: "A", x: 0, y: 0 });
    const a = g.selectedId!;
    g = createTextNode(g, { text: "B", x: 100, y: 0 });
    const b = g.selectedId!;
    g = connectNodes(g, a, b);
    const eid = g.edges[0]!.id;
    g = reverseEdge(g, eid);
    assert.equal(g.edges[0]!.from, b);
    assert.equal(g.edges[0]!.to, a);
  });
});
