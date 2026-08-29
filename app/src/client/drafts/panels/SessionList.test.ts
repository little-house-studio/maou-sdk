/**
 * SessionList：搜索井后新建、左墨条选中、fork 树枝、检索保住父链。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionList } from "./SessionList";
import type { DraftSession } from "../types";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "SessionList.tsx"), "utf8");
const draftCss = readFileSync(join(here, "../draft.css"), "utf8");
const liveCss = readFileSync(
  join(here, "../../live-shell.css"),
  "utf8",
);

const root: DraftSession = {
  id: "s-root",
  title: "值班机磁盘告警排查",
  agent: "ops",
  timeLabel: "昨天",
};
const mid: DraftSession = {
  id: "s-root::fork::research::a",
  title: "fork 调研",
  agent: "ops",
  timeLabel: "1时前",
  parentSessionId: "s-root",
};
const leaf: DraftSession = {
  id: "s-root::fork::research::a::fork::npc::b",
  title: "抽取适配提示",
  agent: "ops",
  timeLabel: "刚刚",
  parentSessionId: "s-root::fork::research::a",
};
const sib: DraftSession = {
  id: "s-root::fork::other::c",
  title: "同步预设",
  agent: "ops",
  timeLabel: "2天前",
  parentSessionId: "s-root",
};

function render(extra: Partial<Parameters<typeof SessionList>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(SessionList, {
      sessions: [root, mid, leaf, sib],
      activeId: leaf.id,
      agentLabel: "OPS",
      onSelect: () => {},
      onNew: () => {},
      ...extra,
    }),
  );
}

describe("SessionList scheme A + tree", () => {
  it("layers search well then new action, no section band", () => {
    const html = render();
    const qAt = html.indexOf("wire-session-qwrap");
    const newAt = html.indexOf("wire-new-task-btn");
    const listAt = html.indexOf("wire-session-scroll");
    assert.ok(qAt >= 0 && newAt > qAt);
    assert.ok(listAt > newAt);
    assert.match(html, /wire-session-new-plus/);
    assert.doesNotMatch(html, /wire-session-band/);
    assert.doesNotMatch(html, /会话\s*·/);
    assert.doesNotMatch(src, /wire-session-band/);
    assert.doesNotMatch(src, /session\.list/);
    assert.match(src, /wire-session-qwrap/);
  });

  it("fork children carry tree branch class and structure", () => {
    const html = render();
    assert.match(html, /wire-session-guides/);
    assert.match(html, /wire-session-guide is-tee|data-guide="tee"/);
    assert.match(html, /data-guide="pipe"/);
    assert.match(html, /data-guide="elbow"/);
    assert.match(html, /is-child/);
    assert.match(html, /data-depth="2"/);
    assert.doesNotMatch(src, /hierarchyIndentPx/);
  });

  it("search filter keeps parent chain and indent", () => {
    const html = render({ query: "抽取" });
    assert.match(html, /抽取适配提示/);
    assert.match(html, /fork 调研/);
    assert.match(html, /值班机磁盘告警排查/);
    assert.doesNotMatch(html, /同步预设/);
    assert.match(html, /is-filter-keep/);
    assert.match(html, /data-depth="2"/);
  });

  it("selected session is left ink, not a paint-bucket fill", () => {
    const html = render();
    assert.match(html, /wire-session-row active is-child/);
    const inverse = draftCss.slice(
      draftCss.indexOf("Selected chrome: inverse fill"),
    );
    const inverseHead = inverse.slice(0, 1800);
    assert.doesNotMatch(inverseHead, /wire-session-row\.active/);
    assert.match(
      draftCss,
      /\.wire-session-row\.active\s*\{[^}]*box-shadow:\s*inset 2px 0 0 var\(--n-label\)/s,
    );
    assert.doesNotMatch(
      liveCss,
      /\.live-shell \.wire-session-row\.active \.wire-session-btn,\s*\n\.live-shell \.vsc-tree-row/,
    );
    assert.match(
      liveCss,
      /\.live-shell \.wire-session-row\.active\s*\{[^}]*box-shadow:\s*inset 2px 0 0 var\(--n-label\)/s,
    );
  });

  it("session rows do not grow to fill the rail (covers the tree)", () => {
    assert.match(
      draftCss,
      /\.wire-session-scroll\s*\{[^}]*flex-direction:\s*column/s,
    );
    assert.match(
      draftCss,
      /\.wire-session-row\s*\{[^}]*flex:\s*0 0 auto/s,
    );
  });

  it("session rail fills the split pane with flex, not height 100%", () => {
    assert.match(
      draftCss,
      /\.wire-left-stack\s*\{[^}]*display:\s*grid/s,
    );
    assert.match(
      draftCss,
      /\.wire-session-list\s*\{[^}]*flex:\s*1/s,
    );
    assert.match(
      draftCss,
      /\.wire-session-list\s*\{[^}]*height:\s*auto/s,
    );
    assert.match(
      draftCss,
      /\.wire-left > \[data-aside-pane\]\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s,
    );
    assert.match(
      liveCss,
      /\.live-shell \.live-session-rail-host\s*\{[^}]*flex:\s*1/s,
    );
    assert.doesNotMatch(
      liveCss,
      /\.live-shell \.live-session-rail-host\s*\{[^}]*height:\s*100%/s,
    );
  });
});
