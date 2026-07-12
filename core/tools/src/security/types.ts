/**
 * 操作安全 — 公共类型（三层模型）
 */

export type SecurityTier = "fatal" | "dangerous" | "safe";

export type SecurityGateAction =
  | "allow"
  | "deny_fatal"
  | "deny_dangerous_pending"
  | "ask"
  | "review";

export type SecuritySource =
  | "dcg"
  | "maou-hard"
  | "maou-safe"
  | "local-rules"
  | "policy"
  | "bypass";

export interface SecurityAssessment {
  tier: SecurityTier;
  severity?: string;
  ruleId?: string;
  packId?: string;
  reason: string;
  source: SecuritySource;
  /** 可选：DCG 原始结果（调试） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dcg?: any;
}

export interface SecurityGateResult {
  assessment: SecurityAssessment;
  action: SecurityGateAction;
  message?: string;
  payload?: Record<string, unknown>;
}
