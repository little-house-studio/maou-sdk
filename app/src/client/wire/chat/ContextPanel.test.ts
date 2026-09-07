/**
 * Structure checks on shipped ContextPanel + groupThreadBlocks path.
 * Run via: tsx --test src/client/wire/chat/ContextPanel.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextPanel } from "./ContextPanel";
import {
  SAMPLE_APPROVAL,
  SAMPLE_SESSIONS,
  THREAD_MESSAGES,
} from "../test-thread";
import type { DraftMeta } from "../types";

const META: DraftMeta = {
  projectPath: "~/x",
  projectLabel: "x",
  agentName: "coding",
  sandboxMode: "ask",
  provider: "openai",
  model: "gpt-5",
};

function renderPanel(
  overrides: Partial<Parameters<typeof ContextPanel>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(ContextPanel, {
      messages: THREAD_MESSAGES,
      agentBusy: true,
      pendingApproval: SAMPLE_APPROVAL,
      hasActiveSession: true,
      draftInput: "",
      meta: META,
      statusHint: "test",
      usageLabel: "1k / 128k",
      agents: [],
      onApprovalDecision: () => {},
      onDraftInputChange: () => {},
      onSend: () => {},
      onRetryLast: () => {},
      onCopyTranscript: () => {},
      onAgentChange: () => {},
      onApprovalModeChange: () => {},
      ...overrides,
    }),
  );
}

describe("ContextPanel semantic structure", () => {
  it("renders busy + approval without top stream banner or TASKS chrome", () => {
    const html = renderPanel();
    assert.match(html, /has-busy/);
    assert.match(html, /has-approval/);
    // Top TASKS / 工作中 banner moved to bottom dock
    assert.doesNotMatch(html, /stream-banner/);
    assert.doesNotMatch(html, /工作中 · 等待审批/);
    assert.doesNotMatch(html, /wire-bg-tasks/);
    assert.doesNotMatch(html, /wire-context-tasks-chrome/);
    assert.match(html, /wire-approval-float|approval-banner/);
    assert.match(html, /wire-composer-card|composer-row/);
    // Approval UX: copy command + key hints + alertdialog
    assert.match(html, /alertdialog|待审批/);
    assert.match(html, /approval-copy|复制/);
    assert.match(html, /1–4|Esc 拒绝|approval-keys-hint/);
  });

  it("stop lives on composer when busy (not top stream banner)", () => {
    const html = renderPanel({
      agentBusy: true,
      pendingApproval: null,
      draftInput: "",
      onStop: () => {},
    });
    assert.doesNotMatch(html, /stream-banner|wire-stream-stop/);
    assert.match(html, /wire-composer-stop/);
  });

  it("does not show jump bar when not scrolled (CLI show_jump=false at tail)", () => {
    const html = renderPanel();
    // SSR has no scroll metrics → fromBottom 0 → no jump bar
    assert.doesNotMatch(html, /wire-jump-prev/);
    assert.doesNotMatch(html, /has-jump/);
  });

  it("marks user rows with data-msg-role for jump targeting", () => {
    const html = renderPanel();
    assert.match(html, /data-msg-role="user"/);
    assert.match(html, /data-msg-id=/);
    // Preview attr (not full body) for jump labels — avoids huge data-* payloads
    assert.match(html, /data-msg-preview=/);
    assert.doesNotMatch(html, /data-msg-body=/);
    assert.match(html, /data-ask-rail=/);
  });

  it("does not paint top TASKS chrome (tasks live in bottom dock)", () => {
    const html = renderPanel();
    assert.doesNotMatch(html, /has-tasks/);
    assert.doesNotMatch(html, /wire-bg-tasks/);
    assert.doesNotMatch(html, /wire-context-tasks-chrome/);
    assert.doesNotMatch(html, /wire-float-top/);
    assert.match(html, /wire-context-scroll/);
  });

  it("keeps composer textarea enabled while approval is pending", () => {
    const html = renderPanel({
      agentBusy: true,
      pendingApproval: SAMPLE_APPROVAL,
    });
    assert.match(html, /wire-composer-input/);
    // Must not hard-disable input when approval float is open
    assert.doesNotMatch(
      html,
      /wire-composer-input[^>]*\sdisabled(?:\s|=|>)/,
    );
    assert.match(html, /可先输入下一条/);
    assert.match(html, /等待审批/);
  });

  it("shows send (not stop) when busy but draft has text", () => {
    const html = renderPanel({
      agentBusy: true,
      pendingApproval: null,
      draftInput: "hello queue",
    });
    assert.match(html, /wire-composer-send/);
    assert.doesNotMatch(html, /wire-composer-stop/);
    assert.match(html, /运行中也可输入/);
  });

  it("shows stop placeholder when busy and draft is empty", () => {
    const html = renderPanel({
      agentBusy: true,
      pendingApproval: null,
      draftInput: "",
    });
    assert.match(html, /wire-composer-stop/);
    assert.match(html, /wire-composer-send/);
  });

  it("marks nested vs orphan reply turns distinctly", () => {
    const html = renderPanel();
    assert.match(html, /wire-reply-turn/);
    assert.match(html, /is-orphan/);
    assert.match(html, /内部步骤/);
    assert.match(html, /wire-reply-internals/);
    assert.match(html, /wire-tool-card|wire-internal-part role-tool/);
    assert.match(html, /wire-internal-part role-thinking/);
    assert.match(html, /wire-internal-part role-err/);
    assert.match(html, /wire-tool-title|wire-tool-name/);
    assert.match(html, /wire-tool-led/);
    assert.doesNotMatch(html, /msg-avatar-wrap|--:--:--|◈/);
  });

  it("renders user block and system telemetry classes", () => {
    const html = renderPanel();
    assert.match(html, /wire-msg user/);
    assert.match(html, /wire-msg system/);
    assert.match(html, /is-telemetry/);
  });

  it("empty session shows empty-hint copy", () => {
    const html = renderPanel({
      messages: [],
      agentBusy: false,
      pendingApproval: null,
      hasActiveSession: true,
    });
    assert.match(html, /empty-hint/);
    assert.match(html, /还没有消息/);
    assert.doesNotMatch(html, /stream-banner/);
  });

  it("session crumbs render with a parent/child tree", () => {
    const html = renderPanel({
      sessions: SAMPLE_SESSIONS,
      activeSessionId: SAMPLE_SESSIONS[1]!.id,
      onSelectSession: () => {},
    });
    assert.match(html, /has-busy/);
    assert.match(html, /has-approval/);
    assert.match(html, /is-orphan/);
    assert.match(html, /wire-tool-card/);
    assert.match(html, /wire-tool-name/);
    assert.match(html, /data-session-tree="crumbs"/);
    assert.match(html, /搭建对话工作台外壳/);
    assert.match(html, /调研 JS NPC 方法全貌/);
  });
});
