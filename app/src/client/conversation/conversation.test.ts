import assert from "node:assert/strict";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConversationPane } from "./ConversationPane";
import { ThreadBoard } from "./ThreadBoard";
import { UserStick } from "./UserStick";
import { stackFlowOffset, stickHomeScrollTop } from "./scroll-offset";
import { ASK_PREVIEW_MAX, clipAskPreview } from "./ask-preview";
import {
  ASK_ANCHOR_SEL,
  askAnchorProps,
  readAskAnchor,
  USER_STICK_CLASS,
} from "./contract";

const here = dirname(fileURLToPath(import.meta.url));

describe("conversation contract", () => {
  it("reads ask id and preview from the published dataset", () => {
    const el = {
      dataset: { askId: "u1", askPreview: "hello" },
    } as unknown as HTMLElement;
    assert.deepEqual(readAskAnchor(el), { askId: "u1", askPreview: "hello" });
    assert.equal(ASK_ANCHOR_SEL, "[data-ask-anchor]");
    assert.equal(USER_STICK_CLASS, "wire-user-stick");
    const props = askAnchorProps("u2", "hi");
    assert.equal(props["data-ask-id"], "u2");
    assert.equal(clipAskPreview("  hello  "), "hello");
    assert.equal(clipAskPreview("问".repeat(ASK_PREVIEW_MAX + 5)).length, ASK_PREVIEW_MAX);
  });
});

describe("ThreadBoard", () => {
  it("owns the scrollport and does not take a rail", () => {
    const html = renderToStaticMarkup(
      createElement(ThreadBoard, { empty: false }, createElement("p", null, "msg")),
    );
    assert.match(html, /wire-thread-rail-host/);
    assert.match(html, /wire-context-scroll/);
    assert.match(html, /data-thread-scroll/);
    assert.match(html, /msg/);
    const src = readFileSync(join(here, "ThreadBoard.tsx"), "utf8");
    assert.doesNotMatch(src, /rail\?:/);
  });

  it("marks empty scroll", () => {
    const html = renderToStaticMarkup(
      createElement(ThreadBoard, { empty: true }, "empty"),
    );
    assert.match(html, /is-empty/);
  });
});

describe("UserStick", () => {
  it("can carry an ask anchor or stay stick-only", () => {
    const withAsk = renderToStaticMarkup(
      createElement(UserStick, { ask: { id: "u1", preview: "hi" } }, "q"),
    );
    assert.match(withAsk, /data-ask-anchor/);
    assert.match(withAsk, /data-ask-id="u1"/);
    const stickOnly = renderToStaticMarkup(createElement(UserStick, null, "q"));
    assert.doesNotMatch(stickOnly, /data-ask-anchor/);
    assert.match(stickOnly, /wire-user-stick/);
    assert.match(stickOnly, /role="button"/);
    assert.match(stickOnly, /跳到这条提问/);
    const src = readFileSync(join(here, "UserStick.tsx"), "utf8");
    assert.match(src, /onClickCapture/);
    assert.match(src, /scrollStickHome/);
  });

  it("jumps a stuck stick back to its in-flow top", () => {
    assert.equal(stickHomeScrollTop(80, 80, 400), null);
    assert.equal(stickHomeScrollTop(80, 200, 400), 80);
    assert.equal(stickHomeScrollTop(500, 600, 400), 400);
    assert.equal(stickHomeScrollTop(200, 200, 400), null);
  });

  it("stacks previous siblings and flex gap for a sticky node's home", () => {
    assert.equal(stackFlowOffset(0, 8, []), 0);
    assert.equal(
      stackFlowOffset(0, 16, [{ height: 28, marginTop: 0, marginBottom: -16 }]),
      28,
    );
    assert.equal(
      stackFlowOffset(0, 8, [
        { height: 40, marginTop: 0, marginBottom: 0 },
        { height: 60, marginTop: 0, marginBottom: 0 },
      ]),
      116,
    );
    const src = readFileSync(join(here, "scroll-offset.ts"), "utf8");
    assert.match(src, /position === "sticky"/);
    assert.match(src, /inFlowOffsetInParent/);
  });
});

describe("ConversationPane", () => {
  it("mounts the board inside the thread stage", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationPane, {
        messages: "msgs",
        composer: "cmp",
        scrollRef: createRef<HTMLDivElement>(),
        empty: false,
        rail: createElement("aside", { "data-ask-rail": "" }),
      }),
    );
    assert.match(html, /wire-thread-stage/);
    assert.match(html, /wire-thread-rail-host/);
    assert.match(html, /data-ask-rail/);
    const railAt = html.indexOf("data-ask-rail");
    const hostAt = html.indexOf("wire-thread-rail-host");
    assert.ok(railAt > hostAt);
  });

  it("omits rail when empty", () => {
    const html = renderToStaticMarkup(
      createElement(ConversationPane, {
        messages: "msgs",
        composer: "cmp",
        empty: true,
        rail: createElement("aside", { "data-ask-rail": "" }),
      }),
    );
    assert.doesNotMatch(html, /data-ask-rail/);
  });
});

describe("conversation source boundaries", () => {
  it("pane does not import the message tree or rail math", () => {
    const pane = readFileSync(join(here, "ConversationPane.tsx"), "utf8");
    assert.doesNotMatch(pane, /WireThreadView/);
    assert.doesNotMatch(pane, /AskScrollRail/);
    assert.match(pane, /ThreadBoard/);
  });

  it("conversation package does not import drafts", () => {
    for (const file of [
      "ConversationPane.tsx",
      "ThreadBoard.tsx",
      "UserStick.tsx",
      "contract.ts",
      "ask-preview.ts",
      "scroll-offset.ts",
    ]) {
      const src = readFileSync(join(here, file), "utf8");
      assert.doesNotMatch(src, /from ["']\.\.\/drafts/);
    }
  });

  it("ask rail only reads the published ask contract", () => {
    const rail = readFileSync(join(here, "../drafts/AskScrollRail.tsx"), "utf8");
    assert.match(rail, /ASK_ANCHOR_SEL/);
    assert.match(rail, /readAskAnchor/);
    assert.doesNotMatch(rail, /createPortal/);
    assert.doesNotMatch(rail, /wire-thread-stage/);
    assert.doesNotMatch(rail, /data-msg-role/);
    assert.doesNotMatch(rail, /WireThreadView/);
  });
});
