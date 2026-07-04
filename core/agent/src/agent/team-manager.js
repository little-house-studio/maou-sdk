/**
 * AgentTeamManager —— 进程内 Agent 团队管理单例。
 * 替代 agent_manage 工具的 HTTP 调用，直接在进程内管理 agent 状态。
 * P1-3（消息总线）和 P1-4（生命周期管理）会增强这个。
 */
class AgentTeamManagerImpl {
    members = new Map();
    list(scope) {
        const all = [...this.members.values()];
        return scope ? all.filter(m => m.scope === scope) : all;
    }
    create(opts) {
        const member = {
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
    get(name) {
        return this.members.get(name);
    }
    stop(name) {
        const m = this.members.get(name);
        if (!m)
            return false;
        m.status = "stopped";
        return true;
    }
    sendMessage(to, from, content, mode) {
        const m = this.members.get(to);
        if (!m)
            return false;
        m.messages.push({ from, content, mode, timestamp: Date.now() });
        return true;
    }
    remove(name) {
        return this.members.delete(name);
    }
    clear() {
        this.members.clear();
    }
}
/** 全局单例 */
export const AgentTeamManager = new AgentTeamManagerImpl();
//# sourceMappingURL=team-manager.js.map