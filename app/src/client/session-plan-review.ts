/**
 * 会话计划审核面：谁写 sessionPlan sidecar，谁读 App ChatPanel。
 */

export type SessionPlanSnap = {
  id?: string;
  status?: string;
  active?: boolean;
  objective?: string;
  planReady?: boolean;
  revision?: number;
};

export type SessionPlanView = {
  plan?: SessionPlanSnap;
  markdown: string;
  planFile?: string;
};

export function isPlanWriteTool(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === "submit_plan" || n === "write_file";
}

export function isPlanReviewOpen(
  view: SessionPlanView | null | undefined,
  dismissedRevision?: number | null,
): boolean {
  if (!view) return false;
  const md = view.markdown.trim();
  if (!md.startsWith("#")) return false;
  const status = view.plan?.status ?? "";
  if (status === "approved") return false;
  const rev = view.plan?.revision;
  if (rev != null && dismissedRevision === rev) return false;
  if (status === "review") return true;
  return view.plan?.active === true;
}

/** /api/ask 里的一条 plan_review 待答（只取审核卡要用的字段） */
export type PlanReviewAsk = {
  sessionId: string;
  kind: string;
  title?: string;
  planMarkdown?: string;
  planFile?: string;
  planRevision?: number;
};

export type PlanReviewState = {
  show: boolean;
  /** true = submit_plan 正等着答案，卡不可收起，走 /api/ask 回话 */
  blocking: boolean;
  markdown: string;
  objective?: string;
  revision?: number;
};

/** 当前焦点会话的 plan_review 待答；别的会话的卡不画在这儿。 */
export function pickPlanAsk(
  asks: readonly PlanReviewAsk[] | null | undefined,
  activeSessionId?: string | null,
): PlanReviewAsk | null {
  if (!asks?.length) return null;
  for (const a of asks) {
    if (a.kind !== "plan_review") continue;
    if (activeSessionId && a.sessionId !== activeSessionId) continue;
    return a;
  }
  return null;
}

/**
 * 审核卡状态：有人在等 → 阻塞态（优先，且不受 dismissed / planLaunching 影响，
 * 因为收起它会把工具永远悬在那儿）；没人等 → 老的顾问态。
 */
export function resolvePlanReview(
  view: SessionPlanView | null | undefined,
  ask: PlanReviewAsk | null | undefined,
  opts?: { dismissedRevision?: number | null; planLaunching?: boolean },
): PlanReviewState {
  if (ask && ask.kind === "plan_review") {
    return {
      show: true,
      blocking: true,
      // 正文优先用工具随请求带上来的那份（与模型提交的完全一致）
      markdown: ask.planMarkdown ?? view?.markdown ?? "",
      objective: ask.title || view?.plan?.objective,
      revision: ask.planRevision ?? view?.plan?.revision,
    };
  }
  const show =
    !opts?.planLaunching && isPlanReviewOpen(view, opts?.dismissedRevision);
  return {
    show,
    blocking: false,
    markdown: view?.markdown ?? "",
    objective: view?.plan?.objective,
    revision: view?.plan?.revision,
  };
}
