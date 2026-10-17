/** 顶栏活动 Agent 列表与芯片文案。 */

export type ActivityAgentItem = {
  id: string;
  switchId: string;
  agent: string;
  displayName: string;
  projectName?: string;
  sessionId?: string;
  status: "running" | "done" | "failed" | "idle";
  current?: boolean;
};

export function buildActivityMenu(opts: {
  home: { switchId: string; agent: string; displayName: string };
  currentSwitchId: string;
  activity: Array<{
    id: string;
    switchId: string;
    agent: string;
    displayName: string;
    projectName?: string;
    sessionId: string;
    status: "running" | "done" | "failed";
  }>;
}): ActivityAgentItem[] {
  const out: ActivityAgentItem[] = [
    {
      id: opts.home.switchId,
      switchId: opts.home.switchId,
      agent: opts.home.agent,
      displayName: opts.home.displayName,
      status: "idle",
      current: opts.currentSwitchId === opts.home.switchId,
    },
  ];
  for (const a of opts.activity) {
    if (a.switchId === opts.home.switchId) continue;
    out.push({
      id: a.id,
      switchId: a.switchId,
      agent: a.agent,
      displayName: a.displayName,
      projectName: a.projectName,
      sessionId: a.sessionId,
      status: a.status,
      current: a.switchId === opts.currentSwitchId,
    });
  }
  return out;
}

export function summarizeActivityChip(items: ActivityAgentItem[]): {
  label: string;
  live: boolean;
  running: number;
} {
  const running = items.filter((i) => i.status === "running");
  if (running.length === 1) {
    const a = running[0]!;
    return {
      label: `${a.displayName || a.agent} · 运行中`,
      live: true,
      running: 1,
    };
  }
  if (running.length > 1) {
    return { label: `${running.length} 个活动`, live: true, running: running.length };
  }
  const finished = items.filter((i) => i.status === "done" || i.status === "failed");
  const latest = finished[finished.length - 1];
  if (latest) {
    const tag = latest.status === "failed" ? "失败" : "已完成";
    return {
      label: `${latest.displayName || latest.agent} · ${tag}`,
      live: false,
      running: 0,
    };
  }
  const cur = items.find((i) => i.current) ?? items[0];
  return { label: cur?.displayName || "OPS", live: false, running: 0 };
}

export function activityRowLabel(item: ActivityAgentItem): string {
  const name = item.displayName || item.agent;
  const project = item.projectName ? ` · ${item.projectName}` : "";
  const status =
    item.status === "running"
      ? "运行中"
      : item.status === "failed"
        ? "失败"
        : item.status === "done"
          ? "已完成"
          : "当前";
  return `${name}${project} · ${status}`;
}
