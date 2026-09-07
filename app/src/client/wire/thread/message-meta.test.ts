/**
 * CLI message head / thinking line helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cacheHitRate,
  formatCacheCell,
  formatCacheRate,
  formatUserTurnTip,
  userTurnTipRows,
  durationStr,
  formatMessageHead,
  formatThinkingHead,
  formatRoundTip,
  formatLoopTip,
  formatUsageLine,
  roundTipRows,
  summarizeLoop,
  loopWallMs,
  loopMark,
  shortId,
  timecode,
} from "./message-meta";
import type { DraftMessage } from "../types";
import { createElement } from "react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextPanel } from "../chat/ContextPanel";
import { SAMPLE_APPROVAL, threadMessages } from "../test-thread";

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
    const fromSend = summarizeLoop(
      [
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
      ],
      { sentAt: Date.UTC(2026, 6, 31, 8, 0, 59, 500) },
    );
    assert.equal(fromSend.durationMs, 1900);
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

  it("thread sample renders msg-head with duration or LIVE", () => {
    const msgs = threadMessages("t");
    const asst = msgs.find((m) => m.id.endsWith("fc-a1"));
    assert.ok(asst?.meta?.durationMs != null);
    const live = msgs.find((m) => m.id.endsWith("fc-a5"));
    assert.equal(live?.meta?.streaming, true);

    const html = renderToStaticMarkup(
      createElement(ContextPanel, {
        messages: msgs,
        agentBusy: true,
        pendingApproval: SAMPLE_APPROVAL,
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

describe("cache rate + user-turn tip", () => {
  it("hit rate is cacheRead / promptTotal, and null when unreported", () => {
    assert.equal(cacheHitRate({ promptTotal: 1000, cacheRead: 600 }), 0.6);
    assert.equal(cacheHitRate({ promptTotal: 0, cacheRead: 0 }), null);
    // 模型不上报 cache 字段 → 不能写成 0%
    assert.equal(
      cacheHitRate({ promptTotal: 1000, cacheRead: 0, reported: false }),
      null,
    );
    // 中转层偶尔回报 read > prompt，夹到 100%
    assert.equal(cacheHitRate({ promptTotal: 100, cacheRead: 500 }), 1);
  });

  it("formats the rate and the cell", () => {
    assert.equal(formatCacheRate(null), "—");
    assert.equal(formatCacheRate(0.6), "60%");
    assert.equal(formatCacheRate(0.6234), "62.3%");
    assert.equal(formatCacheCell({ promptTotal: 10_000, cacheRead: 6234 }), "62.3% · 6.2k");
    assert.equal(formatCacheCell({ promptTotal: 1000, cacheRead: 0, reported: false }), "—");
  });

  it("roundTipRows carries the cache row once buckets are known", () => {
    const rows = roundTipRows({
      round: 2,
      inputTokens: 1000,
      outputTokens: 40,
      cacheRead: 600,
      cacheReported: true,
    });
    const cache = rows.find((r) => r.label === "缓存");
    assert.equal(cache?.value, "60% · 600");
    // 没有缓存口径时不生造一行
    assert.equal(
      roundTipRows({ round: 1, outputTokens: 5 }).some((r) => r.label === "缓存"),
      false,
    );
  });

  it("summarizeLoop sums input + cache across the rounds of one ask", () => {
    const sum = summarizeLoop([
      {
        assistant: {
          meta: {
            ts: 1000,
            durationMs: 400,
            usageInput: 1000,
            usageOutput: 40,
            cacheRead: 600,
            cacheReported: true,
          },
        },
        internals: [],
      },
      {
        assistant: {
          meta: {
            ts: 1400,
            durationMs: 600,
            usageInput: 1400,
            usageOutput: 20,
            cacheRead: 1200,
            cacheReported: true,
          },
        },
        internals: [{ role: "tool" }],
      },
    ]);
    assert.equal(sum.inputTokens, 2400);
    assert.equal(sum.outputTokens, 60);
    assert.equal(sum.cacheRead, 1800);
    assert.equal(sum.cacheReported, true);
    assert.equal(sum.durationMs, 1000);
    assert.equal(sum.toolCount, 1);
  });

  it("userTurnTipRows shows the whole ask: 工作时间 / 总输入输出 / 平均缓存率", () => {
    const rows = userTurnTipRows({
      ...summarizeLoop([
        {
          assistant: {
            meta: {
              ts: 1000,
              durationMs: 400,
              usageInput: 1000,
              usageOutput: 40,
              cacheRead: 600,
              cacheReported: true,
            },
          },
          internals: [{ role: "tool" }],
        },
      ]),
      ordinal: 3,
    });
    const get = (label: string) => rows.find((r) => r.label === label)?.value;
    assert.equal(get("提问"), "#3");
    assert.equal(get("工作时间"), "400ms");
    assert.equal(get("轮次"), "1");
    assert.equal(get("工具"), "1");
    assert.equal(get("总输入"), "1.0k tok");
    assert.equal(get("总输出"), "40 tok");
    assert.equal(get("平均缓存率"), "60% · 600");
    assert.equal(get("请求体"), "不可用");
    assert.match(formatUserTurnTip({ ...summarizeLoop([]), ordinal: 1 }), /提问 #1/);
  });

  it("a still-running ask reads 待落盘, never a fake 0%", () => {
    const rows = userTurnTipRows({
      ...summarizeLoop([]),
      ordinal: 1,
      live: true,
    });
    const get = (label: string) => rows.find((r) => r.label === label)?.value;
    assert.equal(get("工作时间"), "…");
    assert.equal(get("平均缓存率"), "—");
    assert.equal(get("请求体"), "待落盘");
  });
});

describe("loop wall clock: user send → loop end", () => {
  it("loopWallMs is end minus send, and refuses a reversed clock", () => {
    assert.equal(loopWallMs(1000, 2500), 1500);
    assert.equal(loopWallMs(1000, 1000), 0);
    assert.equal(loopWallMs(2500, 1000), undefined);
    assert.equal(loopWallMs(undefined, 2500), undefined);
  });

  it("synthesizes duration from user sentAt to last reply ts when rounds have no duration", () => {
    const sum = summarizeLoop(
      [
        { assistant: { meta: { ts: 1600 } }, internals: [] },
        { assistant: { meta: { ts: 2500 } }, internals: [] },
      ],
      { sentAt: 1000 },
    );
    assert.equal(sum.startedAt, 1000);
    assert.equal(sum.durationMs, 1500);
  });

  it("prefers a stamped loop duration over round timestamps", () => {
    const sum = summarizeLoop(
      [
        {
          assistant: { meta: { ts: 1200, durationMs: 400 } },
          internals: [],
        },
      ],
      { sentAt: 1000, durationMs: 900 },
    );
    assert.equal(sum.durationMs, 900);
  });

  it("interrupt uses endedAt when rounds have no duration", () => {
    const sum = summarizeLoop(
      [
        {
          assistant: { meta: { ts: 1100 } },
          internals: [{ role: "tool", meta: { ts: 1400 } }],
        },
      ],
      { sentAt: 1000, endedAt: 1800 },
    );
    assert.equal(sum.durationMs, 800);
  });

  it("does not sum round durations when there is no timestamp", () => {
    const sum = summarizeLoop([
      { assistant: { meta: { durationMs: 400 } }, internals: [] },
      { assistant: { meta: { durationMs: 600 } }, internals: [] },
    ]);
    assert.equal(sum.durationMs, undefined);
  });

  it("does not invent 0ms from a single assistant ts", () => {
    const sum = summarizeLoop([
      { assistant: { meta: { ts: 2000 } }, internals: [] },
    ]);
    assert.equal(sum.startedAt, 2000);
    assert.equal(sum.durationMs, undefined);
  });
});
