/**
 * loop 继续判定（coding agent 模板）。
 *
 * 与 core/agent runtime 内联逻辑对齐：
 * - 有非 endsLoop 工具 → 继续
 * - 全是 endsLoop（如 todo_finish）且还有未完成 todo → 继续
 * - endsLoop 工具执行失败 → 继续（让模型看到错误）
 * - 否则结束
 */
export default function shouldContinueLoop(ctx: {
  toolCalls: { name: string; endsLoop?: boolean }[];
  endsLoopFailed?: boolean;
  tasksIncomplete?: boolean;
  round?: number;
}): boolean {
  if (!ctx.toolCalls?.length) return false;

  // 失败的收尾工具：不能退出，否则 todo_finish 参数错也会卡死
  if (ctx.endsLoopFailed) return true;

  const hasNonEndsLoop = ctx.toolCalls.some((tc) => !tc.endsLoop);
  if (hasNonEndsLoop) return true;

  // 全部 endsLoop（典型：仅 todo_finish）：若清单还有 pending/in_progress 则继续下一轮
  if (ctx.tasksIncomplete) return true;

  return false;
}
