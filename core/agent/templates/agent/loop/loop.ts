/**
 * 默认 loop 判定（所有 agent 模板可复用）。
 * 与 coding 模板 / runtime 内联逻辑同源。
 */
export default function shouldContinueLoop(ctx: {
  toolCalls: { name: string; endsLoop?: boolean }[];
  endsLoopFailed?: boolean;
  tasksIncomplete?: boolean;
  round?: number;
}): boolean {
  if (!ctx.toolCalls?.length) return false;
  if (ctx.endsLoopFailed) return true;
  if (ctx.toolCalls.some((tc) => !tc.endsLoop)) return true;
  if (ctx.tasksIncomplete) return true;
  return false;
}
