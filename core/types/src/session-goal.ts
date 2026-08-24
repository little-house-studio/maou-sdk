/**
 * /goal：同会话一条合同。activation 只在进程里，不落盘。
 */

export const GOAL_CHANGE_VERSION = 1
export const DEFAULT_MAX_GOAL_ROUNDS = 256
export const BLOCKED_AFTER_CONSECUTIVE_ROUNDS = 3

export type GoalPhase = "active" | "paused" | "blocked" | "complete"
export type GoalActivation = "armed" | "disarmed"
export type GoalOperation =
  | "create"
  | "edit"
  | "pause"
  | "resume"
  | "complete"
  | "block"
  | "clear"

export type GoalErrorCode =
  | "GOAL_NOT_FOUND"
  | "GOAL_ALREADY_EXISTS"
  | "GOAL_STALE_REVISION"
  | "GOAL_INVALID_OBJECTIVE"
  | "GOAL_INVALID_MAX_ROUNDS"
  | "GOAL_INVALID_BLOCK_REASON"
  | "GOAL_INVALID_EDIT"
  | "GOAL_INVALID_TRANSITION"

export class GoalError extends Error {
  readonly code: GoalErrorCode
  constructor(message: string, code: GoalErrorCode) {
    super(message)
    this.name = "GoalError"
    this.code = code
  }
}

export interface GoalRef {
  readonly id: string
  readonly revision: number
}

export interface GoalBlockReason {
  readonly code: string
  readonly message: string
}

export interface GoalSnapshot extends GoalRef {
  readonly objective: string
  readonly phase: GoalPhase
  readonly blockedReason?: GoalBlockReason
  readonly maxGoalRounds: number
}

export interface GoalView extends GoalSnapshot {
  readonly roundsStarted: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly activation: GoalActivation
}

export interface GoalMessageSource {
  readonly kind: "goal"
  readonly goalId: string
  readonly revision: number
  readonly round: number
}

export type GoalToolAuthority =
  | { readonly kind: "direct-human" }
  | { readonly kind: "goal-round"; readonly source: GoalMessageSource }
  | { readonly kind: "none" }

export interface CreateGoalRequest {
  readonly objective: string
  readonly maxGoalRounds?: number
}

export interface EditGoalRequest {
  readonly objective?: string
  readonly maxGoalRounds?: number
}

export interface SessionGoalPort {
  get(): GoalView | undefined
  create(request: CreateGoalRequest): GoalView
  edit(ref: GoalRef, request: EditGoalRequest): GoalView
  pause(ref: GoalRef): GoalView
  resume(ref: GoalRef): GoalView
  complete(ref: GoalRef): GoalView
  block(ref: GoalRef, reason: GoalBlockReason): GoalView
  clear(ref: GoalRef): GoalRef
  disarm(): GoalView | undefined
  readonly isRootAgent: boolean
  readonly authority: GoalToolAuthority
}
