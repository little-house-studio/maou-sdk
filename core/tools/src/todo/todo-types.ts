/**
 * Todo 编排领域类型（P0）
 * 见 core/agent/docs/TODO_ORCHESTRATOR.md
 */

export type TodoNodeStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export type TodoPlanStatus = "active" | "archived" | "completed";

export type LaneKind = "root" | "fork";

export type LaneStatus =
  | "idle"
  | "working"
  | "waiting_deps"
  | "finishing"
  | "recycled"
  | "stuck";

export type TodoEventType =
  | "plan_submitted"
  | "plan_archived"
  | "plan_completed"
  | "node_assigned"
  | "node_finished"
  | "deps_unlocked"
  | "fork_created"
  | "fork_recycled"
  | "report_stored"
  | "report_injected"
  | "nudge"
  | "stuck"
  | "manage_rejected"
  | "api_retry"
  | "lane_chain_extended";

export interface TodoEvent {
  ts: string;
  type: TodoEventType;
  planId: string;
  rootSessionId: string;
  laneId?: string;
  nodeId?: string;
  payload?: Record<string, unknown>;
}

export interface TodoLane {
  laneId: string;
  kind: LaneKind;
  parentLaneId?: string;
  /** 逻辑 session：P0 分身尚未真 fork 时等于 rootSessionId；P1 为独立 session */
  sessionId: string;
  rootSessionId: string;
  planId: string;
  assignedNodeIds: string[];
  status: LaneStatus;
  currentNodeId?: string;
  /** 连续 nudge 次数 */
  nudgeCount: number;
}

export interface TodoPlanMeta {
  planId: string;
  rootSessionId: string;
  status: TodoPlanStatus;
  createdAt: string;
  archivedAt?: string;
}

/** 完成节点时的输入 */
export interface TodoFinishInput {
  taskId: string;
  status: "completed" | "failed";
  summary: string;
  report?: string;
  reason?: string;
  /** 调用方 session；P0 默认可与 root 相同 */
  actorSessionId?: string;
}

/** system_notice 模板 kind（注入由 runtime 消费事件后追加 user 消息） */
export type TodoNoticeKind =
  | "todo_plan_required"
  | "todo_plan_submitted"
  | "todo_fork"
  | "todo_unlock"
  | "todo_inject_report"
  | "todo_nudge"
  | "todo_lane_end"
  | "todo_plan_archived";

export interface TodoNotice {
  kind: TodoNoticeKind;
  planId: string;
  laneId?: string;
  nodeId?: string;
  /** 应注入到哪个 session 的对话末尾 */
  targetSessionId: string;
  body: string;
}
