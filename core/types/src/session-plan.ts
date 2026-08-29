/**
 * 会话计划模式：先调查并写成合同，用户确认后再执行。
 * 进行中只允许改会话计划文件。
 */

export type SessionPlanStatus = "idle" | "planning" | "review" | "approved"

export interface SessionPlanSnapshot {
  readonly id: string
  readonly objective: string
  readonly status: SessionPlanStatus
  readonly active: boolean
  readonly planReady: boolean
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface SessionPlanPort {
  get(): SessionPlanSnapshot | undefined
  isActive(): boolean
  writePlan(markdown: string): SessionPlanSnapshot
  readPlan(): string | undefined
  planFile(): string
  /** 用户批准：status → approved、退出 plan 模式（下一轮 agentMode 变 execute） */
  approve(): SessionPlanSnapshot | undefined
}

export function sessionPlanIsOpen(snap: SessionPlanSnapshot | undefined): boolean {
  return Boolean(snap?.active)
}
