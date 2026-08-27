import React, { useEffect, useRef } from "react";
import type { DraftAgent, DraftMeta } from "../types";
import { ChromeMark } from "../icons/Marks";

export type ComposerBarProps = {
  draftInput: string;
  agentBusy: boolean;
  pendingApproval: boolean;
  meta: DraftMeta;
  statusHint: string;
  usageLabel: string;
  hasActiveSession: boolean;
  agents: DraftAgent[];
  canRetry: boolean;
  onDraftInputChange: (v: string) => void;
  onSend: () => void;
  onRetryLast: () => void;
  onCopyTranscript: () => void;
  onAgentChange: (agentId: string) => void;
  onApprovalModeChange: (mode: string) => void;
  onStop?: () => void;
};

const TEXTAREA_MIN_PX = 44;
const TEXTAREA_MAX_PX = 160;

/**
 * Composer card: textarea on top, control row below (8px rhythm).
 * Keeps agent / approval / usage / retry / copy / send|stop.
 */
export function ComposerBar({
  draftInput,
  agentBusy,
  pendingApproval,
  meta,
  statusHint,
  usageLabel,
  hasActiveSession,
  agents,
  canRetry,
  onDraftInputChange,
  onSend,
  onRetryLast,
  onCopyTranscript,
  onAgentChange,
  onApprovalModeChange,
  onStop,
}: ComposerBarProps) {
  // Approval is a float above composer — still allow draft typing / queue send.
  // Pure running with empty draft shows stop; with text, send stays available.
  const statusError =
    statusHint.includes("拒绝") ||
    statusHint.includes("错误") ||
    /error|denied/i.test(statusHint);
  const canSend = Boolean(draftInput.trim());
  const showStop = agentBusy && !pendingApproval && !canSend;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const liveAgents = agents.filter((a) => !a.stale);
  const placeholder = pendingApproval
    ? "可先输入下一条… 处理审批后发送"
    : agentBusy
      ? "运行中也可输入… Enter 发送（草稿本地回显）"
      : hasActiveSession
        ? "输入消息… Enter 发送，Shift+Enter 换行"
        : "输入消息将自动创建本地会话…";

  // Auto-grow textarea with the draft (capped) — multi-line UX without manual resize
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(
      TEXTAREA_MAX_PX,
      Math.max(TEXTAREA_MIN_PX, el.scrollHeight),
    );
    el.style.height = `${next}px`;
  }, [draftInput]);

  return (
    <div className="codex-composer-dock wire-composer-dock">
      <div className="composer codex-composer wire-composer">
        <div className="composer-row-wrap">
          <div
            className={`composer-row wire-composer-card${
              pendingApproval ? " has-pending-approval" : ""
            }${agentBusy ? " is-busy" : ""}`}
          >
            <textarea
              ref={taRef}
              className="wire-composer-input"
              rows={2}
              placeholder={placeholder}
              value={draftInput}
              onChange={(e) => onDraftInputChange(e.target.value)}
              onKeyDown={(e) => {
                // IME composition (e.g. 中文): don't send on Enter that confirms candidate
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (draftInput.trim()) onSend();
                }
              }}
            />

            <div className="composer-toolbar wire-composer-toolbar">
              <div className="composer-toolbar-left wire-composer-tools">
                <label className="chip-select wire-composer-chip">
                  <span className="visually-hidden">Agent</span>
                  <select
                    value={
                      agents.find((a) => a.name === meta.agentName)?.id ??
                      agents[0]?.id ??
                      ""
                    }
                    onChange={(e) => {
                      const a = agents.find((x) => x.id === e.target.value);
                      if (a) onAgentChange(a.id);
                    }}
                    title="当前 agent"
                    aria-label="Agent"
                  >
                    {liveAgents.length === 0 ? (
                      <option value="">无可用 agent</option>
                    ) : (
                      liveAgents.map((a) => {
                        const prefix =
                          a.group === "project"
                            ? a.projectName || "project"
                            : "系统";
                        const sub = `/${a.name}`;
                        return (
                          <option key={a.id} value={a.id}>
                            {prefix}
                            {a.parent ? ` › ${a.parent}${sub}` : sub}
                          </option>
                        );
                      })
                    )}
                  </select>
                </label>

                <label className="chip-select wire-composer-chip">
                  <span className="visually-hidden">Approval</span>
                  <select
                    value={meta.sandboxMode || "yolo"}
                    onChange={(e) => onApprovalModeChange(e.target.value)}
                    title="审批模式"
                    aria-label="Approval"
                  >
                    <option value="normal">normal</option>
                    <option value="auto">auto</option>
                    <option value="yolo">yolo</option>
                    <option value="ask">ask</option>
                  </select>
                </label>

                <span className="usage-chip wire-composer-usage" title="上下文用量（模拟）">
                  {usageLabel}
                </span>

                <span className="wire-composer-tool-sep" aria-hidden />

                <button
                  type="button"
                  className="composer-tool-btn"
                  disabled={!canRetry}
                  onClick={onRetryLast}
                  title="重试上一条"
                  aria-label="重试上一条"
                >
                  <ChromeMark kind="retry" size={14} decorative />
                </button>
                <button
                  type="button"
                  className="composer-tool-btn"
                  onClick={onCopyTranscript}
                  title="复制 transcript"
                  aria-label="复制 transcript"
                >
                  <ChromeMark kind="copy" size={14} decorative />
                </button>
              </div>

              <div className="composer-toolbar-right wire-composer-actions">
                <span
                  className={`composer-status${statusError ? " is-error" : ""}${
                    pendingApproval ? " is-approval" : ""
                  }`}
                  title={statusHint}
                >
                  {pendingApproval
                    ? "等待审批"
                    : agentBusy
                      ? "运行中"
                      : statusHint}
                </span>
                {showStop ? (
                  <button
                    type="button"
                    className="ghost wire-icon-btn wire-composer-stop"
                    disabled={!onStop}
                    onClick={() => onStop?.()}
                    title={
                      onStop
                        ? "停止本地 busy 态 · 输入文字可改为发送"
                        : "停止不可用 · 输入文字可改为发送"
                    }
                    aria-label="停止"
                  >
                    <ChromeMark kind="stop" size={14} decorative />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="send-btn wire-icon-btn wire-composer-send"
                    disabled={!canSend}
                    onClick={onSend}
                    aria-label="发送"
                    title={
                      pendingApproval
                        ? "发送（将清除当前审批并回显）"
                        : agentBusy
                          ? "发送并结束本地 busy 态"
                          : "发送 (Enter)"
                    }
                  >
                    <ChromeMark kind="send" size={15} decorative />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
