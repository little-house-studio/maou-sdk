import type { DraftApproval } from "../types";
import { ChromeMark, StatusMark } from "../icons/Marks";

export type ApprovalBannerProps = {
  approval: DraftApproval;
  onDecision: (d: "once" | "always" | "deny" | "blacklist") => void;
};

const DECISION_LABEL = {
  once: "允许一次",
  always: "始终允许",
  deny: "拒绝",
  blacklist: "加入黑名单",
} as const;

/** 悬浮在输入框上方的审批卡片（叠在上下文上） */
export function ApprovalBanner({ approval, onDecision }: ApprovalBannerProps) {
  return (
    <div
      className={`approval-banner wire-approval-float${
        approval.risk === "high" ? " risk-high" : ""
      }`}
      role="region"
      aria-label="待审批"
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
        </div>
        <div className="approval-summary">{approval.summary}</div>
        <code className="approval-cmd">{approval.command}</code>
        <div className="approval-actions">
          <button type="button" onClick={() => onDecision("once")}>
            {DECISION_LABEL.once}
          </button>
          <button type="button" onClick={() => onDecision("always")}>
            {DECISION_LABEL.always}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => onDecision("deny")}
          >
            {DECISION_LABEL.deny}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => onDecision("blacklist")}
          >
            {DECISION_LABEL.blacklist}
          </button>
        </div>
      </div>
    </div>
  );
}
