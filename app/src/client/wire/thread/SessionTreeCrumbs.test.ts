import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionTreeCrumbs } from "./SessionTreeCrumbs";

const sessions = [
  { id: "s-root", title: "你当前是团队干活吗" },
  {
    id: "s-root::fork::research::a",
    title: "调研 JS NPC 方法全貌",
    parentSessionId: "s-root",
  },
  {
    id: "s-root::fork::other::c",
    title: "另一条支线",
    parentSessionId: "s-root",
  },
  {
    id: "s-root::fork::research::a::fork::npc::b",
    title: "抽取适配提示",
    parentSessionId: "s-root::fork::research::a",
  },
];

describe("SessionTreeCrumbs", () => {
  it("renders ancestry path and slash count trigger", () => {
    const html = renderToStaticMarkup(
      createElement(SessionTreeCrumbs, {
        sessions,
        activeSessionId: "s-root::fork::research::a",
        onSelect: () => {},
      }),
    );
    assert.match(html, /data-session-tree="crumbs"/);
    assert.match(html, /你当前是团队干活吗/);
    assert.match(html, /调研 JS NPC 方法全貌/);
    assert.match(html, /wire-session-tree-sep[^>]*>\/</);
    assert.match(html, /data-session-count=/);
    assert.match(html, /wire-session-tree-count-num[^>]*>1</);
    assert.match(html, /aria-label="1 个子会话"/);
    assert.match(html, /aria-label="会话层级"/);
    assert.match(html, /aria-haspopup="tree"/);
    assert.doesNotMatch(html, /data-cascade-menu=/);
    assert.doesNotMatch(html, /data-session-catalog=/);
  });

  it("ancestor crumb jumps; current crumb is a disabled control", () => {
    const html = renderToStaticMarkup(
      createElement(SessionTreeCrumbs, {
        sessions,
        activeSessionId: "s-root::fork::research::a",
        onSelect: () => {},
      }),
    );
    assert.match(
      html,
      /wire-session-tree-crumb(?! is-current)[^>]*>你当前是团队干活吗</,
    );
    assert.match(
      html,
      /wire-session-tree-crumb is-current[^>]*>调研 JS NPC 方法全貌</,
    );
    assert.match(html, /wire-session-tree-crumb is-current[^>]*disabled/);
  });

  it("catalog can fork and spawn a child session", () => {
    const html = renderToStaticMarkup(
      createElement(SessionTreeCrumbs, {
        sessions,
        activeSessionId: "s-root::fork::research::a",
        onSelect: () => {},
        onFork: () => {},
        onNewChild: () => {},
      }),
    );
    assert.match(html, />派生</);
    assert.match(html, /新建子会话/);
    assert.match(html, /wire-session-tree-acts/);
  });

  it("hides the count trigger when the session has no descendants", () => {
    const html = renderToStaticMarkup(
      createElement(SessionTreeCrumbs, {
        sessions,
        activeSessionId: "s-root::fork::research::a::fork::npc::b",
        onSelect: () => {},
      }),
    );
    assert.match(html, /抽取适配提示/);
    assert.doesNotMatch(html, /data-session-count=/);
  });

  it("hides when there is no active session", () => {
    const html = renderToStaticMarkup(
      createElement(SessionTreeCrumbs, {
        sessions,
        activeSessionId: null,
        onSelect: () => {},
      }),
    );
    assert.equal(html, "");
  });
});
