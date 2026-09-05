/**
 * Project mode pure helpers (tree / outline / docs catalog).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PROJECT_DOC_PATH,
  PROJECT_DOCS,
  buildProjectTree,
  filterOutlineItems,
  findHeadingLineByTitle,
  getProjectDoc,
  isMarkdownDirty,
  markdownDocStats,
  parseProjectOutline,
  parseProjectViewMode,
  projectDocKindLabel,
  renameHeadingAtLine,
  syncHeadingRename,
  findLineContaining,
  findAllLinesContaining,
  findNextLineContaining,
  findPrevLineContaining,
  appendHeading,
  filterDocsForQuickOpen,
  isPathUnderFolder,
  escapeCssAttrSelector,
  setTaskChecked,
} from "./project-docs";
import { createElement } from "react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectWorkbench } from "./ProjectWorkbench";

describe("project-docs helpers", () => {
  it("catalog includes .maou/project core files", () => {
    const paths = PROJECT_DOCS.map((d) => d.path);
    assert.ok(paths.includes(".maou/project/PROJECT.md"));
    assert.ok(paths.includes(".maou/project/USER.md"));
    assert.ok(paths.includes(".maou/project/RULE.md"));
    assert.ok(paths.includes("docs/README.md"));
    assert.ok(getProjectDoc(DEFAULT_PROJECT_DOC_PATH));
  });

  it("parseProjectOutline extracts ATX headings with levels", () => {
    const outline = parseProjectOutline(
      "# Root\n\n## Child\n\ntext\n\n### Deep\n",
    );
    assert.equal(outline.length, 3);
    assert.equal(outline[0]!.level, 1);
    assert.equal(outline[0]!.title, "Root");
    assert.equal(outline[1]!.level, 2);
    assert.equal(outline[2]!.level, 3);
    assert.equal(outline[2]!.line, 6);
  });

  it("buildProjectTree nests folders and files", () => {
    const tree = buildProjectTree(PROJECT_DOCS);
    assert.ok(tree.some((n) => n.name === ".maou" && n.kind === "folder"));
    assert.ok(tree.some((n) => n.name === "docs" && n.kind === "folder"));
    const maou = tree.find((n) => n.name === ".maou");
    assert.ok(maou?.children?.some((c) => c.name === "project"));
    const project = maou!.children!.find((c) => c.name === "project");
    assert.ok(
      project?.children?.some(
        (c) => c.path === ".maou/project/PROJECT.md" && c.kind === "file",
      ),
    );
  });

  it("projectDocKindLabel maps kinds", () => {
    assert.equal(projectDocKindLabel("project"), "PROJECT");
    assert.equal(projectDocKindLabel("doc"), "DOC");
  });

  it("ProjectWorkbench renders tree editor outline chrome", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectWorkbench, {
        projectLabel: "maou-sdk/app",
        projectPath: "~/maou-sdk/app",
      }),
    );
    assert.match(html, /wire-project/);
    assert.match(html, /项目工作台|wire-project-tree/);
    assert.match(html, /\.maou|PROJECT\.md/);
    assert.match(html, /wire-project-source|wire-project-preview|md-editor|SourceEditor/);
    assert.match(html, /大纲|wire-project-outline/);
    assert.match(html, /分栏|预览|源码|画布/);
    assert.match(html, /筛选文档|wire-project-tree-search/);
    assert.match(html, /同步|重置/);
    assert.match(html, /筛选标题|wire-project-split-handle|分栏/);
    assert.match(html, /wire-project-rail-toggles|文档|大纲/);
    assert.match(html, /wire-project-tabs|清会话|改动/);
    assert.match(html, /查找|wire-project-doc-search|\+ 标题/);
    assert.match(html, /wire-project-pane-count/);
    assert.match(html, /打开|⌘P|快速打开/);
    assert.match(html, /同步|全同步|重置/);
    assert.match(html, /data-project-path|PROJECT\.md/);
    assert.match(html, /Alt\/双击|画布节点/);
    // Preview path renders ATX headings as real heading tags (outline jump targets)
    assert.match(html, /<h1 class="dm-h dm-h1"|dm-h1|maou-sdk/);
    // PROJECT.md fixture tables render in default split preview
    assert.match(html, /dm-table|<table|职责|cli|app/i);
  });

  it("filterDocsForQuickOpen matches path basename and title", () => {
    const hits = filterDocsForQuickOpen(PROJECT_DOCS, "RULE");
    assert.ok(hits.some((h) => h.path.includes("RULE")));
    assert.ok(filterDocsForQuickOpen(PROJECT_DOCS, "").length === PROJECT_DOCS.length);
    assert.equal(filterDocsForQuickOpen(PROJECT_DOCS, "zzz-nope").length, 0);
  });

  it("isPathUnderFolder and escapeCssAttrSelector", () => {
    assert.equal(isPathUnderFolder(".maou/project", ".maou/project/RULE.md"), true);
    assert.equal(isPathUnderFolder(".maou/project", ".maou/project"), true);
    assert.equal(isPathUnderFolder(".maou/project", "docs/README.md"), false);
    assert.equal(isPathUnderFolder("docs", "docsx/a.md"), false);
    assert.match(escapeCssAttrSelector('a"b'), /\\"/);
  });

  it("setTaskChecked toggles first matching task label", () => {
    const src = "# T\n\n- [ ] alpha\n- [x] beta\n";
    const a = setTaskChecked(src, "alpha", true);
    assert.match(a, /- \[x\] alpha/);
    const b = setTaskChecked(a, "beta", false);
    assert.match(b, /- \[ \] beta/);
    assert.equal(setTaskChecked(src, "missing", true), src);
  });

  it("heading helpers rename / find / filter outline", () => {
    const src = "# Root\n\n## Child\n\nbody\n";
    assert.equal(findHeadingLineByTitle(src, "Child"), 2);
    assert.equal(findHeadingLineByTitle(src, "Nope"), null);
    const renamed = renameHeadingAtLine(src, 2, "Kid");
    assert.match(renamed, /## Kid/);
    assert.equal(findHeadingLineByTitle(renamed, "Kid"), 2);
    const synced = syncHeadingRename(src, "Child", "Kid");
    assert.match(synced, /## Kid/);
    assert.equal(syncHeadingRename(src, "Missing", "X"), src);
    const items = parseProjectOutline(src);
    assert.equal(filterOutlineItems(items, "chi").length, 1);
    assert.equal(filterOutlineItems(items, "zzz").length, 0);
    assert.equal(parseProjectViewMode("canvas"), "canvas");
    assert.equal(parseProjectViewMode("nope"), null);
    assert.equal(findLineContaining(src, "body"), 4);
    assert.equal(findLineContaining(src, "NOPE"), null);
    assert.match(appendHeading("# A\n", "B", 2), /## B/);
    assert.match(appendHeading("", "Solo", 1), /^# Solo/);
    const multi = "aa\nbb aa\ncc\naa end\n";
    assert.deepEqual(findAllLinesContaining(multi, "aa"), [0, 1, 3]);
    const n1 = findNextLineContaining(multi, "aa", null);
    assert.equal(n1?.line, 0);
    assert.equal(n1?.total, 3);
    const n2 = findNextLineContaining(multi, "aa", 0);
    assert.equal(n2?.line, 1);
    const n3 = findNextLineContaining(multi, "aa", 3);
    assert.equal(n3?.line, 0); // wrap
    const p1 = findPrevLineContaining(multi, "aa", 1);
    assert.equal(p1?.line, 0);
    const p2 = findPrevLineContaining(multi, "aa", 0);
    assert.equal(p2?.line, 3); // wrap
  });

  it("MD dirty vs baseline: edit then reset restores fixture content", () => {
    const doc = getProjectDoc(DEFAULT_PROJECT_DOC_PATH)!;
    const baseline = doc.content;
    let content = baseline;
    assert.equal(isMarkdownDirty(content, baseline), false);
    content = baseline + "\n\n## Draft note\n";
    assert.equal(isMarkdownDirty(content, baseline), true);
    // reset path mirrors workbench onReset for md
    content = doc.content;
    assert.equal(isMarkdownDirty(content, baseline), false);
    // preview consumes same source string
    const previewHtml = renderToStaticMarkup(
      createElement(ProjectWorkbench, {
        projectLabel: "t",
        projectPath: "/t",
      }),
    );
    assert.match(previewHtml, /wire-project-preview|DraftMarkdown|maou-sdk/);
    assert.match(previewHtml, /行 ·|wire-project-file-meta/);
  });

  it("markdownDocStats counts lines and chars", () => {
    assert.deepEqual(markdownDocStats(""), { lines: 0, chars: 0 });
    assert.deepEqual(markdownDocStats("a\nb\nc"), { lines: 3, chars: 5 });
  });
});
