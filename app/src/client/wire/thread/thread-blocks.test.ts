import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clipTurnSummary,
  groupLoopTurns,
  groupThreadBlocks,
  isModelCallProgressText,
  isPlaceholderAssistantBody,
  pickPlanReviewAnchorId,
  formatReplyPackFold,
  formatReplyPackMeta,
  formatReplyTurnFold,
  pinReleasedLastTurn,
  replyPackOpen,
  replyPackable,
  replyTurnDurationMs,
  replyTurnFoldable,
  replyTurnOpen,
  replyTurnToolCount,
  replyTurnVisible,
  replyWaitStatus,
  summarizeReplyTurn,
} from "./thread-blocks";
import { THREAD_MESSAGES } from "../test-thread";
import type { DraftMessage } from "../types";
import type { ReplyBlock } from "./thread-blocks";

describe("groupThreadBlocks", () => {
  it("nests thinking + tool under preceding assistant", () => {
    const msgs: DraftMessage[] = [
      { id: "u", role: "user", body: "hi" },
      { id: "a", role: "assistant", body: "ok **md**" },
      { id: "t", role: "thinking", body: "scan…" },
      {
        id: "tool",
        role: "tool",
        tag: "use_terminal",
        body: "$ rg foo",
        clickable: true,
      },
      { id: "u2", role: "user", body: "next" },
    ];
    const blocks = groupThreadBlocks(msgs);
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]!.kind, "solo");
    assert.equal(blocks[1]!.kind, "reply");
    if (blocks[1]!.kind === "reply") {
      assert.equal(blocks[1]!.assistant?.id, "a");
      assert.equal(blocks[1]!.internals.length, 2);
      assert.equal(blocks[1]!.internals[0]!.role, "thinking");
      assert.equal(blocks[1]!.internals[1]!.role, "tool");
    }
    assert.equal(blocks[2]!.kind, "solo");
  });

  it("groups orphan tools without assistant", () => {
    const msgs: DraftMessage[] = [
      { id: "tool", role: "tool", tag: "x", body: "out" },
    ];
    const blocks = groupThreadBlocks(msgs);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.kind, "reply");
    if (blocks[0]!.kind === "reply") {
      assert.equal(blocks[0]!.assistant, null);
      assert.equal(blocks[0]!.internals[0]!.id, "tool");
    }
  });

  it("THREAD_MESSAGES yields nested + orphan reply blocks", () => {
    const blocks = groupThreadBlocks(THREAD_MESSAGES);
    assert.ok(blocks.length >= 6);
    const nested = blocks.find(
      (b) =>
        b.kind === "reply" &&
        b.assistant !== null &&
        b.internals.some((i) => i.role === "thinking") &&
        b.internals.some((i) => i.role === "tool"),
    );
    assert.ok(nested, "expected nested thinking+tool under assistant");
    const orphan = blocks.find(
      (b) =>
        b.kind === "reply" &&
        b.assistant === null &&
        b.internals.some((i) => i.role === "tool"),
    );
    assert.ok(orphan, "expected orphan tool group");
    assert.ok(
      blocks.some((b) => b.kind === "solo" && b.message.role === "user"),
    );
    assert.ok(
      blocks.some((b) => b.kind === "solo" && b.message.role === "system"),
    );
    const clean = blocks.find(
      (b) =>
        b.kind === "reply" &&
        b.assistant?.id === "fc-a4-clean" &&
        b.internals.length === 0,
    );
    assert.ok(clean, "clean assistant bubble without internals");
  });

  it("groupLoopTurns folds user + following replies until the next user/system", () => {
    const msgs: DraftMessage[] = [
      { id: "u", role: "user", body: "hi" },
      { id: "a1", role: "assistant", body: "one" },
      { id: "t", role: "tool", tag: "x", body: "out" },
      { id: "a2", role: "assistant", body: "two" },
      { id: "sys", role: "system", body: "note" },
      { id: "u2", role: "user", body: "next" },
      { id: "a3", role: "assistant", body: "ok" },
    ];
    const segs = groupLoopTurns(groupThreadBlocks(msgs));
    assert.equal(segs.length, 3);
    assert.equal(segs[0]!.kind, "loop");
    if (segs[0]!.kind === "loop") {
      assert.equal(segs[0]!.user?.id, "u");
      assert.equal(segs[0]!.replies.length, 2);
    }
    assert.equal(segs[1]!.kind, "solo");
    if (segs[1]!.kind === "solo") {
      assert.equal(segs[1]!.message.id, "sys");
    }
    assert.equal(segs[2]!.kind, "loop");
    if (segs[2]!.kind === "loop") {
      assert.equal(segs[2]!.user?.id, "u2");
      assert.equal(segs[2]!.replies.length, 1);
    }
  });

  it("model-call progress is not a system notice", () => {
    assert.equal(isModelCallProgressText("调用模型: deepseek-v4-flash"), true);
    assert.equal(isModelCallProgressText("调用模型..."), true);
    assert.equal(isModelCallProgressText("⏳ 调用模型..."), true);
    assert.equal(isModelCallProgressText("编译 Prompt..."), true);
    assert.equal(isModelCallProgressText("⏳ 编译 Prompt..."), true);
    assert.equal(isModelCallProgressText("开始编译 Prompt"), true);
    assert.equal(isModelCallProgressText("规划目标合同..."), true);
    assert.equal(isModelCallProgressText("模型切换: a → b"), false);
    assert.equal(isModelCallProgressText("上下文压缩完成"), false);
  });

  it("replyTurnVisible hides blank finished assistants and keeps live/tool turns", () => {
    assert.equal(isPlaceholderAssistantBody(""), true);
    assert.equal(isPlaceholderAssistantBody("…"), true);
    assert.equal(isPlaceholderAssistantBody("ok"), false);
    assert.equal(isPlaceholderAssistantBody("… 调用模型: deepseek-v4-flash"), true);
    assert.equal(isPlaceholderAssistantBody("调用模型..."), true);

    assert.equal(
      replyTurnVisible({
        kind: "reply",
        assistant: { id: "a", role: "assistant", body: "" },
        internals: [],
      }),
      false,
    );
    assert.equal(
      replyTurnVisible({
        kind: "reply",
        assistant: {
          id: "a",
          role: "assistant",
          body: "",
          meta: { streaming: true },
        },
        internals: [],
      }),
      true,
    );
    assert.equal(
      replyTurnVisible({
        kind: "reply",
        assistant: { id: "a", role: "assistant", body: "" },
        internals: [{ id: "t", role: "tool", body: "ls" }],
      }),
      true,
    );
    assert.equal(
      replyTurnVisible(
        {
          kind: "reply",
          assistant: { id: "a", role: "assistant", body: "" },
          internals: [],
        },
        true,
      ),
      true,
    );
  });

  it("replyWaitStatus times the gray wait strip until thinking or body arrives", () => {
    assert.equal(
      replyWaitStatus({
        kind: "reply",
        assistant: { id: "a", role: "assistant", body: "ok" },
        internals: [],
      }, true),
      null,
    );
    assert.deepEqual(
      replyWaitStatus({
        kind: "reply",
        assistant: {
          id: "a",
          role: "assistant",
          body: "",
          meta: { streaming: true, ts: 1000 },
        },
        internals: [],
      }),
      { label: "等待响应…", startedAt: 1000 },
    );
    assert.deepEqual(
      replyWaitStatus({
        kind: "reply",
        assistant: { id: "a", role: "assistant", body: "" },
        internals: [
          {
            id: "t",
            role: "tool",
            body: "▶ read_file",
            tool: { name: "read_file", done: false },
            meta: { ts: 2000 },
          },
        ],
      }),
      { label: "等待工具返回…", startedAt: 2000 },
    );
    assert.equal(
      replyWaitStatus({
        kind: "reply",
        assistant: { id: "a", role: "assistant", body: "" },
        internals: [
          {
            id: "th",
            role: "thinking",
            body: "…",
            thinking: { streaming: true, startedAt: 1 },
          },
        ],
      }, true),
      null,
    );
  });
});

