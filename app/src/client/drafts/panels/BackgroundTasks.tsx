import React, { useState } from "react";
import type { DraftBgTask } from "../types";
import { ChromeMark, TaskMark } from "../icons/Marks";

export type BackgroundTasksProps = {
  tasks: DraftBgTask[];
};

const STATUS_ZH: Record<DraftBgTask["status"], string> = {
  running: "进行中",
  done: "完成",
  queued: "排队",
};

/** 后台任务 — 上下文顶栏 in-flow 条；无任务时不渲染，避免空壳占位 */
export function BackgroundTasks({ tasks }: BackgroundTasksProps) {
  const [open, setOpen] = useState(false);
  const running = tasks.filter((t) => t.status === "running").length;
  const queued = tasks.filter((t) => t.status === "queued").length;
  const primary =
    tasks.find((t) => t.status === "running") ??
    tasks.find((t) => t.status === "queued") ??
    tasks[0] ??
    null;

  // Don't paint empty chrome over the thread
  if (tasks.length === 0) return null;

  const summary =
    running > 0
      ? `${running} 运行中${primary ? ` · ${primary.title}` : ""}`
      : queued > 0
        ? `${queued} 排队 · ${primary?.title ?? ""}`
        : primary
          ? `${STATUS_ZH[primary.status]} · ${primary.title}`
          : `${tasks.length} 项任务`;

  return (
    <section
      className={`wire-bg-tasks wire-bg-tasks-float${open ? " is-open" : " is-collapsed"}`}
      aria-label="后台任务"
    >
      <button
        type="button"
        className="wire-tasks-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? "收起任务列表" : "展开任务列表"}
      >
        <span
          className={`wire-tasks-chevron${open ? " open" : ""}`}
          aria-hidden
        >
          ▸
        </span>
        <ChromeMark kind="tasks" size={13} decorative />
        <span className="wire-tasks-title">Tasks</span>
        <span className="wire-tasks-count">{tasks.length}</span>
        {running > 0 ? (
          <span className="wire-tasks-live">{running} 运行中</span>
        ) : null}
        {/* 收纳态始终显示一条摘要 */}
        {!open ? (
          <span className="wire-tasks-strip" title={summary}>
            {primary && tasks.length > 0 ? (
              <TaskMark status={primary.status} size={12} />
            ) : null}
            <span className="wire-tasks-strip-text">{summary}</span>
          </span>
        ) : null}
        <span className="wire-tasks-toggle-hint" aria-hidden>
          {open ? "▾" : "▴"}
        </span>
      </button>
      {open && (
        <div className="wire-bg-scroll">
          {tasks.length === 0 ? (
            <div className="wire-empty sm">暂无后台任务</div>
          ) : (
            tasks.map((t) => (
              <div key={t.id} className={`wire-bg-item status-${t.status}`}>
                <TaskMark status={t.status} size={13} />
                <span className="wire-bg-title">{t.title}</span>
                <span className="wire-bg-agent">{t.agent}</span>
                <span className={`wire-bg-meta status-${t.status}`}>
                  {STATUS_ZH[t.status]}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
