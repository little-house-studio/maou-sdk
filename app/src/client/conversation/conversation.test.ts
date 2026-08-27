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
