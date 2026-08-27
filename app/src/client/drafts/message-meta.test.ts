/**
 * CLI message head / thinking line helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  durationStr,
  formatMessageHead,
  formatThinkingHead,
  formatRoundTip,
  formatLoopTip,
  formatUsageLine,
  roundTipRows,
  summarizeLoop,
  loopMark,
  shortId,
  timecode,
} from "./message-meta";
import type { DraftMessage } from "./types";
import { showcaseMessages } from "./fixtures";
import { createElement } from "react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextPanel } from "./panels/ContextPanel";
import { SHOWCASE_FLAGS } from "./fixtures";

describe("message-meta CLI helpers", () => {
  it("durationStr matches CLI edge cases", () => {
    assert.equal(durationStr(undefined), "");
    assert.equal(durationStr(null), "");
    assert.equal(durationStr(0), "0ms");
    assert.equal(durationStr(350), "350ms");
    assert.equal(durationStr(1000), "1s");
    assert.equal(durationStr(1200), "1.2s");
    assert.equal(durationStr(60_000), "1m00s");
    assert.equal(durationStr(150_000), "2m30s");
  });

  it("shortId / loopMark / timecode", () => {
    assert.equal(shortId("muabc123"), "abc123");
    assert.equal(shortId("n1-fc-a1"), "a1");
    assert.equal(loopMark(2), "↺2");
    assert.equal(loopMark(0), "");
    assert.equal(timecode(undefined), "");
    assert.match(timecode(Date.UTC(2026, 0, 1, 12, 5, 9)), /\d{2}:\d{2}:\d{2}/);
  });

  it("formatMessageHead builds user / assistant LIVE lines", () => {
    const user: DraftMessage = {
      id: "mu123456xx",
      role: "user",
      body: "hi",
      meta: {
        ts: Date.UTC(2026, 6, 31, 8, 0, 0),
        usageInput: 1200,
        authorLabel: "user",
      },
    };
    const uh = formatMessageHead(user);
    assert.equal(uh.who, "");
    assert.equal(uh.queued, false);
    assert.equal(uh.live, false);

    const asst: DraftMessage = {
      id: "ma999",
      role: "assistant",
      body: "ok",
      meta: {
        ts: Date.UTC(2026, 6, 31, 8, 1, 0),
        durationMs: 800,
        usageOutput: 48,
        round: 1,
        authorLabel: "agent:coding",
        streaming: true,
      },
    };
    const ah = formatMessageHead(asst);
    assert.equal(ah.who, "");
    assert.equal(ah.duration, "");
    assert.equal(ah.live, true);
  });

  it("formatUsageLine shows in + out + occupancy", () => {
    assert.equal(formatUsageLine(), "");
    assert.equal(formatUsageLine(0, 0), "");
    assert.equal(formatUsageLine(1200, 48), "↑1.2k · ↓48 · 占用 1.2k");
  });

  it("formatRoundTip lists round / start / duration / tools / tokens", () => {
    const tip = formatRoundTip({
      round: 2,
      startedAt: Date.UTC(2026, 6, 31, 8, 1, 0),
      durationMs: 800,
      toolCount: 3,
      outputTokens: 48,
    });
    assert.match(tip, /第 2 轮/);
    assert.match(tip, /开始 /);
    assert.match(tip, /用时 800ms/);
    assert.match(tip, /工具 3/);
    assert.match(tip, /输出 48 tok/);
    assert.match(tip, /占用 48 tok/);
  });

  it("roundTipRows is label/value pairs for InfoHover", () => {
    const rows = roundTipRows({
      round: 2,
      startedAt: Date.UTC(2026, 6, 31, 8, 1, 0),
      durationMs: 800,
      toolCount: 3,
      outputTokens: 48,
    });
    assert.deepEqual(
      rows.map((r) => r.label),
      ["轮次", "开始", "用时", "工具", "输出", "占用"],
    );
    assert.equal(rows[0]!.value, "2");
    assert.equal(rows[2]!.value, "800ms");
    assert.equal(rows[3]!.value, "3");
    assert.match(rows[4]!.value, /48 tok/);
  });

  it("summarizeLoop / formatLoopTip aggregate a finished user turn", () => {
    const sum = summarizeLoop([
      {
        assistant: {
          meta: {
            ts: Date.UTC(2026, 6, 31, 8, 1, 0),
            durationMs: 800,
            usageOutput: 48,
          },
        },
        internals: [{ role: "tool" }, { role: "tool" }],
      },
      {
        assistant: {
          meta: {
            ts: Date.UTC(2026, 6, 31, 8, 1, 1),
            durationMs: 400,
            usageOutput: 12,
          },
        },
        internals: [{ role: "thinking" }],
      },
    ]);
    assert.equal(sum.roundCount, 2);
    assert.equal(sum.toolCount, 2);
    assert.equal(sum.outputTokens, 60);
    assert.equal(sum.lastOutputTokens, 12);
    assert.equal(sum.occupancy, 12);
    assert.equal(sum.durationMs, 1400);
    const tip = formatLoopTip(sum);
    assert.match(tip, /共 2 轮/);
    assert.match(tip, /开始 /);
    assert.match(tip, /共工具 2/);
    assert.match(tip, /共输出 60 tok/);
    assert.match(tip, /占用 12 tok/);
    assert.doesNotMatch(tip, /用时/);
  });

  it("formatThinkingHead shows Thought · duration · tokens · fold", () => {
    const done = formatThinkingHead("abc", {
      durationMs: 350,
      collapsed: true,
      outputTokens: 41,
    });
    assert.match(done, /Thought/);
    assert.match(done, /350ms/);
    assert.match(done, /41 tok/);
    assert.match(done, /▶/);
    const live = formatThinkingHead("hi", {
      streaming: true,
      durationMs: 1200,
    });
    assert.match(live, /Thought\.\.\./);
    assert.match(live, /1\.2s|1200ms/);
  });

  it("showcase hydrate renders msg-head with duration or LIVE", () => {
    const msgs = showcaseMessages("t");
    const asst = msgs.find((m) => m.id.endsWith("fc-a1"));
    assert.ok(asst?.meta?.durationMs != null);
    const live = msgs.find((m) => m.id.endsWith("fc-a5"));
    assert.equal(live?.meta?.streaming, true);

    const html = renderToStaticMarkup(
      createElement(ContextPanel, {
        messages: msgs,
        agentBusy: true,
        pendingApproval: SHOWCASE_FLAGS.pendingApproval,
        hasActiveSession: true,
        draftInput: "",
        meta: {
          projectPath: "~",
          projectLabel: "x",
          agentName: "coding",
          sandboxMode: "ask",
          provider: "openai",
          model: "gpt-5",
        },
        statusHint: "x",
        usageLabel: "1k",
        agents: [],
        onApprovalDecision: () => {},
        onDraftInputChange: () => {},
        onSend: () => {},
        onRetryLast: () => {},
        onCopyTranscript: () => {},
        onAgentChange: () => {},
        onApprovalModeChange: () => {},
      }),
    );
    assert.match(html, /msg-head|wire-round-chip/);
    assert.match(html, /wire-round-chip/);
    assert.match(html, /第 \d+ 轮/);
    assert.match(html, /wire-think-head|\* think/);
  });
});
