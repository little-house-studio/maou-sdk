import React, { useState } from "react";
import { Fold } from "../motion";
import type { ComposerProps } from "./types";

export function GoalBar(props: Pick<ComposerProps, "goal" | "onGoalAction">) {
  const goal = props.goal;
  if (!goal) return null;
  return (
    <div className="composer-goal-bar" data-phase={goal.phase}>
      <span className="composer-goal-phase">{goal.phase}</span>
      <span className="composer-goal-text">{goal.objective}</span>
      {goal.phase === "active" ? (
        <button type="button" onClick={() => props.onGoalAction?.("pause")}>暂停</button>
      ) : goal.phase === "paused" || goal.phase === "blocked" ? (
        <button type="button" onClick={() => props.onGoalAction?.("resume")}>继续</button>
      ) : null}
      <button type="button" onClick={() => props.onGoalAction?.("edit")}>改摘要</button>
      <button type="button" onClick={() => props.onGoalAction?.("clear")}>清除</button>
    </div>
  );
}

export function JobLamp(props: {
  lamp?: { running: number; stopping: number; done: number; cancelled: number; failed: number; latest?: string };
}) {
  const lamp = props.lamp;
  if (!lamp) return null;
  const total = lamp.running + lamp.stopping + lamp.done + lamp.cancelled + lamp.failed;
  if (!total) return null;
  return (
    <span className={`session-job-lamp is-${lamp.latest ?? "idle"}`} title="后台任务">
      {lamp.running ? `${lamp.running} 跑` : ""}
      {lamp.stopping ? ` ${lamp.stopping} 停` : ""}
      {lamp.done ? ` ${lamp.done} 完` : ""}
      {lamp.failed ? ` ${lamp.failed} 败` : ""}
      {lamp.cancelled ? ` ${lamp.cancelled} 消` : ""}
    </span>
  );
}

export function FamilyTree(props: {
  crumbs: Array<{ id: string; title: string }>;
  children: Array<{ id: string; title: string; oneshot?: boolean; running?: boolean }>;
  parentOffline?: boolean;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!props.crumbs.length && !props.children.length) return null;
  return (
    <div className="session-family">
      <nav className="session-crumbs">
        {props.crumbs.map((c, i) => (
          <button key={c.id} type="button" onClick={() => props.onOpen(c.id)}>
            {i > 0 ? " / " : ""}
            {c.title}
          </button>
        ))}
      </nav>
      {props.children.length ? (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)}>
            下级 {props.children.length}
          </button>
          <Fold open={open}>
            <ul className="session-kids">
              {props.children.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => props.onOpen(c.id)}>
                    {c.title}
                    {c.oneshot ? " · 一次性 · 不能再后续" : " · 可继续"}
                    {c.running ? " · 忙" : ""}
                  </button>
                </li>
              ))}
            </ul>
          </Fold>
        </>
      ) : null}
    </div>
  );
}

export function AskUserPanel(props: {
  ask: {
    sessionId: string;
    kind: string;
    title?: string;
    questions?: Array<{
      id: string;
      prompt: string;
      options?: Array<{ id: string; label: string; recommended?: boolean }>;
      allowCustom?: boolean;
      skippable?: boolean;
    }>;
  } | null;
  onAnswer: (result: unknown) => void;
}) {
  const ask = props.ask;
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  if (!ask) return null;
  if (ask.kind === "plan_review") {
    return (
      <div className="ask-user-panel">
        <h3>{ask.title || "审阅计划"}</h3>
        <button type="button" onClick={() => props.onAnswer({ kind: "plan_review", decision: "approve" })}>批准</button>
        <button type="button" onClick={() => props.onAnswer({ kind: "plan_review", decision: "reject" })}>拒绝</button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const note = String(fd.get("note") ?? "").trim();
            props.onAnswer({ kind: "plan_review", decision: "chat", ...(note ? { note } : {}) });
          }}
        >
          <input name="note" type="text" placeholder="补充意见，Enter 发送" aria-label="补充意见" />
        </form>
      </div>
    );
  }
  const questions = ask.questions ?? [];
  const q = questions[idx];
  if (!q) return null;
  return (
    <div className="ask-user-panel">
      <h3>{ask.title || "问卷"}</h3>
      <p>{q.prompt}</p>
      {(q.options ?? []).map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => setAnswers((a) => ({ ...a, [q.id]: o.label }))}
        >
          {o.label}{o.recommended ? " · 推荐" : ""}
        </button>
      ))}
      {q.skippable ? (
        <button type="button" onClick={() => setAnswers((a) => ({ ...a, [q.id]: "" }))}>跳过</button>
      ) : null}
      <div>
        <button type="button" disabled={idx === 0} onClick={() => setIdx((i) => i - 1)}>上一题</button>
        {idx + 1 < questions.length ? (
          <button type="button" onClick={() => setIdx((i) => i + 1)}>下一题</button>
        ) : (
          <button
            type="button"
            onClick={() =>
              props.onAnswer({
                kind: "questions",
                answers: questions.map((item) => ({
                  questionId: item.id,
                  value: answers[item.id] ?? "",
                  skipped: !answers[item.id],
                })),
              })
            }
          >
            提交
          </button>
        )}
      </div>
    </div>
  );
}

export function MessageActions(props: {
  messageId: string;
  canBranch: boolean;
  onBranch: () => void;
  onFeedback: (vote: "up" | "down") => void;
}) {
  if (!props.canBranch) return null;
  return (
    <div className="message-actions">
      <button type="button" onClick={props.onBranch}>在新对话里分支</button>
      <button type="button" onClick={() => props.onFeedback("up")}>赞</button>
      <button type="button" onClick={() => props.onFeedback("down")}>踩</button>
    </div>
  );
}
