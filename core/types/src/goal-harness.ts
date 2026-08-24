/**
 * 宿主编排的长目标：规划合同、暗厢评审、验审、同回合续跑。
 * 状态落在会话 sidecar；进程重启时 Active 会收成 user_paused。
 */

export const GOAL_HARNESS_STALL_THRESHOLD = 2
export const GOAL_HARNESS_BLOCKED_STREAK = 3
export const GOAL_HARNESS_CLASSIFIER_MAX = 8
export const GOAL_HARNESS_STRATEGIST_EVERY = 2
export const GOAL_HARNESS_REVERIFY_AFTER = 8

export type GoalHarnessStatus =
  | "active"
  | "user_paused"
  | "backoff_paused"
  | "no_progress_paused"
  | "infra_paused"
  | "blocked"
  | "budget_limited"
  | "complete"

export type GoalHarnessPhase = "idle" | "planning" | "executing"

export type GoalHarnessPauseReason =
  | "user"
  | "backoff"
  | "no_progress"
  | "infra"
  | "blocked"

export interface GoalHarnessSnapshot {
  readonly id: string
  readonly objective: string
  readonly status: GoalHarnessStatus
  readonly phase: GoalHarnessPhase
  readonly tokenBudget?: number
  readonly tokensUsed: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly elapsedMs: number
  readonly workerRounds: number
  readonly verifyRounds: number
  readonly roundsSinceVerify: number
  readonly planReady: boolean
  readonly evaluatorBlockerKey?: string
  readonly evaluatorBlockedStreak: number
  readonly classifierAttempts: number
  readonly classifierMax: number
  readonly lastGaps?: string
  readonly lastGapFingerprint?: string
  readonly stallCount: number
  readonly consecutiveNotAchieved: number
  readonly lastStrategy?: string
  readonly pauseMessage?: string
}

export function goalHarnessIsOpen(status: GoalHarnessStatus): boolean {
  return status !== "complete" && status !== "budget_limited"
}

export function goalHarnessIsPaused(status: GoalHarnessStatus): boolean {
  return (
    status === "user_paused" ||
    status === "backoff_paused" ||
    status === "no_progress_paused" ||
    status === "infra_paused" ||
    status === "blocked"
  )
}

export function pauseReasonToStatus(reason: GoalHarnessPauseReason): GoalHarnessStatus {
  switch (reason) {
    case "user":
      return "user_paused"
    case "backoff":
      return "backoff_paused"
    case "no_progress":
      return "no_progress_paused"
    case "infra":
      return "infra_paused"
    case "blocked":
      return "blocked"
  }
}
