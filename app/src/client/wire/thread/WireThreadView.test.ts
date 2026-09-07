/**
 * WireThreadView pure mapping + grouping (shipped helpers).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chatLinesToDraftMessages,
  reuseDraftMessages,
  userOrdinalMap,
  WireThreadView,
} from "./WireThreadView";
import { groupLoopTurns, groupThreadBlocks } from "./thread-blocks";
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

  it("keeps last assistant streaming while busy even after text arrives", () => {
    const msgs = chatLinesToDraftMessages(
      [
        { id: "a1", role: "assistant", text: "old" },
        { id: "a2", role: "assistant", text: "hello" },
      ],
      { agentBusy: true },
    );
    assert.equal(msgs[0]!.meta?.streaming, false);
    assert.equal(msgs[1]!.meta?.streaming, true);
    assert.equal(msgs[1]!.body, "hello");
  });

  it("only the last thinking after the last assistant streams", () => {
    const msgs = chatLinesToDraftMessages(
      [
        { id: "a1", role: "assistant", text: "one" },
        { id: "th1", role: "thinking", text: "old" },
        { id: "a2", role: "assistant", text: "two" },
        { id: "th2", role: "thinking", text: "new" },
      ],
      { agentBusy: true },
    );
    assert.equal(msgs.find((m) => m.id === "th1")!.thinking?.streaming, false);
    assert.equal(msgs.find((m) => m.id === "th2")!.thinking?.streaming, true);
    assert.equal(msgs.find((m) => m.id === "a1")!.meta?.streaming, false);
    assert.equal(msgs.find((m) => m.id === "a2")!.meta?.streaming, true);
  });

  it("reuseDraftMessages keeps prefix identity when only a tail line is added", () => {
    const lines = [
      { id: "u", role: "user", text: "go" },
      { id: "a1", role: "assistant", text: "step" },
      { id: "t1", role: "tool", text: "▶ read_file", toolName: "read_file" },
      { id: "a2", role: "assistant", text: "done" },
    ];
    const live = chatLinesToDraftMessages(lines, { agentBusy: true });
    const liveAgain = chatLinesToDraftMessages(lines, { agentBusy: true });
    const reused = reuseDraftMessages(live, liveAgain);
    assert.equal(reused, live);
    assert.equal(reused[0], live[0]);
    const withTail = chatLinesToDraftMessages(
      [...lines, { id: "u2", role: "user", text: "next" }],
      { agentBusy: true },
    );
    const reusedTail = reuseDraftMessages(live, withTail);
    assert.equal(reusedTail[0], live[0]);
    assert.equal(reusedTail[1], live[1]);
    assert.notEqual(reusedTail[reusedTail.length - 1]!.id, live[live.length - 1]!.id);
  });

  it("maps unchanged source lines directly from the previous conversion", () => {
    const firstLines = [
      { id: "u", role: "user", text: "go" },
      { id: "a", role: "assistant", text: "step" },
    ];
    const first = chatLinesToDraftMessages(firstLines, {
      agentBusy: true,
      agentName: "coding",
    });
    const nextLines = [
      firstLines[0]!,
      { id: "a", role: "assistant", text: "step more" },
    ];
    const next = chatLinesToDraftMessages(nextLines, {
      agentBusy: true,
      agentName: "coding",
      reuse: {
        lines: firstLines,
        messages: first,
        agentBusy: true,
        agentName: "coding",
      },
    });
    assert.equal(next[0], first[0]);
    assert.notEqual(next[1], first[1]);
    assert.equal(next[1]!.body, "step more");
  });

  it("streaming and finished map to the same loop groups", () => {
    const lines = [
      { id: "u", role: "user", text: "go" },
      { id: "a1", role: "assistant", text: "step" },
      { id: "t1", role: "tool", text: "▶ read_file", toolName: "read_file" },
      { id: "a2", role: "assistant", text: "done" },
    ];
    const live = chatLinesToDraftMessages(lines, { agentBusy: true });
    const done = chatLinesToDraftMessages(
      [
        lines[0]!,
        lines[1]!,
        { id: "t1", role: "tool", text: "✓ read_file", toolName: "read_file" },
        lines[3]!,
      ],
      { agentBusy: false },
    );
    const liveSegs = groupLoopTurns(groupThreadBlocks(live));
    const doneSegs = groupLoopTurns(groupThreadBlocks(done));
    assert.equal(liveSegs.length, doneSegs.length);
    assert.equal(liveSegs[0]!.kind, "loop");
    assert.equal(doneSegs[0]!.kind, "loop");
    if (liveSegs[0]!.kind === "loop" && doneSegs[0]!.kind === "loop") {
      assert.equal(liveSegs[0]!.replies.length, doneSegs[0]!.replies.length);
      assert.equal(
        liveSegs[0]!.replies[0]!.assistant?.id,
        doneSegs[0]!.replies[0]!.assistant?.id,
      );
      assert.equal(
        liveSegs[0]!.replies[1]!.assistant?.id,
        doneSegs[0]!.replies[1]!.assistant?.id,
      );
    }
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
    assert.match(src, /useEnterIds/);
    assert.match(src, /MSG_ENTER_CLASS|is-enter/);
    assert.match(src, /threadKey/);
    assert.match(src, /wire-loop-spine|LoopSpine/);
    assert.match(src, /data-live-cursor/);
    assert.match(src, /offsetInScroll/);
    assert.match(src, /--user-stick-h/);
    assert.match(src, /\.wire-user-stick \.bubble\.user \.msg-body/);
    assert.match(src, /wire-reply-turn:last-child/);
    assert.doesNotMatch(src, /style\.bottom = ["']0["']/);
    assert.match(src, /wire-loop-rounds/);
    assert.match(src, /askAnchorProps/);
    assert.match(src, /wire-thread-lead/);
    assert.match(src, /UserMsgClip/);
    assert.match(src, /InfoHover/);
    assert.match(src, /wire-turn-fold|formatReplyTurnFold/);
    assert.match(src, /formatReplyPackFold|ReplyPackFold/);
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
    assert.match(html, /wire-loop-spine/);
    assert.match(html, /wire-loop-rounds/);
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

  it("shows the wait strip while a tool has not returned", () => {
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "go" },
        { id: "a", role: "assistant", text: "" },
        {
          id: "t",
          role: "tool",
          text: "▶ read_file",
          toolName: "read_file",
          startedAt: Date.now() - 400,
        },
      ],
      { agentBusy: true },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages, agentBusy: true }),
    );
    assert.match(html, /data-wait=/);
    assert.match(html, /等待工具返回/);
    assert.match(html, /wire-think-dur/);
    assert.match(html, /read_file|wire-tool/);
    assert.match(html, /data-live-cursor=/);
    assert.doesNotMatch(html, /wire-loop-foot/);
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

  it("tool card title uses path from toolArgs when description is empty", () => {
    const messages = chatLinesToDraftMessages([
      { id: "u", role: "user", text: "read" },
      { id: "a", role: "assistant", text: "看一下。" },
      {
        id: "t",
        role: "tool",
        text: "✓ read_file\nsecret",
        toolName: "read_file",
        toolArgs: JSON.stringify({ path: "/tmp/secrets.json" }),
      },
    ]);
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages }),
    );
    assert.match(html, /wire-tool-intent/);
    assert.match(html, /\/tmp\/secrets\.json/);
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

  it("shows a ticking wait strip while the assistant has not spoken yet", () => {
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
    assert.match(html, /data-wait=/);
    assert.match(html, /等待响应/);
    assert.match(html, /wire-think-head/);
    assert.match(html, /wire-think-dur/);
    assert.match(html, /is-wait-only/);
    assert.match(html, /data-wait=""[^>]*data-live-cursor=/);
    assert.doesNotMatch(html, /is-chip-only/);
    assert.doesNotMatch(html, /内部步骤/);
    assert.doesNotMatch(html, /wire-loop-foot/);
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

  it("loop footer uses user send → last reply, not the first assistant start", () => {
    const sent = Date.UTC(2026, 6, 31, 8, 0, 59, 0);
    const t0 = Date.UTC(2026, 6, 31, 8, 1, 0);
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "咕咕嘎嘎", startedAt: sent },
        {
          id: "a",
          role: "assistant",
          text: "ok",
          startedAt: t0,
          durationMs: 800,
        },
      ],
      { agentName: "ops" },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages, agentBusy: false }),
    );
    assert.match(html, /用时 1\.8s/);
    assert.doesNotMatch(html, /用时 —/);
  });

  it("rehydrated history without round duration still shows send→persist wall clock", () => {
    const sent = Date.UTC(2026, 6, 31, 8, 0, 0);
    const ended = Date.UTC(2026, 6, 31, 8, 0, 3);
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "咕咕嘎嘎", startedAt: sent },
        {
          id: "a",
          role: "assistant",
          text: "你好",
          startedAt: ended,
        },
      ],
      { agentName: "ops" },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages, agentBusy: false }),
    );
    assert.match(html, /用时 3s/);
    assert.doesNotMatch(html, /用时 —/);
  });
});

describe("WireThreadView earlier-turn fold", () => {
  it("folds earlier rounds to a one-line button; last round stays open", () => {
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "go" },
        {
          id: "a1",
          role: "assistant",
          text: "先做这一步。后面这一大段解释不应该出现在折叠行。",
        },
        { id: "t1", role: "tool", text: "✓ read_file", toolName: "read_file" },
        { id: "a2", role: "assistant", text: "最后一轮完整可见。" },
      ],
      { agentName: "ops" },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages, agentBusy: false }),
    );
    assert.match(html, /data-round="1"[^>]*data-turn-folded="true"/);
    assert.match(html, /data-round="2"[^>]*data-turn-folded="false"/);
    assert.match(html, /<button[^>]*wire-turn-fold/);
    assert.match(html, /1 工具/);
    assert.match(html, /data-turn-body=""[^>]*hidden/);
    assert.match(html, /不应该出现在折叠行/);
    assert.match(html, /最后一轮完整可见/);
    assert.match(html, /wire-user-stick/);
    assert.match(html, /wire-user-chip/);
    assert.doesNotMatch(html, /wire-turn-fold[\s\S]{0,200}data-msg-role="user"/);
  });

  it("summarizes a tool-only earlier turn by tool count", () => {
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "go" },
        { id: "a1", role: "assistant", text: "" },
        { id: "t1", role: "tool", text: "✓ read_file", toolName: "read_file" },
        { id: "a2", role: "assistant", text: "done" },
      ],
      { agentBusy: false },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages }),
    );
    assert.match(html, /data-turn-folded="true"/);
    assert.match(html, /wire-turn-fold[\s\S]*?1 工具/);
    assert.match(html, /data-turn-body=""[^>]*hidden/);
  });

  it("last-turn success and failure tools stay collapsed", () => {
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "go" },
        { id: "a", role: "assistant", text: "working" },
        {
          id: "t-ok",
          role: "tool",
          text: '{"ok":true}',
          toolName: "reader",
          toolDescription: "读取当前会话头信息",
          durationMs: 78,
        },
        {
          id: "t-err",
          role: "tool",
          text: "缺少必填",
          err: true,
          toolName: "project_manage",
          toolDescription: "创建项目",
          durationMs: 41,
        },
        {
          id: "t-wait",
          role: "tool",
          text: "▶ glob",
          toolName: "glob",
          toolDescription: "列 json",
        },
      ],
      { agentBusy: true },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages, agentBusy: true }),
    );
    assert.match(
      html,
      /wire-tool-card is-done is-collapsed" data-tool-name="reader"/,
    );
    assert.match(
      html,
      /wire-tool-card is-error is-done is-collapsed" data-tool-name="project_manage"/,
    );
    assert.match(
      html,
      /wire-tool-card is-running is-collapsed" data-tool-name="glob"/,
    );
    assert.match(html, /n-fold/);
    assert.doesNotMatch(html, /n-fold[^>]*data-open/);
    assert.match(html, /data-turn-folded="false"/);
  });

  it("keeps earlier-turn fold after a live last-turn delta", () => {
    const live1 = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "go" },
        { id: "a1", role: "assistant", text: "old step" },
        { id: "a2", role: "assistant", text: "" },
      ],
      { agentBusy: true },
    );
    const live2 = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "go" },
        { id: "a1", role: "assistant", text: "old step" },
        { id: "a2", role: "assistant", text: "hello" },
      ],
      { agentBusy: true },
    );
    const html1 = renderToStaticMarkup(
      createElement(WireThreadView, { messages: live1, agentBusy: true }),
    );
    const html2 = renderToStaticMarkup(
      createElement(WireThreadView, { messages: live2, agentBusy: true }),
    );
    assert.match(html1, /data-round="1"[^>]*data-turn-folded="true"/);
    assert.match(html2, /data-round="1"[^>]*data-turn-folded="true"/);
    assert.match(html2, /data-round="2"[^>]*data-turn-folded="false"/);
    assert.match(html2, /hello/);
    assert.doesNotMatch(html2, /is-chip-only/);
  });

  it("live last turn with body stays an AssistantTurn, not a chip-only shell", () => {
    const live = renderToStaticMarkup(
      createElement(WireThreadView, {
        messages: chatLinesToDraftMessages(
          [
            { id: "u", role: "user", text: "go" },
            { id: "a", role: "assistant", text: "hello" },
          ],
          { agentBusy: true },
        ),
        agentBusy: true,
      }),
    );
    const done = renderToStaticMarkup(
      createElement(WireThreadView, {
        messages: chatLinesToDraftMessages(
          [
            { id: "u", role: "user", text: "go" },
            { id: "a", role: "assistant", text: "hello" },
          ],
          { agentBusy: false },
        ),
      }),
    );
    assert.match(live, /wire-reply-turn[^>]*is-live/);
    assert.match(live, /wire-loop is-live/);
    assert.match(live, /hello/);
    assert.doesNotMatch(live, /is-chip-only/);
    assert.doesNotMatch(live, /wire-loop-foot/);
    assert.match(done, /hello/);
    assert.match(done, /wire-loop-foot/);
    assert.doesNotMatch(done, /is-chip-only/);
    assert.match(live, /data-live-cursor=/);
    assert.doesNotMatch(done, /data-live-cursor=/);
  });

  it("keeps the live last turn expanded", () => {
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "go" },
        { id: "a1", role: "assistant", text: "old step" },
        { id: "a2", role: "assistant", text: "" },
      ],
      { agentBusy: true },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages, agentBusy: true }),
    );
    assert.match(html, /data-round="1"[^>]*data-turn-folded="true"/);
    assert.match(html, /data-round="2"[^>]*data-turn-folded="false"/);
    assert.match(html, /data-wait=/);
    assert.match(html, /等待响应/);
    assert.doesNotMatch(html, /is-chip-only/);
    assert.doesNotMatch(html, /wire-loop-foot/);
  });

  it("packs two-plus earlier rounds into one line by default", () => {
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "go" },
        {
          id: "a1",
          role: "assistant",
          text: "第一轮细节不该出现在总包。",
          durationMs: 800,
        },
        { id: "t1", role: "tool", text: "✓ read_file", toolName: "read_file" },
        {
          id: "a2",
          role: "assistant",
          text: "第二轮细节也不该出现。",
          durationMs: 1200,
        },
        { id: "t2", role: "tool", text: "✓ glob", toolName: "glob" },
        { id: "t3", role: "tool", text: "✓ grep", toolName: "grep" },
        { id: "a3", role: "assistant", text: "最后一轮完整可见。" },
      ],
      { agentName: "ops" },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages, agentBusy: false }),
    );
    assert.match(html, /data-reply-pack=""/);
    assert.match(html, /data-pack-folded="true"/);
    assert.match(html, /data-reply-pack-fold=""/);
    assert.match(html, /data-pack-open="false"/);
    assert.match(html, /wire-pack-chevron/);
    assert.match(html, /data-pack-meta=""[^>]*>3 工具 · 2s</);
    assert.doesNotMatch(html, /wire-round-chip[^>]*>1–2</);
    assert.match(html, /data-round="1"[^>]*data-pack-away="true"/);
    assert.match(html, /data-round="2"[^>]*data-pack-away="true"/);
    assert.match(html, /data-round="3"[^>]*data-turn-folded="false"/);
    assert.doesNotMatch(html, /data-round="3"[^>]*data-pack-away="true"/);
    assert.match(html, /第一轮细节不该出现在总包/);
    assert.match(html, /第二轮细节也不该出现/);
    assert.match(html, /最后一轮完整可见/);
  });

  it("does not fold a single-round loop", () => {
    const messages = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "go" },
        { id: "a", role: "assistant", text: "only" },
      ],
      { agentBusy: false },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages }),
    );
    assert.doesNotMatch(html, /data-turn-folded="true"/);
    assert.doesNotMatch(html, /wire-turn-fold/);
    assert.match(html, /only/);
  });
});

describe("user ask mark", () => {
  const ask = (extra: Record<string, unknown> = {}) =>
    chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "go", ...extra },
        {
          id: "a",
          role: "assistant",
          text: "ok",
          startedAt: Date.UTC(2026, 6, 31, 8, 1, 0),
          durationMs: 800,
          usageInput: 1000,
          usageOutput: 48,
          cacheRead: 600,
          cacheReported: true,
          payloadId: "entry-a1",
          ...(extra.payload as object),
        },
        { id: "t", role: "tool", text: "✓ read_file" },
      ],
      { agentName: "ops" },
    );

  it("puts a numbered square on the ask, same column as the round circle", () => {
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages: ask() }),
    );
    assert.match(html, /data-user-chip=/);
    assert.match(html, /wire-user-chip/);
    // 方块与圆各一个，方块在用户气泡里
    assert.match(html, /wire-user-chip-hover/);
    assert.match(html, /data-round-chip=/);
  });

  it("stays a plain span with no inspector wired, and a button with one", () => {
    const plain = renderToStaticMarkup(
      createElement(WireThreadView, { messages: ask() }),
    );
    assert.doesNotMatch(plain, /<button[^>]*wire-user-chip/);
    assert.doesNotMatch(plain, /<button[^>]*wire-round-chip/);

    const wired = renderToStaticMarkup(
      createElement(WireThreadView, {
        messages: ask(),
        onInspectPayload: () => {},
      }),
    );
    assert.match(wired, /<button[^>]*wire-user-chip[^>]*is-inspectable/);
    assert.match(wired, /<button[^>]*wire-round-chip[^>]*is-inspectable/);
    assert.match(wired, /查看本轮发送的完整 POST 请求/);
    assert.match(wired, /查看本轮返回内容（含工具调用）/);
  });

  it("hover carries the ask's totals + average cache rate", () => {
    const html = renderToStaticMarkup(
      createElement(WireThreadView, {
        messages: ask(),
        onInspectPayload: () => {},
      }),
    );
    assert.match(html, /提问 #1/);
    assert.match(html, /工作时间 800ms/);
    assert.match(html, /总输入 1\.0k tok/);
    assert.match(html, /总输出 48 tok/);
    assert.match(html, /平均缓存率 60% · 600/);
    // 轮次圆自己的悬浮框也带缓存率
    assert.match(html, /缓存 60% · 600/);
  });

  it("numbers asks by the disk ordinal when the client only loaded the tail", () => {
    const msgs = chatLinesToDraftMessages([
      { id: "u1", role: "user", text: "a", ordinal: 7 },
      { id: "a1", role: "assistant", text: "x" },
      { id: "u2", role: "user", text: "b", ordinal: 8 },
      { id: "a2", role: "assistant", text: "y" },
    ]);
    const map = userOrdinalMap(msgs);
    assert.equal(map.get("u1"), 7);
    assert.equal(map.get("u2"), 8);
    const html = renderToStaticMarkup(
      createElement(WireThreadView, { messages: msgs }),
    );
    assert.match(html, /data-user-chip="" data-digits="1">7</);
    assert.match(html, /data-user-chip="" data-digits="1">8</);
  });

  it("drops 调用模型 system telemetry so thinking stays in the same loop", () => {
    const msgs = chatLinesToDraftMessages([
      { id: "u", role: "user", text: "咕咕嘎嘎" },
      { id: "a", role: "assistant", text: "我是 Ops Agent" },
      { id: "sys", role: "system", text: "调用模型: deepseek-v4-flash" },
      { id: "sys2", role: "system", text: "⏳ 编译 Prompt..." },
      { id: "th", role: "thinking", text: "…" },
    ]);
    assert.equal(
      msgs.some((m) => m.role === "system"),
      false,
    );
    const segs = groupLoopTurns(groupThreadBlocks(msgs));
    assert.equal(segs.length, 1);
    assert.equal(segs[0]!.kind, "loop");
    if (segs[0]!.kind === "loop") {
      assert.equal(segs[0]!.user?.id, "u");
      assert.equal(segs[0]!.replies.length, 1);
      assert.equal(segs[0]!.replies[0]!.internals.some((p) => p.role === "thinking"), true);
    }
  });

  it("falls back to visible order before the index lands", () => {
    const msgs = chatLinesToDraftMessages([
      { id: "u1", role: "user", text: "a" },
      { id: "a1", role: "assistant", text: "x" },
      { id: "u2", role: "user", text: "b" },
    ]);
    const map = userOrdinalMap(msgs);
    assert.equal(map.get("u1"), 1);
    assert.equal(map.get("u2"), 2);
  });

  it("puts the plan review card on the submit_plan turn, not after the thread", () => {
    const messages = chatLinesToDraftMessages(
      [
        { id: "u1", role: "user", text: "做个计划" },
        { id: "a1", role: "assistant", text: "先写计划。" },
        {
          id: "t1",
          role: "tool",
          text: "✓ submit_plan",
          toolName: "submit_plan",
        },
        { id: "u2", role: "user", text: "然后呢" },
        { id: "a2", role: "assistant", text: "继续做。" },
      ],
      { agentBusy: false },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, {
        messages,
        planReview: createElement(
          "div",
          { "data-plan-card": "" },
          "计划报告",
        ),
      }),
    );
    assert.match(html, /data-plan-in-thread=""/);
    const planAt = html.indexOf("data-plan-in-thread");
    const laterAt = html.indexOf("继续做。");
    assert.ok(planAt > 0);
    assert.ok(laterAt > planAt);
  });

  it("does not park a settled plan card under later user turns", () => {
    const messages = chatLinesToDraftMessages(
      [
        { id: "u1", role: "user", text: "先问别的" },
        { id: "a1", role: "assistant", text: "好。" },
        { id: "u2", role: "user", text: "现在可以干什么" },
        { id: "a2", role: "assistant", text: "继续。" },
      ],
      { agentBusy: false },
    );
    const html = renderToStaticMarkup(
      createElement(WireThreadView, {
        messages,
        planReview: createElement(
          "div",
          { "data-plan-card": "" },
          "计划报告",
        ),
      }),
    );
    assert.doesNotMatch(html, /data-plan-in-thread=/);
    assert.doesNotMatch(html, /data-plan-card=/);
  });

  it("keeps a live plan under the wait strip, not a floating chip", () => {
    const html = renderToStaticMarkup(
      createElement(WireThreadView, {
        messages: chatLinesToDraftMessages(
          [{ id: "u", role: "user", text: "现在可以干什么" }],
          { agentBusy: true },
        ),
        agentBusy: true,
        planReviewFollow: true,
        planReview: createElement(
          "div",
          { "data-plan-card": "" },
          "计划报告",
        ),
      }),
    );
    assert.match(html, /wire-reply-turn[^>]*has-body/);
    assert.match(html, /wire-reply-turn[^>]*has-plan/);
    assert.match(html, /is-wait-only/);
    assert.match(html, /data-wait=""[^>]*data-live-cursor=/);
    assert.match(html, /data-plan-in-thread=/);
    assert.match(html, /data-plan-card=/);
    assert.doesNotMatch(html, /is-chip-only/);
    assert.doesNotMatch(html, /内部步骤/);
    assert.doesNotMatch(html, /class="wire-live-cursor"/);
    const waitAt = html.indexOf("data-wait=");
    const planAt = html.indexOf("data-plan-in-thread");
    assert.ok(waitAt > 0);
    assert.ok(planAt > waitAt);
  });
});
