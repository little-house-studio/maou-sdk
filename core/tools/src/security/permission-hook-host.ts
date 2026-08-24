/**
 * 终端审批钩子宿主桥 —— tools 不依赖 agent 包，由 Runtime 在构造时 bind。
 *
 * permission_request：即将问人或走审核器之前。
 *   allow → 跳过 UI/审核直接执行；deny → 当拒绝；ask → 沿用原审批。
 * permission_denied：策略硬拦或用户/审核/钩子拒绝之后。
 */

export type PermissionDecision = "allow" | "deny" | "ask";

export interface PermissionRequestPayload {
  command: string;
  agentName: string;
  cwd?: string;
  risk?: "low" | "high";
  summary?: string;
  reason?: string;
  ruleId?: string;
  gateAction?: string;
}

export interface PermissionHookResult {
  decision: PermissionDecision;
  reason?: string;
}

export type PermissionRequestFn = (
  payload: PermissionRequestPayload,
) => Promise<PermissionHookResult | void> | PermissionHookResult | void;

export type PermissionDeniedFn = (
  payload: PermissionRequestPayload,
) => void | Promise<void>;

export interface PermissionHookHost {
  request?: PermissionRequestFn;
  denied?: PermissionDeniedFn;
}

export type PermissionConsult =
  | { decision: "allow" }
  | { decision: "deny"; reason?: string }
  | { decision: "ask" };

let requestFn: PermissionRequestFn | null = null;
let deniedFn: PermissionDeniedFn | null = null;

export function bindPermissionHookHost(impl: PermissionHookHost | null): void {
  requestFn = impl?.request ?? null;
  deniedFn = impl?.denied ?? null;
}

export async function runPermissionRequest(
  payload: PermissionRequestPayload,
): Promise<PermissionHookResult> {
  if (!requestFn) return { decision: "ask" };
  try {
    const r = await requestFn(payload);
    if (!r || !r.decision) return { decision: "ask" };
    return r;
  } catch {
    return { decision: "ask" };
  }
}

export function notifyPermissionDenied(payload: PermissionRequestPayload): void {
  if (!deniedFn) return;
  try {
    void deniedFn(payload);
  } catch {
    /* 钩子失败不改变审批结果 */
  }
}

/** 询问钩子：allow / deny（已通知 denied）/ ask（走原 UI） */
export async function consultPermissionHook(
  payload: PermissionRequestPayload,
): Promise<PermissionConsult> {
  const r = await runPermissionRequest(payload);
  if (r.decision === "allow") return { decision: "allow" };
  if (r.decision === "deny") {
    notifyPermissionDenied({ ...payload, reason: r.reason ?? payload.reason });
    return { decision: "deny", reason: r.reason };
  }
  return { decision: "ask" };
}
