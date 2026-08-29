/**
 * ask_user 宿主桥：工具等待人答，UI / CLI 注入 request。
 */

export type AskUserKind = "questions" | "plan_review";

export type AskUserOption = {
  id: string;
  label: string;
  recommended?: boolean;
};

export type AskUserQuestion = {
  id: string;
  prompt: string;
  options?: AskUserOption[];
  allowCustom?: boolean;
  skippable?: boolean;
};

export type AskUserRequest = {
  sessionId: string;
  kind: AskUserKind;
  title?: string;
  questions?: AskUserQuestion[];
  planId?: string;
  /** plan_review：待审计划正文（markdown），审阅卡直接渲染它 */
  planMarkdown?: string;
  /** plan_review：计划文件绝对路径，供「在编辑器里打开」之类的入口 */
  planFile?: string;
  /** plan_review：第几版（每次 submit_plan +1） */
  planRevision?: number;
};

export type AskUserAnswers = {
  kind: "questions";
  answers: Array<{ questionId: string; value: string; skipped?: boolean }>;
};

export type AskUserPlanDecision = {
  kind: "plan_review";
  decision: "approve" | "reject" | "chat";
  note?: string;
};

export type AskUserResult = AskUserAnswers | AskUserPlanDecision;

export type AskUserHost = {
  request: (payload: AskUserRequest) => Promise<AskUserResult>;
};

let host: AskUserHost | null = null;

export function bindAskUserHost(next: AskUserHost | null): void {
  host = next;
}

export function getAskUserHost(): AskUserHost | null {
  return host;
}

export async function requestAskUser(payload: AskUserRequest): Promise<AskUserResult> {
  if (!host) {
    throw new Error("ask_user host is not bound");
  }
  return host.request(payload);
}
