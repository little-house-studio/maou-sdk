import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { Bot, FolderTree } from "lucide-react";
import { SlotRegistry, SlotsProvider } from "../slots";
import {
  ASIDE_LEFT_PANE,
  ASIDE_LEFT_TAB,
  ASIDE_RIGHT_PANE,
  ASIDE_RIGHT_TAB,
} from "../slots/map";
import { ActivityBar } from "./ActivityBar";
import { registerAsideTab } from "./aside-tab";

function seats() {
  const slots = new SlotRegistry();
  slots.register(
    {
      name: "root",
      children: {
        [ASIDE_LEFT_TAB]: { kind: "list", scope: "root" },
        [ASIDE_LEFT_PANE]: { kind: "keyed", scope: "root" },
        [ASIDE_RIGHT_TAB]: { kind: "list", scope: "root" },
        [ASIDE_RIGHT_PANE]: { kind: "keyed", scope: "root" },
      },
    },
    () => null,
  );
  return slots;
}

describe("ActivityBar", () => {
  it("renders icon tabs with accessible names, no text labels", () => {
    const slots = seats();
    registerAsideTab(slots, {
      edge: "right",
      id: "files",
      label: "文件",
      icon: FolderTree,
      pane: () => null,
    });
    const html = renderToStaticMarkup(
      createElement(
        SlotsProvider,
        { slots },
        createElement(ActivityBar, {
          activeId: "files",
          onSelect: () => {},
        }),
      ),
    );
    assert.match(html, /class="wire-activity is-right"/);
    assert.match(html, /aria-label="右侧页签"/);
    assert.match(html, /aria-label="文件"/);
    assert.match(html, /<svg[\s\S]*stroke=/);
    assert.doesNotMatch(html, /wire-activity-tab-label|>文件</);
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /wire-activity-tab is-on/);
  });

  it("left strip is one 侧栏 icon", () => {
    const slots = seats();
    registerAsideTab(slots, {
      edge: "left",
      id: "sidebar",
      label: "侧栏",
      icon: Bot,
      pane: () => null,
    });
    const html = renderToStaticMarkup(
      createElement(
        SlotsProvider,
        { slots },
        createElement(ActivityBar, {
          activeId: "sidebar",
          onSelect: () => {},
          edge: "left",
        }),
      ),
    );
    assert.match(html, /class="wire-activity is-left"/);
    assert.match(html, /aria-label="左侧页签"/);
    assert.match(html, /aria-label="侧栏"/);
    assert.doesNotMatch(html, /aria-label="智能体"|aria-label="会话"/);
    assert.match(html, /<svg/);
  });

  it("renders every posted tab without a host whitelist", () => {
    const slots = seats();
    registerAsideTab(slots, {
      edge: "right",
      id: "files",
      label: "文件",
      icon: FolderTree,
      order: 10,
      pane: () => null,
    });
    registerAsideTab(slots, {
      edge: "right",
      id: "search",
      label: "搜索",
      icon: Bot,
      order: 20,
      pane: () => null,
    });
    const html = renderToStaticMarkup(
      createElement(
        SlotsProvider,
        { slots },
        createElement(ActivityBar, {
          activeId: "search",
          onSelect: () => {},
        }),
      ),
    );
    assert.match(html, /aria-label="文件"/);
    assert.match(html, /aria-label="搜索"/);
    assert.match(html, /aria-pressed="true"/);
  });
});
