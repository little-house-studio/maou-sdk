/**
 * CLI message head / thinking line helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  durationStr,
  formatMessageHead,
  formatThinkingHead,
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
    assert.equal(timecode(undefined), "--:--:--");
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
    assert.match(uh.text, /user/);
    assert.match(uh.text, /↑1\.2k/);
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
    assert.match(ah.text, /↺1/);
    assert.match(ah.text, /agent:coding/);
    assert.equal(ah.live, true);
  });

  it("formatThinkingHead shows duration and fold mark", () => {
    const done = formatThinkingHead("abc", {
      durationMs: 350,
      collapsed: true,
    });
    assert.match(done, /\* think \(350ms\)/);
    assert.match(done, /3 字/);
    assert.match(done, /▶/);
    const live = formatThinkingHead("hi", { streaming: true, spinnerFrame: 0 });
    assert.match(live, /\* think/);
    assert.match(live, /字/);
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
    assert.match(html, /msg-head/);
    assert.match(html, /agent:coding|↺/);
    assert.match(html, /msg-head-live|LIVE/);
    assert.match(html, /wire-think-head|\* think/);
  });
});
