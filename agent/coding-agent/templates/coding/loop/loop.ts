// 默认 loop 判定（与 agent 层 templates/agent/loop/loop.ts 同源语义）
export default function shouldContinueLoop(ctx: {
  toolCalls: { name: string; endsLoop?: boolean }[];
}): boolean {
  if (ctx.toolCalls.length === 0) return false;
  return ctx.toolCalls.some((tc) => !tc.endsLoop);
}
