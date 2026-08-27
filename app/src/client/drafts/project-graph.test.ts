/**
 * Pure Project Graph–aligned ops tests (shipped helpers only).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  broadGrow,
  connectNodes,
  createTextNode,
  deepGrow,
  deleteEdge,
  deleteSelection,
  duplicateSelection,
  emptyGraph,
  findNodeIdByText,
  findParentId,
  getNode,
  graphBounds,
  graphFromOutline,
  graphToMarkdownOutline,
  graphToMermaid,
  selectRoot,
  snapNodeToGrid,
  snapGraphToGrid,
  historyCommit,
  historyInit,
  historyRedo,
  historyUndo,
  moveNode,
  navigateTree,
  selectNode,
  updateNodeText,
} from "./project-graph";
import {
  filterProjectTree,
  pathMatchesFilter,
  buildProjectTree,
  PROJECT_DOCS,
} from "./project-docs";
import { createElement } from "react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectWorkbench } from "./panels/ProjectWorkbench";
import { ProjectCanvas } from "./panels/ProjectCanvas";

describe("project-graph ops", () => {
  it("create → move → connect → delete on real helpers", () => {
    let g = emptyGraph();
    assert.equal(g.nodes.length, 0);

    g = createTextNode(g, { text: "A", x: 10, y: 20 });
    assert.equal(g.nodes.length, 1);
    const aId = g.selectedId!;
    assert.equal(getNode(g, aId)?.text, "A");
    assert.equal(getNode(g, aId)?.x, 10);

    g = createTextNode(g, { text: "B", x: 200, y: 20, select: true });
    const bId = g.selectedId!;
    assert.equal(g.nodes.length, 2);

    g = moveNode(g, bId, 240, 80);
    assert.equal(getNode(g, bId)?.x, 240);
    assert.equal(getNode(g, bId)?.y, 80);

    g = connectNodes(g, aId, bId);
    assert.equal(g.edges.length, 1);
    assert.equal(g.edges[0]!.from, aId);
    assert.equal(g.edges[0]!.to, bId);
    // no duplicate
    const g2 = connectNodes(g, aId, bId);
    assert.equal(g2.edges.length, 1);
    // no self-loop
    assert.equal(connectNodes(g, aId, aId).edges.length, 1);

    g = selectNode(g, bId);
    g = deleteSelection(g);
    assert.equal(g.nodes.length, 1);
    assert.equal(g.nodes[0]!.id, aId);
    assert.equal(g.edges.length, 0);
    assert.equal(g.selectedId, null);
  });

  it("deepGrow (Tab) creates child edge selected→new to the right", () => {
    let g = createTextNode(emptyGraph(), { text: "Root", x: 0, y: 0 });
    const rootId = g.selectedId!;
    g = deepGrow(g, "Child1");
    assert.equal(g.nodes.length, 2);
    const childId = g.selectedId!;
    assert.notEqual(childId, rootId);
    assert.equal(getNode(g, childId)?.text, "Child1");
    assert.equal(findParentId(g, childId), rootId);
    const edge = g.edges.find((e) => e.from === rootId && e.to === childId);
    assert.ok(edge);
    const root = getNode(g, rootId)!;
    const child = getNode(g, childId)!;
    assert.ok(child.x > root.x + root.width);

    // second child stacks below first
    g = selectNode(g, rootId);
    g = deepGrow(g, "Child2");
    const child2 = getNode(g, g.selectedId!)!;
    assert.ok(child2.y > child.y);
    assert.equal(g.edges.length, 2);
  });

  it("broadGrow (\\) requires parent; creates sibling under same parent", () => {
    let g = createTextNode(emptyGraph(), { text: "Root", x: 0, y: 0 });
    const rootId = g.selectedId!;
    // isolated: broad-grow is no-op
    const isolated = broadGrow(g, "Nope");
    assert.equal(isolated.nodes.length, 1);
    assert.equal(isolated.edges.length, 0);

    g = deepGrow(g, "Child");
    const childId = g.selectedId!;
    assert.equal(findParentId(g, childId), rootId);

    g = broadGrow(g, "Sibling");
    assert.equal(g.nodes.length, 3);
    const sibId = g.selectedId!;
    assert.equal(findParentId(g, sibId), rootId);
    assert.ok(g.edges.some((e) => e.from === rootId && e.to === sibId));
    assert.equal(getNode(g, sibId)?.text, "Sibling");
  });

  it("graphFromOutline builds hierarchical edges from heading levels", () => {
    const g = graphFromOutline([
      { level: 1, title: "Root" },
      { level: 2, title: "A" },
      { level: 2, title: "B" },
      { level: 3, title: "B1" },
    ]);
    assert.equal(g.nodes.length, 4);
    const byText = Object.fromEntries(g.nodes.map((n) => [n.text, n.id]));
    assert.ok(g.edges.some((e) => e.from === byText.Root && e.to === byText.A));
    assert.ok(g.edges.some((e) => e.from === byText.Root && e.to === byText.B));
    assert.ok(g.edges.some((e) => e.from === byText.B && e.to === byText.B1));
  });

  it("updateNodeText mutates label", () => {
    let g = createTextNode(emptyGraph(), { text: "old" });
    const id = g.selectedId!;
    g = updateNodeText(g, id, "new");
    assert.equal(getNode(g, id)?.text, "new");
  });

  it("findNodeIdByText and graphBounds support outline focus + fit", () => {
    const g = graphFromOutline([
      { level: 1, title: "Root" },
      { level: 2, title: "Child" },
    ]);
    assert.equal(findNodeIdByText(g, "Child"), getNode(g, findNodeIdByText(g, "Child")!)?.id);
    assert.ok(findNodeIdByText(g, "missing") === null);
    const b = graphBounds(g);
    assert.ok(b);
    assert.ok(b!.maxX > b!.minX);
    assert.ok(b!.maxY >= b!.minY);
    assert.equal(graphBounds(emptyGraph()), null);
  });

  it("historyCommit undo/redo restores structural graph", () => {
    let g = createTextNode(emptyGraph(), { text: "A", x: 0, y: 0 });
    let h = historyInit(g);
    g = createTextNode(g, { text: "B", x: 100, y: 0 });
    h = historyCommit(h, g);
    assert.equal(h.past.length, 1);
    assert.equal(h.present.nodes.length, 2);
    h = historyUndo(h);
    assert.equal(h.present.nodes.length, 1);
    assert.equal(h.present.nodes[0]!.text, "A");
    h = historyRedo(h);
    assert.equal(h.present.nodes.length, 2);
    // selection-only does not grow past
    const sel = selectNode(h.present, h.present.nodes[0]!.id);
    const h2 = historyCommit(h, sel);
    assert.equal(h2.past.length, h.past.length);
  });

  it("navigateTree walks parent/child/siblings", () => {
    let g = graphFromOutline([
      { level: 1, title: "Root" },
      { level: 2, title: "A" },
      { level: 2, title: "B" },
    ]);
    const root = findNodeIdByText(g, "Root")!;
    const a = findNodeIdByText(g, "A")!;
    const b = findNodeIdByText(g, "B")!;
    g = selectNode(g, a);
    g = navigateTree(g, "parent");
    assert.equal(g.selectedId, root);
    g = navigateTree(g, "firstChild");
    assert.ok(g.selectedId === a || g.selectedId === b);
    g = selectNode(g, a);
    g = navigateTree(g, "nextSibling");
    assert.equal(g.selectedId, b);
    g = navigateTree(g, "prevSibling");
    assert.equal(g.selectedId, a);
  });

  it("deleteEdge and duplicateSelection", () => {
    let g = createTextNode(emptyGraph(), { text: "A", x: 0, y: 0 });
    const a = g.selectedId!;
    g = createTextNode(g, { text: "B", x: 200, y: 0 });
    const b = g.selectedId!;
    g = connectNodes(g, a, b);
    assert.equal(g.edges.length, 1);
    const eid = g.edges[0]!.id;
    g = deleteEdge(g, eid);
    assert.equal(g.edges.length, 0);
    g = connectNodes(g, a, b);
    g = selectNode(g, a);
    g = duplicateSelection(g);
    assert.equal(g.nodes.length, 3);
    assert.equal(getNode(g, g.selectedId!)?.text, "A");
    assert.notEqual(g.selectedId, a);
  });

  it("graphToMarkdownOutline exports ATX tree", () => {
    const g = graphFromOutline([
      { level: 1, title: "Root" },
      { level: 2, title: "A" },
      { level: 2, title: "B" },
      { level: 3, title: "B1" },
    ]);
    const md = graphToMarkdownOutline(g);
    assert.match(md, /^# Root/m);
    assert.match(md, /^## A/m);
    assert.match(md, /^## B/m);
    assert.match(md, /^### B1/m);
  });

  it("graphToMermaid and selectRoot", () => {
    const g = graphFromOutline([
      { level: 1, title: "Root" },
      { level: 2, title: "Child" },
    ]);
    const mmd = graphToMermaid(g);
    assert.match(mmd, /flowchart LR/);
    assert.match(mmd, /Root/);
    assert.match(mmd, /-->/);
    const rooted = selectRoot(selectNode(g, findNodeIdByText(g, "Child")!));
    assert.equal(getNode(rooted, rooted.selectedId!)?.text, "Root");
  });

  it("snapNodeToGrid snaps coordinates", () => {
    let g = createTextNode(emptyGraph(), { text: "A", x: 13, y: 19 });
    const id = g.selectedId!;
    g = snapNodeToGrid(g, id, 8);
    assert.equal(getNode(g, id)?.x, 16);
    assert.equal(getNode(g, id)?.y, 16);
    g = moveNode(g, id, 10, 10);
    g = createTextNode(g, { text: "B", x: 3, y: 5 });
    g = snapGraphToGrid(g, 8);
    assert.ok(g.nodes.every((n) => n.x % 8 === 0 && n.y % 8 === 0));
  });

  it("filterProjectTree keeps matching files and ancestors", () => {
    assert.equal(pathMatchesFilter(".maou/project/RULE.md", "rule"), true);
    assert.equal(pathMatchesFilter("docs/README.md", "zzz"), false);
    const full = buildProjectTree(PROJECT_DOCS);
    const filtered = filterProjectTree(full, "RULE");
    assert.ok(filtered.some((n) => n.name === ".maou"));
    const paths: string[] = [];
    const walk = (nodes: ReturnType<typeof buildProjectTree>) => {
      for (const n of nodes) {
        if (n.kind === "file") paths.push(n.path);
        if (n.children) walk(n.children);
      }
    };
    walk(filtered);
    assert.ok(paths.every((p) => p.toLowerCase().includes("rule")));
    assert.ok(paths.length >= 1);
  });
});

describe("ProjectWorkbench canvas + md chrome", () => {
  it("exposes canvas view chrome and md editor surface", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectWorkbench, {
        projectLabel: "maou-sdk/app",
        projectPath: "~/maou-sdk/app",
      }),
    );
    assert.match(html, /wire-project/);
    assert.match(html, /画布/);
    assert.match(html, /分栏|预览|源码/);
    // MD path still present as a view option (source/preview)
    assert.match(html, /wire-project-source|md-editor|Markdown|源码/);
  });

  it("ProjectCanvas renders graph chrome and tool ops", () => {
    const g = graphFromOutline([
      { level: 1, title: "Root" },
      { level: 2, title: "Child" },
    ]);
    const html = renderToStaticMarkup(
      createElement(ProjectCanvas, {
        graph: g,
        onChange: () => {},
        onRebuildFromOutline: () => {},
        onWriteOutlineToMd: () => {},
        onLocateSource: () => {},
      }),
    );
    assert.match(html, /wire-project-graph/);
    assert.match(html, /data-canvas="project-graph"/);
    assert.match(html, /新建|深度|广度|删除|连线|撤销|更多/);
    assert.match(html, /Root|Child/);
    assert.match(html, /wire-project-node/);
    // secondary tools present in DOM (collapsed under 更多)
    assert.match(html, /Mermaid|根节点|吸附|从大纲重建|到源码|写入大纲/);
  });

  it("ProjectCanvas empty state when no nodes", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectCanvas, {
        graph: emptyGraph(),
        onChange: () => {},
      }),
    );
    assert.match(html, /画布为空|wire-project-graph-empty/);
  });

  it("ProjectCanvas exposes locate + write outline actions when wired", () => {
    const g = graphFromOutline([{ level: 1, title: "Root" }]);
    const html = renderToStaticMarkup(
      createElement(ProjectCanvas, {
        graph: g,
        onChange: () => {},
        onRebuildFromOutline: () => {},
        onWriteOutlineToMd: () => {},
        onLocateSource: () => {},
      }),
    );
    assert.match(html, /写入大纲/);
    assert.match(html, /到源码/);
  });
});
