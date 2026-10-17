/** 后台 Coding 完成时写回父会话的摘要。 */

export function formatProjectDispatchResult(input: {
  ok: boolean;
  projectName: string;
  projectPath?: string;
  sessionId: string;
  output?: string;
  error?: string;
}): string {
  const status = input.ok ? "成功" : "失败";
  const lines = [
    `Coding Agent「${input.projectName}」后台任务${status}。`,
    `sessionId: ${input.sessionId}`,
  ];
  const project = input.projectPath?.trim();
  if (project) lines.push(`project: ${project}`);
  const body = (input.output || input.error || "(无输出)").trim().slice(0, 4000);
  lines.push("── 摘要 ──", body);
  return lines.join("\n");
}
