// 默认 loop 判定（所有 agent 模板可复用）：
// 有 endsLoop 标注的工具之外仍有工具调用 → 继续；全部 endsLoop 或无工具 → 结束。
export default function shouldContinueLoop(ctx: {
  toolCalls: { name: string; endsLoop?: boolean }[];
}): boolean {
  if (ctx.toolCalls.length === 0) return false;
  return ctx.toolCalls.some((tc) => !tc.endsLoop);
}
