/**
 * 会话计划审核卡：线程里是带框的计划报告（标题 + 正文预览）；放大进悬浮窗。
 *
 * - **阻塞态**：确认执行 / 拒绝 / 输入补充意见（Enter 发送）。
 * - **顾问态**：开始计划 / 先不跑。
 * - **已选**：收成一行灰卡，按同意 / 拒绝 / 反馈 / 先不跑分样式；查看看全文。
 */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DraftMarkdown } from "../DraftMarkdown";
import { StatusMark } from "../icons/Marks";
import type { PlanReviewOutcome } from "../../session-plan-review";

const SETTLED_STATUS: Record<PlanReviewOutcome, string> = {
  approve: "已同意",
  reject: "已拒绝",
  chat: "已反馈",
  hold: "先不跑",
};

const SETTLED_HOLD: Record<PlanReviewOutcome, string> = {
  approve: "已确认执行",
  reject: "已打回",
  chat: "已发补充意见",
  hold: "暂不执行",
};

export function planReportHeading(markdown: string, objective?: string): string {
  const fromMd = markdown.trim().match(/^#\s+(.+)$/m);
  const heading = fromMd?.[1]?.trim();
  if (heading) return heading;
  const goal = objective?.trim();
  return goal || "未命名计划";
}

/** 阻塞态出口，与 AskUserPlanDecision 对齐 */
export type PlanDecision = "approve" | "reject" | "chat";

export type PlanReviewCardProps = {
  markdown: string;
  objective?: string;
  busy?: boolean;
  revision?: number;
  blocking?: boolean;
  settled?: PlanReviewOutcome | null;
  note?: string;
  onStart: () => void;
  onHold: () => void;
  onReject?: () => void;
  onChat?: (note?: string) => void;
};

export function PlanReviewCard({
  markdown,
  objective,
  busy,
  revision,
  blocking,
  settled,
  note: settledNote,
  onStart,
  onHold,
  onReject,
  onChat,
}: PlanReviewCardProps) {
  const [floatOpen, setFloatOpen] = useState(false);
  const [note, setNote] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!floatOpen) return;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [markdown, floatOpen]);

  useEffect(() => {
    if (!blocking || settled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        !!t &&
        (t.tagName === "TEXTAREA" ||
          t.tagName === "INPUT" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);
      if (e.key === "Escape") {
        if (floatOpen) {
          e.preventDefault();
          setFloatOpen(false);
        }
        return;
      }
      if (inField) return;
      if (e.key === "1") {
        e.preventDefault();
        onStart();
      } else if (e.key === "2") {
        e.preventDefault();
        onReject?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [blocking, settled, floatOpen, onStart, onReject]);

  const sendChat = () => {
    const text = note.trim();
    onChat?.(text || undefined);
    setNote("");
  };

  const heading = planReportHeading(markdown, objective);
  const showObjective =
    !settled && Boolean(objective?.trim()) && objective!.trim() !== heading;
  const statusLabel = settled
    ? SETTLED_STATUS[settled]
    : blocking
      ? "待审"
      : "待确认";
  const markKind = settled
    ? settled === "approve"
      ? "done"
      : settled === "reject"
        ? "error"
        : settled === "chat"
          ? "needs_reply"
          : "idle"
    : blocking
      ? "blocked"
      : "needs_reply";

  const renderBody = () =>
    markdown.trim() ? (
      <DraftMarkdown source={markdown} />
    ) : (
      <p className="plan-review-empty">这一版计划没有正文。</p>
    );

  const renderActions = () => (
    <div className="plan-review-actions">
      <button
        type="button"
        className="plan-review-start"
        disabled={busy}
        onClick={onStart}
      >
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
            拒绝
          </button>
          <form
            className="plan-review-note"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) sendChat();
            }}
          >
            <input
              type="text"
              className="plan-review-note-input"
              value={note}
              disabled={busy}
              placeholder="补充意见，Enter 发送"
              aria-label="补充意见"
              onChange={(e) => setNote(e.target.value)}
            />
          </form>
        </>
      ) : (
        <button type="button" className="ghost" onClick={onHold}>
          先不跑
        </button>
      )}
    </div>
  );

  const reportHead = (opts: { enlarge?: boolean; close?: boolean }) =>
    settled ? (
      <header className="plan-review-head">
        <div className="plan-review-kicker">
          <StatusMark kind={markKind} size={14} title={statusLabel} />
          <span className="plan-review-kicker-label">计划报告</span>
          <span className="plan-review-status">{statusLabel}</span>
          {revision != null && revision > 0 ? (
            <span className="plan-review-rev">v{revision}</span>
          ) : null}
          <h2 className="plan-review-heading" title={settledNote || SETTLED_HOLD[settled]}>
            {heading}
          </h2>
          <span className="plan-review-grow" aria-hidden />
          {opts.enlarge ? (
            <button
              type="button"
              className="plan-review-expand"
              onClick={() => setFloatOpen(true)}
              aria-expanded={floatOpen}
            >
              查看
            </button>
          ) : null}
          {opts.close ? (
            <button
              type="button"
              className="plan-review-close"
              onClick={() => setFloatOpen(false)}
              aria-label="收起"
            >
              收起
            </button>
          ) : null}
        </div>
      </header>
    ) : (
    <header className="plan-review-head">
      <div className="plan-review-kicker">
        <StatusMark
          kind={markKind}
          size={14}
          title={statusLabel}
        />
        <span className="plan-review-kicker-label">计划报告</span>
        <span className="plan-review-status">{statusLabel}</span>
        {revision != null && revision > 0 ? (
          <span className="plan-review-rev" title="第几版计划">
            v{revision}
          </span>
        ) : null}
        <span className="plan-review-grow" aria-hidden />
        {opts.enlarge ? (
          <button
            type="button"
            className="plan-review-expand"
            onClick={() => setFloatOpen(true)}
            aria-expanded={floatOpen}
          >
            放大
          </button>
        ) : null}
        {opts.close ? (
          <button
            type="button"
            className="plan-review-close"
            onClick={() => setFloatOpen(false)}
            aria-label="收起"
          >
            收起
          </button>
        ) : null}
      </div>
      <h2 className="plan-review-heading">{heading}</h2>
      {showObjective ? (
        <p className="plan-review-objective">{objective}</p>
      ) : null}
      <p className="plan-review-hold">
        {blocking
          ? "进度已暂停 · 必须审核后才能继续"
          : "需要你确认后才会执行"}
      </p>
    </header>
    );

  const float =
    floatOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="plan-review-float-root"
            role="dialog"
            aria-modal="true"
            aria-label={`计划报告：${heading}`}
            onClick={() => setFloatOpen(false)}
          >
            <div
              className={`plan-review-float${settled ? ` is-settled is-settled-${settled}` : ""}`}
              onClick={(e) => e.stopPropagation()}
            >
              {reportHead({ close: true })}
              <div className="plan-review-body" ref={bodyRef}>
                {renderBody()}
              </div>
              {settled ? null : renderActions()}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <article
      className={`plan-review-card is-report${
        blocking && !settled ? " is-blocking" : ""
      }${settled ? ` is-settled is-settled-${settled}` : ""}`}
      data-plan-blocking={blocking && !settled ? "true" : "false"}
      data-plan-settled={settled ?? ""}
      role={blocking && !settled ? "alertdialog" : "region"}
      aria-label={`计划报告：${heading}`}
    >
      {reportHead({ enlarge: true })}
      {settled ? null : <div className="plan-review-preview">{renderBody()}</div>}
      {settled ? null : renderActions()}
      {float}
    </article>
  );
}
