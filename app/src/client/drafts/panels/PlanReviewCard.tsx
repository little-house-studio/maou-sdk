/**
 * 会话计划审核卡。两种形态，正文与版式共用：
 *
 * - **阻塞态**（blocking）：`submit_plan` 正卡在宿主上等人选，这一轮不选就不往下走。
 *   给 确认执行 / 拒绝 / 去聊天里说 三选一，没有「先不跑」——那会把工具悬在那儿。
 * - **顾问态**：计划已落盘但没人在等（headless 提交、审阅超时后回落）。
 *   保持老行为：开始计划（发 /plan approve）/ 先不跑（本地收起）。
 */
import React, { useEffect, useRef } from "react";
import { DraftMarkdown } from "../DraftMarkdown";
import { StatusMark } from "../icons/Marks";

/** 阻塞态的三个出口，与 AskUserPlanDecision 对齐 */
export type PlanDecision = "approve" | "reject" | "chat";

export type PlanReviewCardProps = {
  markdown: string;
  objective?: string;
  busy?: boolean;
  /** 输入框上方只留动作，正文在线程里 */
  compact?: boolean;
  /** 第几版计划（每次 submit_plan +1） */
  revision?: number;
  /** 有人在等这个答案 —— 此时卡不可收起 */
  blocking?: boolean;
  onStart: () => void;
  onHold: () => void;
  /** 阻塞态：打回重做 */
  onReject?: () => void;
  /** 阻塞态：不批不否，回聊天里继续谈 */
  onChat?: () => void;
};

const KEY_MAP: Record<string, PlanDecision> = {
  "1": "approve",
  "2": "reject",
  "3": "chat",
};

export function PlanReviewCard({
  markdown,
  objective,
  busy,
  compact,
  revision,
  blocking,
  onStart,
  onHold,
  onReject,
  onChat,
}: PlanReviewCardProps) {
  const startRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (compact) return;
    startRef.current?.focus({ preventScroll: true });
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [markdown, compact]);

  // 阻塞态才吃键盘：顾问态是可以忽略的，不该抢全局按键。
  // compact 是同一张卡的第二个实例，只让完整那张监听，避免一次按键触发两回。
  useEffect(() => {
    if (!blocking || compact) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        !!t &&
        (t.tagName === "TEXTAREA" ||
          t.tagName === "INPUT" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);
      if (inField) return;
      // Esc 走「去聊天里说」：既不批准也不打回，是安全的退出
      const d = e.key === "Escape" ? "chat" : KEY_MAP[e.key];
      if (!d) return;
      e.preventDefault();
      if (d === "approve") onStart();
      else if (d === "reject") onReject?.();
      else onChat?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [blocking, compact, onStart, onReject, onChat]);

  return (
    <div
      className={`plan-review-card${compact ? " is-compact" : ""}${
        blocking ? " is-blocking" : ""
      }`}
      data-plan-review={compact ? "compact" : ""}
      data-plan-blocking={blocking ? "true" : "false"}
      role={blocking ? "alertdialog" : "region"}
      aria-label={blocking ? "计划待审" : "审阅计划"}
    >
      <div className="plan-review-head">
        <StatusMark
          kind={blocking ? "blocked" : "needs_reply"}
          size={14}
          title={blocking ? "计划待审" : "待审阅计划"}
        />
        <span className="plan-review-title">
          {blocking ? "计划待审" : "审阅计划"}
        </span>
        {objective ? (
          <span className="plan-review-objective">{objective}</span>
        ) : null}
        {revision != null && revision > 0 ? (
          <span className="plan-review-rev" title="第几版计划">
            v{revision}
          </span>
        ) : null}
        {blocking && !compact ? (
          <span className="plan-review-keys" title="键盘快捷键">
            1–3 · Esc 去聊天里说
          </span>
        ) : null}
      </div>
      {compact ? null : (
        <div className="plan-review-body" ref={bodyRef}>
          {markdown.trim() ? (
            <DraftMarkdown source={markdown} />
          ) : (
            <p className="plan-review-empty">这一版计划没有正文。</p>
          )}
        </div>
      )}
      <div className="plan-review-actions">
        <button
          ref={startRef}
          type="button"
          className="plan-review-start"
          disabled={busy}
          onClick={onStart}
        >
          {blocking && !compact ? <span className="plan-review-key">1</span> : null}
          {blocking ? "确认执行" : "开始计划"}
        </button>
        {blocking ? (
          <>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => onReject?.()}
            >
              {compact ? null : <span className="plan-review-key">2</span>}
              拒绝
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => onChat?.()}
            >
              {compact ? null : <span className="plan-review-key">3</span>}
              去聊天里说
            </button>
          </>
        ) : (
          <button type="button" className="ghost" onClick={onHold}>
            先不跑
          </button>
        )}
      </div>
    </div>
  );
}