describe("reply turn fold helpers", () => {
  it("clipTurnSummary keeps a short first sentence and clips a long line", () => {
    assert.equal(clipTurnSummary("  先做这一步。后面丢掉。  "), "先做这一步。");
    assert.equal(
      clipTurnSummary("好的。先把模块拆开，再用假数据把布局跑通。"),
      "好的。先把模块拆开，再用假数据把布局跑通。",
    );
    const long = `可见开头${"Z".repeat(80)}TAIL`;
    const clipped = clipTurnSummary(long);
    assert.ok(clipped.startsWith("可见开头"));
    assert.ok(clipped.endsWith("…"));
    assert.ok(clipped.length <= 48);
    assert.ok(!clipped.includes("TAIL"));
  });

  it("summarizeReplyTurn prefers body, then tool name, then Thought duration", () => {
    assert.equal(
      summarizeReplyTurn({
        kind: "reply",
        assistant: { id: "a", role: "assistant", body: "先做这一步。后面丢掉。" },
        internals: [],
      }),
      "先做这一步。",
    );
    assert.equal(
      summarizeReplyTurn({
        kind: "reply",
        assistant: { id: "a", role: "assistant", body: "" },
        internals: [
          {
            id: "t",
            role: "tool",
            tag: "use_terminal",
            body: "ls",
            tool: { name: "read_file" },
          },
        ],
      }),
      "read_file",
    );
    assert.equal(
      summarizeReplyTurn({
        kind: "reply",
        assistant: { id: "a", role: "assistant", body: "…" },
        internals: [
          {
            id: "th",
            role: "thinking",
            body: "hmm",
            thinking: { durationMs: 1500 },
          },
        ],
      }),
      "Thought · 1.5s",
    );
    assert.equal(
      summarizeReplyTurn({
        kind: "reply",
        assistant: null,
        internals: [{ id: "e", role: "err", body: "boom" }],
      }),
      "错误",
    );
  });

  it("replyTurnOpen expands last / live; remembers userOpen except running last", () => {
    assert.equal(
      replyTurnOpen({
        isLastVisible: true,
        turnLive: false,
        loopLive: false,
      }),
      true,
    );
    assert.equal(
      replyTurnOpen({
        isLastVisible: false,
        turnLive: false,
        loopLive: true,
      }),
      false,
    );
    assert.equal(
      replyTurnOpen({
        isLastVisible: true,
        turnLive: false,
        loopLive: true,
      }),
      true,
    );
    assert.equal(
      replyTurnOpen({
        isLastVisible: false,
        turnLive: true,
        loopLive: false,
      }),
      true,
    );
    assert.equal(
      replyTurnOpen({
        isLastVisible: false,
        turnLive: false,
        loopLive: false,
        userOpen: true,
      }),
      true,
    );
    assert.equal(
      replyTurnOpen({
        isLastVisible: true,
        turnLive: false,
        loopLive: true,
        userOpen: false,
      }),
      true,
    );
    assert.equal(
      replyTurnFoldable({ isLastVisible: true, turnLive: false }),
      false,
    );
    assert.equal(
      replyTurnFoldable({ isLastVisible: false, turnLive: false }),
      true,
    );
    assert.equal(
      replyTurnFoldable({ isLastVisible: false, turnLive: true }),
      false,
    );
  });

  it("formatReplyTurnFold / formatReplyPackFold use duration and tool count", () => {
    const a1: ReplyBlock = {
      kind: "reply",
      assistant: {
        id: "a1",
        role: "assistant",
        body: "先做这一步。",
        meta: { durationMs: 800 },
      },
      internals: [
        { id: "t1", role: "tool", body: "ls", tool: { name: "read_file" } },
      ],
    };
    const a2: ReplyBlock = {
      kind: "reply",
      assistant: {
        id: "a2",
        role: "assistant",
        body: "下一步",
        meta: { durationMs: 1200 },
      },
      internals: [
        { id: "t2", role: "tool", body: "x", tool: { name: "glob" } },
        { id: "t3", role: "tool", body: "y", tool: { name: "grep" } },
      ],
    };
    assert.equal(replyTurnToolCount(a1), 1);
    assert.equal(replyTurnDurationMs(a1), 800);
    assert.equal(formatReplyTurnFold(a1), "800ms · 1 工具");
    assert.equal(formatReplyTurnFold(a2), "1.2s · 2 工具");
    assert.equal(formatReplyPackFold([a1, a2]), "2 轮 · 2s · 3 工具");
    assert.equal(formatReplyPackMeta([a1, a2]), "3 工具 · 2s");
    assert.equal(formatReplyPackMeta([a1]), "1 工具 · 800ms");
    assert.equal(replyPackable(1), false);
    assert.equal(replyPackable(2), true);
    assert.equal(replyPackOpen({ packable: false }), true);
    assert.equal(replyPackOpen({ packable: true }), false);
    assert.equal(replyPackOpen({ packable: true, userOpen: true }), true);
    assert.equal(replyPackOpen({ packable: true, userOpen: false }), false);
  });

  it("pickPlanReviewAnchorId prefers the submit_plan turn", () => {
    const plan: ReplyBlock = {
      kind: "reply",
      assistant: { id: "ap", role: "assistant", body: "计划写好了" },
      internals: [
        {
          id: "tp",
          role: "tool",
          body: "✓ submit_plan",
          tool: { name: "submit_plan" },
        },
      ],
    };
    const later: ReplyBlock = {
      kind: "reply",
      assistant: { id: "al", role: "assistant", body: "继续" },
      internals: [],
    };
    const segments = groupLoopTurns([
      { kind: "solo", message: { id: "u", role: "user", body: "做计划" } },
      plan,
      later,
    ]);
    assert.equal(pickPlanReviewAnchorId(segments), "ap");
    assert.equal(
      pickPlanReviewAnchorId(
        groupLoopTurns([
          { kind: "solo", message: { id: "u2", role: "user", body: "问" } },
          later,
        ]),
      ),
      null,
    );
    assert.equal(
      pickPlanReviewAnchorId(
        groupLoopTurns([
          { kind: "solo", message: { id: "u2", role: "user", body: "问" } },
          later,
        ]),
        { fallback: true },
      ),
      "al",
    );
  });

  it("pinReleasedLastTurn keeps the outgoing last turn open unless the user already chose", () => {
    assert.deepEqual(pinReleasedLastTurn({}, "u::a1", "u::a2"), {
      "u::a1": true,
    });
    assert.deepEqual(
      pinReleasedLastTurn({ "u::a1": false }, "u::a1", "u::a2"),
      { "u::a1": false },
    );
    assert.deepEqual(
      pinReleasedLastTurn({ "u::x": true }, "u::a1", "u::a2"),
      { "u::x": true, "u::a1": true },
    );
    assert.deepEqual(pinReleasedLastTurn({}, "u::a1", "u::a1"), {});
    assert.deepEqual(pinReleasedLastTurn({}, null, "u::a2"), {});
  });
});
