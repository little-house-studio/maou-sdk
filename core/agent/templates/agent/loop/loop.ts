// loop 判定脚本。默认：有 endsLoop 标注的工具调用之外仍有工具调用就继续下一轮；
// 全部是 endsLoop（如 task_finish）则结束。返回 true=继续 loop，false=结束。
export default function shouldContinueLoop(ctx: { toolCalls: { name: string; endsLoop?: boolean }[] }): boolean {
  if (ctx.toolCalls.length === 0) return false
  return ctx.toolCalls.some(tc => !tc.endsLoop)
}
