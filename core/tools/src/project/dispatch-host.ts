/**
 * App / CLI 注入的跨项目派发口。
 * AgentHub.bind 后走目标项目 Coding 会话；未绑定则 project_agent 退回 detached fork。
 */

export type ProjectDispatchRequest = {
  projectPath: string;
  projectName: string;
  task: string;
  parentSessionId: string;
  parentAgent?: string;
};

export type ProjectDispatchReceipt = {
  sessionId: string;
  agent: string;
  switchId: string;
  project: string;
  status: "running";
  taskId: string;
};

export type ProjectDispatchFn = (
  req: ProjectDispatchRequest,
) => Promise<ProjectDispatchReceipt>;

let host: ProjectDispatchFn | null = null;

export function bindProjectDispatchHost(fn: ProjectDispatchFn | null): void {
  host = fn;
}

export function getProjectDispatchHost(): ProjectDispatchFn | null {
  return host;
}

export async function tryProjectDispatch(
  req: ProjectDispatchRequest,
): Promise<ProjectDispatchReceipt | null> {
  if (!host) return null;
  return host(req);
}

export function resetProjectDispatchHostForTest(): void {
  host = null;
}
