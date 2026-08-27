/**
 * WireThreadView pure mapping + grouping (shipped helpers).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chatLinesToDraftMessages, WireThreadView } from "./WireThreadView";
import { groupThreadBlocks } from "../thread-blocks";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const here = dirname(fileURLToPath(import.meta.url));

describe("chatLinesToDraftMessages + groupThreadBlocks", () => {
  it("maps live chat lines and nests tools under assistant", () => {
    const msgs = chatLinesToDraftMessages(
      [
        {
          id: "u1",
          role: "user",
          text: "hello",
          images: [{ mimeType: "image/png", data: "AAA" }],
        },
        { id: "a1", role: "assistant", text: "working" },
        { id: "t1", role: "tool", text: "ls", terminalId: "term-1" },
        { id: "th1", role: "thinking", text: "hmm" },
      ],
      { agentBusy: false, agentName: "coding" },
    );
    assert.equal(msgs[0]!.role, "user");
    assert.equal(msgs[0]!.images?.length, 1);
    assert.equal(msgs[1]!.role, "assistant");
    assert.equal(msgs[1]!.meta?.round, 1);
    assert.equal(msgs[2]!.role, "tool");
    assert.equal(msgs[2]!.tool?.name, "use_terminal");
    assert.equal(msgs[3]!.role, "thinking");

    const blocks = groupThreadBlocks(msgs);
    // user solo + assistant reply with tool+thinking internals
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.kind, "solo");
    assert.equal(blocks[1]!.kind, "reply");
    if (blocks[1]!.kind === "reply") {
      assert.equal(blocks[1]!.assistant?.id, "a1");
      assert.equal(blocks[1]!.internals.length, 2);
    }
  });

  it("in-flight ▶ tools are not done; ✓ / finished tools are", () => {
    const busy = chatLinesToDraftMessages(
      [
        { id: "t1", role: "tool", text: "▶ use_terminal" },
        { id: "t2", role: "tool", text: "✓ reader" },
        { id: "t3", role: "tool", text: "" },
      ],
      { agentBusy: true },
    );
    assert.equal(busy[0]!.tool?.done, false);
    assert.equal(busy[1]!.tool?.done, true);
    assert.equal(busy[2]!.tool?.done, false);

    const idle = chatLinesToDraftMessages(
      [{ id: "t", role: "tool", text: "✓ use_terminal" }],
      { agentBusy: false },
    );
    assert.equal(idle[0]!.tool?.done, true);
  });

  it("maps tool call intent and duration, not result dump or terminal id", () => {
    const msgs = chatLinesToDraftMessages(
      [
        {
          id: "t1",
          role: "tool",
          text: "✓ use_terminal · term-9\n=== 前台窗口标题 ===",
          terminalId: "term-9",
          toolName: "use_terminal",
          toolDescription: "读前台窗口标题",
          durationMs: 1130,
        },
        {
          id: "t2",
          role: "tool",
          text: "▶ use_terminal · 列出所有窗口",
          toolName: "use_terminal",
        },
      ],
      { agentBusy: true },
    );
    assert.equal(msgs[0]!.tool?.description, "读前台窗口标题");
    assert.equal(msgs[0]!.tool?.durationMs, 1130);
    assert.notEqual(msgs[0]!.tool?.description, "terminal term-9");
    assert.notEqual(msgs[0]!.tool?.description, "=== 前台窗口标题 ===");
    assert.equal(msgs[1]!.tool?.description, "列出所有窗口");
    assert.equal(msgs[1]!.tool?.done, false);
  });

  it("marks streaming assistant when busy and empty body", () => {
    const msgs = chatLinesToDraftMessages(
      [{ id: "a", role: "assistant", text: "" }],
      { agentBusy: true },
    );
    assert.equal(msgs[0]!.meta?.streaming, true);
    assert.equal(msgs[0]!.body, "");
  });

  it("thinking defaults collapsed; keeps duration/tokens meta", () => {
    const live = chatLinesToDraftMessages(
      [
        {
          id: "th",
          role: "thinking",
          text: "step one",
          thinkStartedAt: 1,
          thinkDurationMs: 800,
          thinkOutputTokens: 42,
        },
      ],
      { agentBusy: true },
    );
    assert.equal(live[0]!.thinking?.streaming, true);
    assert.equal(live[0]!.thinking?.collapsed, true);
    assert.equal(live[0]!.thinking?.outputTokens, 42);
    assert.equal(live[0]!.thinking?.durationMs, 800);

    const done = chatLinesToDraftMessages(
      [{ id: "th", role: "thinking", text: "step one" }],
      { agentBusy: false },
    );
    assert.equal(done[0]!.thinking?.streaming, false);
    assert.equal(done[0]!.thinking?.collapsed, true);
  });

  it("groupThreadBlocks keeps thinking as internals under assistant", () => {
    const msgs = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "hi" },
        { id: "a", role: "assistant", text: "ans" },
        { id: "th", role: "thinking", text: "reason" },
      ],
      { agentBusy: false },
    );
    // order assistant then thinking → nested
    const blocks = groupThreadBlocks(msgs);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[1]!.kind, "reply");
    if (blocks[1]!.kind === "reply") {
      assert.equal(blocks[1]!.internals.some((i) => i.role === "thinking"), true);
    }
  });
});

describe("WireThreadView source structure", () => {
  it("ships groupThreadBlocks + ToolCard + DraftMarkdown", () => {
    const src = readFileSync(join(here, "WireThreadView.tsx"), "utf8");
    assert.match(src, /groupThreadBlocks/);
    assert.match(src, /ToolCard/);
    assert.match(src, /DraftMarkdown/);
    assert.match(src, /AssistantTurn|wire-reply-turn/);
    assert.match(src, /chatLinesToDraftMessages/);
    assert.match(src, /wire-round-chip/);
    assert.match(src, /wire-loop-foot|LoopFoot/);
    assert.doesNotMatch(src, /AskScrollRail/);
    assert.doesNotMatch(src, /ask-scroll-rail/);
    assert.doesNotMatch(src, /wire-thread-rail-host/);
    assert.match(src, /UserStick/);
    assert.match(src, /askAnchorProps/);
    assert.match(src, /wire-thread-lead/);
    assert.match(src, /InfoHover/);
    assert.doesNotMatch(src, /msg-avatar-wrap/);
    assert.doesNotMatch(src, /wire-round-chip[\s\S]{0,80}title=/);
  });
});

describe("WireThreadView round chip", () => {
  it("puts a numbered circle left of the assistant turn, not an agent name line", () => {
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "go" },
        {
          id: "a",
          role: "assistant",
          text: "ok",
          startedAt: Date.UTC(2026, 6, 31, 8, 1, 0),
          durationMs: 800,
          usageOutput: 48,
        },
        { id: "t", role: "tool", text: "✓ read_file" },
      ],
      { agentName: "ops" },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages }),
    );
    assert.match(html, /data-ask-anchor/);
    assert.match(html, /data-ask-id="u"/);
    assert.match(html, /wire-round-chip/);
    assert.match(html, /data-round="1"/);
    assert.match(html, /第 1 轮/);
    assert.match(html, /工具 1/);
    assert.match(html, /输出 48 tok/);
    assert.doesNotMatch(html, /msg-head-who/);
    assert.doesNotMatch(html, />ops</);
    assert.match(html, /wire-loop-foot/);
    assert.match(html, /用时 800ms/);
    assert.match(html, /共 1 轮/);
    assert.match(html, /共工具 1/);
    assert.match(html, /共输出 48 tok/);
  });

  it("omits the loop footer while the last turn is still running", () => {
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "go" },
        { id: "a", role: "assistant", text: "…" },
      ],
      { agentBusy: true, agentName: "ops" },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages, agentBusy: true }),
    );
    assert.doesNotMatch(html, /wire-loop-foot/);
    assert.match(html, /wire-round-chip/);
  });

  it("does not render empty assistant body above tool cards", () => {
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "go" },
        { id: "a", role: "assistant", text: "" },
        { id: "t", role: "tool", text: "✓ use_terminal" },
      ],
      { agentBusy: false },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages }),
    );
    assert.match(html, /data-round="1"/);
    assert.match(html, /use_terminal|wire-tool/);
    assert.doesNotMatch(html, /wire-reply-body[\s\S]*?bubble-text/);
    assert.match(html, /wire-loop-foot/);
  });

  it("skips a trailing empty assistant so the loop foot is not a blank round", () => {
    const t0 = Date.UTC(2026, 6, 31, 8, 1, 0);
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "go" },
        {
          id: "a1",
          role: "assistant",
          text: "",
          startedAt: t0,
          durationMs: 40_000,
        },
        { id: "t1", role: "tool", text: "✓ use_terminal" },
        {
          id: "a2",
          role: "assistant",
          text: "done",
          startedAt: t0 + 40_000,
          durationMs: 60_000,
          usageOutput: 12,
        },
        { id: "t2", role: "tool", text: "✓ reader" },
        {
          id: "a3",
          role: "assistant",
          text: "",
          startedAt: t0 + 100_000,
          durationMs: 0,
        },
      ],
      { agentBusy: false },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages, agentBusy: false }),
    );
    assert.match(html, /data-round="1"/);
    assert.match(html, /data-round="2"/);
    assert.doesNotMatch(html, /data-round="3"/);
    assert.match(html, /wire-loop-foot/);
    assert.match(html, /共 2 轮/);
    assert.doesNotMatch(html, /用时 —/);
  });

  it("hides chip and footer when the only reply is a finished empty assistant", () => {
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "try" },
        { id: "a", role: "assistant", text: "" },
      ],
      { agentBusy: false },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages, agentBusy: false }),
    );
    assert.doesNotMatch(html, /wire-round-chip/);
    assert.doesNotMatch(html, /wire-loop-foot/);
  });

  it("keeps a compact live chip when the assistant has not spoken yet", () => {
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "try" },
        { id: "a", role: "assistant", text: "" },
      ],
      { agentBusy: true },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages, agentBusy: true }),
    );
    assert.match(html, /wire-round-chip/);
    assert.match(html, /is-chip-only/);
    assert.doesNotMatch(html, /wire-loop-foot/);
    assert.doesNotMatch(html, /wire-reply-body/);
  });

  it("keeps usage on the round chip, not in the message body", () => {
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "go" },
        {
          id: "a",
          role: "assistant",
          text: "ok",
          usageInput: 108_400,
          usageOutput: 410,
        },
      ],
      { agentName: "coding" },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages }),
    );
    assert.doesNotMatch(html, /wire-usage-line|data-usage=/);
    assert.doesNotMatch(html, /↑108\.4k · ↓410 · 占用 108\.8k/);
    assert.match(html, /data-round-chip=/);
    assert.match(html, /占用 108\.8k tok/);
  });

  it("loop footer sums rounds / tools / tokens after a finished multi-round turn", () => {
    const t0 = Date.UTC(2026, 6, 31, 8, 1, 0);
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "go" },
        {
          id: "a1",
          role: "assistant",
          text: "first",
          startedAt: t0,
          durationMs: 500,
          usageOutput: 10,
        },
        { id: "t1", role: "tool", text: "✓ read_file" },
        { id: "t2", role: "tool", text: "✓ grep" },
        {
          id: "a2",
          role: "assistant",
          text: "second",
          startedAt: t0 + 500,
          durationMs: 300,
          usageOutput: 20,
        },
      ],
      { agentName: "ops" },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages, agentBusy: false }),
    );
    assert.match(html, /data-loop-complete="true"/);
    assert.match(html, /data-round="1"/);
    assert.match(html, /data-round="2"/);
    assert.match(html, /用时 800ms/);
    assert.match(html, /共 2 轮/);
    assert.match(html, /共工具 2/);
    assert.match(html, /共输出 30 tok/);
  });
});
