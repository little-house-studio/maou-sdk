/**
 * SessionList：搜索 / 新建 / 日期分组 / 圆角选中 / fork 树枝。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SessionList,
  sessionAgeGroup,
  sessionLampVisual,
  groupSessionRail,
} from "./SessionList";
import type { DraftSession } from "../types";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "SessionList.tsx"), "utf8");
const draftCss = readFileSync(join(here, "../wire.css"), "utf8");
const liveCss = readFileSync(
  join(here, "../../live-shell.css"),
  "utf8",
);

const root: DraftSession = {
  id: "s-root",
  title: "值班机磁盘告警排查",
  agent: "ops",
  timeLabel: "昨天",
  messageCount: 24,
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

describe("session age groups", () => {
  it("buckets time labels", () => {
    assert.equal(sessionAgeGroup("刚刚"), "today");
    assert.equal(sessionAgeGroup("3分前"), "today");
    assert.equal(sessionAgeGroup("5天前"), "week");
    assert.equal(sessionAgeGroup("昨天"), "week");
    assert.equal(sessionAgeGroup("12天前"), "older");
    assert.equal(sessionAgeGroup("09-01"), "older");
    assert.equal(sessionAgeGroup("1时前", true), "today");
  });

  it("keeps fork children with the parent bucket", () => {
    const grouped = groupSessionRail([
      { node: root, depth: 0 },
      { node: mid, depth: 1 },
      { node: { ...leaf, timeLabel: "刚刚" }, depth: 2 },
    ]);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0]!.group, "week");
    assert.equal(grouped[0]!.rows.length, 3);
  });
});

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
    assert.match(html, /wire-session-group/);
    assert.match(html, /Last 7 days|近 7 天/);
    assert.match(html, /wire-session-new-kbd/);
    assert.match(html, /⌘N|Ctrl\+N/);
    assert.match(html, /wire-session-copy/);
    assert.match(html, /wire-session-sub/);
  });

  it("shows message count between title and time", () => {
    const html = render();
    assert.match(html, /wire-session-count/);
    assert.match(html, />24</);
    assert.match(src, /messageCount/);
    assert.match(
      draftCss,
      /\.wire-session-count\s*\{[^}]*tabular-nums/s,
    );
  });

  it("fork children carry tree branch class and structure", () => {
    const html = render();
    assert.match(html, /wire-session-guides/);
    assert.match(html, /wire-session-guide is-tee|data-guide="tee"/);
    assert.match(html, /data-guide="pipe"/);
    assert.match(html, /data-guide="elbow"/);
    assert.match(html, /is-child/);
    assert.match(html, /data-depth="2"/);
    assert.match(html, /n-fold/);
    assert.match(src, /<Fold /);
    assert.match(src, /SessionKidFold/);
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

  it("selected session is a rounded fill, not a left ink bar", () => {
    const html = render();
    assert.match(html, /wire-session-row active is-child/);
    assert.match(
      draftCss,
      /\.wire-session-row\s*\{[^}]*border-radius:\s*var\(--session-radius/s,
    );
    assert.match(
      draftCss,
      /\.wire-session-row\.active\s*\{[^}]*color-mix\(in srgb, var\(--n-label\) 10%/s,
    );
    assert.doesNotMatch(
      draftCss,
      /\.wire-session-row\.active\s*\{[^}]*inset 2px 0 0 var\(--n-label\)/s,
    );
    assert.match(
      liveCss,
      /\.live-shell \.wire-session-row\.active\s*\{[^}]*color-mix\(in srgb, var\(--n-label\) 10%/s,
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

  it("maps lamp to a glyph, not a filled square", () => {
    assert.equal(sessionLampVisual("running", false, false), "running");
    assert.equal(sessionLampVisual("helpers", false, false), "helpers");
    assert.equal(sessionLampVisual("await_approval", false, false), "approval");
    assert.equal(sessionLampVisual("plan_review", false, false), "plan");
    assert.equal(sessionLampVisual("await_ask", false, false), "ask");
    assert.equal(sessionLampVisual("done", false, false), "session");
    assert.equal(sessionLampVisual("done", false, true), "fork");
    assert.equal(sessionLampVisual("idle", false, true), "fork");
    assert.equal(sessionLampVisual(undefined, true, false), "running");
    const html = render({
      sessions: [
        { ...root, lamp: "done" },
        { ...mid, lamp: "done" },
        { ...leaf, lamp: "running" },
        { ...sib, lamp: "await_ask" },
      ],
      runningSessionIds: [leaf.id],
    });
    assert.match(html, /data-session-lamp="session"/);
    assert.match(html, /data-session-lamp="fork"/);
    assert.match(html, /data-session-lamp="running"/);
    assert.match(html, /data-session-lamp="ask"/);
    assert.match(html, /class="draft-mark/);
    assert.match(html, /<svg /);
    assert.match(src, /SessionLamp/);
    assert.match(src, /StatusMark/);
    assert.match(src, /ChromeMark/);
    assert.match(
      draftCss,
      /\.wire-session-lamp\s*\{[^}]*display:\s*inline-flex/s,
    );
    assert.doesNotMatch(
      draftCss,
      /\.wire-session-lamp\s*\{[^}]*background:\s*currentColor/s,
    );
  });

  it("hovers a three-dot menu that holds row actions", () => {
    const html = render({
      onDelete: () => {},
      onFork: () => {},
      onNewChild: () => {},
      onRename: () => {},
    });
    assert.match(html, /wire-session-more-host/);
    assert.match(html, /wire-session-more-btn/);
    assert.match(html, /⋯/);
    assert.doesNotMatch(html, /wire-session-fork/);
    assert.doesNotMatch(html, /wire-session-child/);
    assert.doesNotMatch(html, /wire-session-del/);
    assert.doesNotMatch(html, /data-cascade-panel=/);
    assert.match(src, /SessionRowMore/);
    assert.match(
      draftCss,
      /\.wire-session-more-host\s*\{[^}]*opacity:\s*0/s,
    );
    assert.match(
      draftCss,
      /\.wire-session-row:hover \.wire-session-more-host/s,
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
