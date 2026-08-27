import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { ActivityBar } from "./ActivityBar";
import { LEFT_ACTIVITY_TABS, RIGHT_ACTIVITY_TABS } from "./activity";

describe("ActivityBar", () => {
  it("renders icon tabs with accessible names, no text labels", () => {
    const html = renderToStaticMarkup(
      createElement(ActivityBar, {
        tabs: RIGHT_ACTIVITY_TABS,
        activeId: "files",
        onSelect: () => {},
      }),
    );
    assert.match(html, /class="wire-activity is-right"/);
    assert.match(html, /aria-label="右侧页签"/);
    assert.match(html, /aria-label="文件"/);
    assert.match(html, /<svg[\s\S]*stroke=/);
    assert.doesNotMatch(html, /wire-activity-tab-label|>文件</);
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /wire-activity-tab is-on/);
  });

  it("left strip uses 智能体 / 会话 icons", () => {
    const html = renderToStaticMarkup(
      createElement(ActivityBar, {
        tabs: LEFT_ACTIVITY_TABS,
        activeId: "agents",
        onSelect: () => {},
        edge: "left",
      }),
    );
    assert.match(html, /class="wire-activity is-left"/);
    assert.match(html, /aria-label="左侧页签"/);
    assert.match(html, /aria-label="智能体"/);
    assert.match(html, /aria-label="会话"/);
    assert.match(html, /<svg/);
  });
});
