import React, { useEffect, useId, useRef, useState } from "react";
import type { DraftApproval } from "../types";
import { ChromeMark, StatusMark } from "../icons/Marks";

export type ApprovalBannerProps = {
  approval: DraftApproval;
  onDecision: (d: "once" | "always" | "deny" | "blacklist") => void | Promise<void>;
};

const DECISION_LABEL = {
  once: "允许一次",
  always: "始终允许",
  deny: "拒绝",
  blacklist: "加入黑名单",
} as const;

type Decision = keyof typeof DECISION_LABEL;

const KEY_MAP: Record<string, Decision> = {
  "1": "once",
  "2": "always",
  "3": "deny",
  "4": "blacklist",
};

/** 悬浮在输入框上方的审批卡片（叠在上下文上） */
export function ApprovalBanner({ approval, onDecision }: ApprovalBannerProps) {
  const onceRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const uid = useId();
  const decidingRef = useRef(false);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState("");

  const decide = async (choice: Decision) => {
    if (decidingRef.current) return;
    decidingRef.current = true;
    setDeciding(true);
    setError("");
    try {
      await onDecision(choice);
    } catch (e) {
      setError(`审批失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      decidingRef.current = false;
      setDeciding(false);
    }
  };

  // Focus primary action when a new approval appears
  useEffect(() => {
    if (!rootRef.current?.closest("[hidden], [inert]")) {
      onceRef.current?.focus({ preventScroll: true });
    }
  }, [approval.id, approval.command]);

  // Number keys 1–4 when not typing in a field; Esc = deny
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      // Only the focused approval owns shortcuts; other cards must not answer too.
      if (!rootRef.current?.contains(e.target as Node)) return;
      if (rootRef.current.closest("[hidden], [inert]")) return;
      const t = e.target as HTMLElement | null;
      const inField =
        !!t &&
        (t.tagName === "TEXTAREA" ||
          t.tagName === "INPUT" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);
      if (inField) return;

      if (e.key === "Escape") {
        e.preventDefault();
        void decide("deny");
        return;
      }
      const d = KEY_MAP[e.key];
      if (!d) return;
      e.preventDefault();
      void decide(d);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDecision]);

  const copyCommand = async () => {
    try {
      await navigator.clipboard?.writeText(approval.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      ref={rootRef}
      className={`approval-banner wire-approval-float${
        approval.risk === "high" ? " risk-high" : ""
      }`}
      role="alertdialog"
      aria-modal="false"
      aria-label="待审批"
      aria-describedby={`${uid}-summary ${uid}-cmd`}
    >
      <div className="approval-card">
        <div className="approval-head">
          <StatusMark
            kind="blocked"
            size={14}
            title={approval.risk === "high" ? "高风险审批" : "待审批"}
          />
          <ChromeMark kind="terminal" size={13} decorative />
          <span className="approval-head-title">
            终端审批 · {approval.agentName}
          </span>
          {approval.risk === "high" ? (
            <span className="approval-risk-tag">高风险</span>
          ) : null}
          <span className="approval-keys-hint" title="键盘快捷键">
            1–4 · Esc 拒绝
          </span>
        </div>
        <div id={`${uid}-summary`} className="approval-summary">
          {approval.summary}
        </div>
        <div className="approval-cmd-row">
          <code id={`${uid}-cmd`} className="approval-cmd">
            {approval.command}
          </code>
          <button
            type="button"
            className="ghost approval-copy"
            onClick={copyCommand}
            title="复制命令"
            aria-label="复制命令"
          >
            {copied ? "已复制" : "复制"}
          </button>
        </div>
        <div className="approval-actions">
          <button
            ref={onceRef}
            type="button"
            disabled={deciding}
            onClick={() => void decide("once")}
            title="快捷键 1"
          >
            <span className="approval-key">1</span>
            {DECISION_LABEL.once}
          </button>
          <button
            type="button"
            disabled={deciding}
            onClick={() => void decide("always")}
            title="快捷键 2"
          >
            <span className="approval-key">2</span>
            {DECISION_LABEL.always}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={deciding}
            onClick={() => void decide("deny")}
            title="快捷键 3 / Esc"
          >
            <span className="approval-key">3</span>
            {DECISION_LABEL.deny}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={deciding}
            onClick={() => void decide("blacklist")}
            title="快捷键 4"
          >
            <span className="approval-key">4</span>
            {DECISION_LABEL.blacklist}
          </button>
        </div>
        {error ? <p role="alert">{error}</p> : null}
      </div>
    </div>
  );
}
