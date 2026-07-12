/**
 * Todo system_notice 格式化（靠后 user 消息，保护 prompt cache）
 */

import type { TodoNotice } from "./todo-types.js";

/** 将 notice 格式化为追加在对话末尾的 user 文本 */
export function formatTodoNoticeMessage(notice: TodoNotice): string {
  const attrs = [
    `kind="${notice.kind}"`,
    `plan_id="${notice.planId}"`,
    notice.laneId ? `lane_id="${notice.laneId}"` : "",
    notice.nodeId ? `node_id="${notice.nodeId}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<system_notice ${attrs}>\n${notice.body}\n</system_notice>`;
}

/**
 * 从用户输入识别 /todo：返回清洗后的正文 + 是否需要 plan_required notice。
 * `/todo` 单独出现或夹在消息中均可；不拦截 AI，仅追加要求规划的通知。
 */
export function preprocessTodoSlash(userMessage: string): {
  message: string;
  requirePlan: boolean;
} {
  const raw = userMessage ?? "";
  // 行首 /todo 或独立 token
  const re = /(^|\s)\/todo(?=\s|$)/i;
  if (!re.test(raw)) {
    return { message: raw, requirePlan: false };
  }
  const cleaned = raw
    .replace(/(^|\s)\/todo(?=\s|$)/gi, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    message: cleaned.length > 0 ? cleaned : "请根据上下文制定并执行详细 todo 计划。",
    requirePlan: true,
  };
}

export function buildPlanRequiredNotice(planIdPlaceholder = "pending"): TodoNotice {
  return {
    kind: "todo_plan_required",
    planId: planIdPlaceholder,
    targetSessionId: "", // runtime 填
    body: [
      "【/todo】本次要求：",
      "1. 先用 todo_manage action=create 提交带 deps 的详细计划表（顺序/并行/依赖）。",
      "2. 提交后由系统自动调度与分身分配，不要手搓并行 fork 工具。",
      "3. 每完成一个节点调用一次 todo_finish(task_id, status, summary, report?)。",
      "4. 一次 finish 只代表当前这一个节点；failed 不自动级联下游。",
    ].join("\n"),
  };
}
