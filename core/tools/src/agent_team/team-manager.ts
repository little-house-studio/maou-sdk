/**
 * AgentTeamManager —— 进程内 Agent 团队管理单例。
 * 替代 agent_manage 工具的 HTTP 调用，直接在进程内管理 agent 状态。
 * P1-3（消息总线）和 P1-4（生命周期管理）会增强这个。
 */

export interface TeamMember {
  name: string;
  displayName: string;
  role: string;
  parent: string;
  scope: "system" | "project";
  status: "idle" | "busy" | "working" | "stopped" | "error";
  description?: string;
  personality?: string;
  team?: string;
  notes?: string;
  preset?: string;
  permission?: string;
  createdBy: string;
  createdAt: number;
  /** 消息队列（P1-3 消息总线会增强） */
  messages: TeamMessage[];
}

export interface TeamMessage {
  from: string;
  content: string;
  mode: "message" | "interrupt" | "insert";
  timestamp: number;
}

class AgentTeamManagerImpl {
  private members = new Map<string, TeamMember>();

  list(scope?: string): TeamMember[] {
    const all = [...this.members.values()];
    return scope ? all.filter(m => m.scope === scope) : all;
  }

  create(opts: {
    name: string;
    displayName?: string;
    role: string;
    parent: string;
    scope?: "system" | "project";
    description?: string;
    personality?: string;
    team?: string;
    notes?: string;
    preset?: string;
    permission?: string;
    createdBy: string;
  }): TeamMember {
    const member: TeamMember = {
      name: opts.name,
      displayName: opts.displayName ?? opts.name,
      role: opts.role,
      parent: opts.parent,
      scope: opts.scope ?? "project",
      status: "idle",
      description: opts.description,
      personality: opts.personality,
      team: opts.team,
      notes: opts.notes,
      preset: opts.preset,
      permission: opts.permission,
      createdBy: opts.createdBy,
      createdAt: Date.now(),
      messages: [],
    };
    this.members.set(opts.name, member);
    return member;
  }

  get(name: string): TeamMember | undefined {
    return this.members.get(name);
  }

  stop(name: string): boolean {
    const m = this.members.get(name);
    if (!m) return false;
    m.status = "stopped";
    return true;
  }

  sendMessage(to: string, from: string, content: string, mode: "message" | "interrupt" | "insert"): boolean {
    const m = this.members.get(to);
    if (!m) return false;
    m.messages.push({ from, content, mode, timestamp: Date.now() });
    return true;
  }

  remove(name: string): boolean {
    return this.members.delete(name);
  }

  clear(): void {
    this.members.clear();
  }
}

/** 全局单例 */
export const AgentTeamManager = new AgentTeamManagerImpl();
