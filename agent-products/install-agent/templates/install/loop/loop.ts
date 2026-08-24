export default function shouldContinueLoop(ctx: {
  toolCalls: { name: string; endsLoop?: boolean }[];
  endsLoopFailed?: boolean;
  tasksIncomplete?: boolean;
}): boolean {
  if (!ctx.toolCalls?.length) return false;
  if (ctx.endsLoopFailed) return true;
  if (ctx.toolCalls.some((call) => !call.endsLoop)) return true;
  return ctx.tasksIncomplete === true;
}
