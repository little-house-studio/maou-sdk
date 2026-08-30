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

export type PlanReviewOutcome = "approve" | "reject" | "chat" | "hold";

export type PlanReviewSettled = {
  revision: number;
  outcome: PlanReviewOutcome;
  note?: string;
};

export type PlanReviewState = {
  show: boolean;
  /** true = submit_plan 正等着答案，走 /api/ask 回话 */
  blocking: boolean;
  /** 已选过：收成标题灰卡 */
  settled?: PlanReviewOutcome | null;
  note?: string;
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
 * 审核卡：有人在等 → 阻塞；已选过 → 收纳灰卡；否则顾问态。
 */
export function resolvePlanReview(
  view: SessionPlanView | null | undefined,
  ask: PlanReviewAsk | null | undefined,
  opts?: {
    dismissedRevision?: number | null;
    planLaunching?: boolean;
    settled?: PlanReviewSettled | null;
  },
): PlanReviewState {
  const md = ask?.planMarkdown ?? view?.markdown ?? "";
  const objective = ask?.title || view?.plan?.objective;
  const revision = ask?.planRevision ?? view?.plan?.revision;
  const base = { markdown: md, objective, revision };

  if (ask && ask.kind === "plan_review") {
    return {
      ...base,
      markdown: ask.planMarkdown ?? view?.markdown ?? "",
      show: true,
      blocking: true,
      settled: null,
    };
  }

  const rev = view?.plan?.revision;
  const status = view?.plan?.status ?? "";
  const local =
    opts?.settled && (rev == null || rev === opts.settled.revision)
      ? opts.settled
      : null;

  if (status === "approved" && (view?.markdown ?? "").trim().startsWith("#")) {
    return {
      ...base,
      markdown: view?.markdown ?? "",
      show: true,
      blocking: false,
      settled: local?.outcome ?? "approve",
      note: local?.note,
    };
  }

  if (local) {
    return {
      ...base,
      markdown: view?.markdown ?? "",
      show: true,
      blocking: false,
      settled: local.outcome,
      note: local.note,
    };
  }

  if (rev != null && opts?.dismissedRevision === rev) {
    return {
      ...base,
      markdown: view?.markdown ?? "",
      show: true,
      blocking: false,
      settled: "hold",
    };
  }

  const show =
    !opts?.planLaunching && isPlanReviewOpen(view, opts?.dismissedRevision);
  return {
    ...base,
    show,
    blocking: false,
    settled: null,
  };
}
