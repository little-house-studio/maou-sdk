/**
 * `/goal` 轮次收口协议：模型在回复末尾写
 * `<task_completion>N%</task_completion>` 或 `<task_completion>failed</task_completion>`。
 * 宿主用最后一枚完整标签判断是否继续；展示层剥掉该 XML。
 */

export const GOAL_DONE_PERCENT = 99.8;
export const GOAL_MAX_KICKBACKS = 20;

export type TaskCompletionReport =
  | { kind: "percent"; percent: number }
  | { kind: "failed" }
  | { kind: "none" };

export type GoalClosePending = {
  outcome: "complete" | "failed";
  reason: "reported" | "kickback";
};

const COMPLETE_TAG = /<task_completion\b[^>]*>([\s\S]*?)<\/task_completion>/gi;
const OPEN_TAG = /<task_completion\b/i;
const OPEN_NAME = "<task_completion>";
const CLOSE_NAME = "</task_completion>";

export function parseTaskCompletion(text: string): TaskCompletionReport {
  if (!text) return { kind: "none" };
  let last: string | undefined;
  COMPLETE_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COMPLETE_TAG.exec(text)) !== null) {
    last = match[1]!.trim();
  }
  if (last === undefined) return { kind: "none" };
  if (/^failed$/i.test(last)) return { kind: "failed" };
  const pct = last.match(/^(\d{1,3}(?:\.\d+)?)\s*%?$/);
  if (!pct) return { kind: "none" };
  const n = Number(pct[1]);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { kind: "none" };
  return { kind: "percent", percent: n };
}

/** 完整标签 + 流式半标签都不进入展示。 */
export function stripTaskCompletionMarkup(text: string): string {
  if (!text) return text;
  let out = text.replace(/<task_completion\b[^>]*>[\s\S]*?<\/task_completion>/gi, "");
  const open = out.search(OPEN_TAG);
  if (open >= 0) out = out.slice(0, open);
  const lt = out.lastIndexOf("<");
  if (lt >= 0) {
    const suffix = out.slice(lt).toLowerCase();
    if (OPEN_NAME.startsWith(suffix) || CLOSE_NAME.startsWith(suffix)) {
      out = out.slice(0, lt);
    }
  }
  return out;
}

export function isGoalTaskFinished(report: TaskCompletionReport): boolean {
  return report.kind === "failed" || (report.kind === "percent" && report.percent >= GOAL_DONE_PERCENT);
}

/**
 * 一轮 goal 工作结束后的宿主决策。
 * 完成/失败先进入收尾；打回超过 GOAL_MAX_KICKBACKS 次后下一轮强制收尾。
 */
export function decideGoalSettle(input: {
  pending?: GoalClosePending;
  report: TaskCompletionReport;
  kickbacks: number;
  countKickback: boolean;
}): {
  apply?: GoalClosePending;
  pending?: GoalClosePending;
  kickbacks: number;
} {
  if (input.pending) {
    return { apply: input.pending, kickbacks: 0 };
  }
  if (isGoalTaskFinished(input.report)) {
    return {
      pending: {
        outcome: input.report.kind === "failed" ? "failed" : "complete",
        reason: "reported",
      },
      kickbacks: input.kickbacks,
    };
  }
  const kickbacks = input.countKickback ? input.kickbacks + 1 : input.kickbacks;
  if (kickbacks > GOAL_MAX_KICKBACKS) {
    return { pending: { outcome: "complete", reason: "kickback" }, kickbacks };
  }
  return { kickbacks };
}

export function goalRoundPromptKind(
  pending: GoalClosePending | undefined,
): "continue" | "summary" | "forced-close" {
  if (!pending) return "continue";
  return pending.reason === "kickback" ? "forced-close" : "summary";
}
