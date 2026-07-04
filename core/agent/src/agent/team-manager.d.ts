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
declare class AgentTeamManagerImpl {
    private members;
    list(scope?: string): TeamMember[];
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
    }): TeamMember;
    get(name: string): TeamMember | undefined;
    stop(name: string): boolean;
    sendMessage(to: string, from: string, content: string, mode: "message" | "interrupt" | "insert"): boolean;
    remove(name: string): boolean;
    clear(): void;
}
/** 全局单例 */
export declare const AgentTeamManager: AgentTeamManagerImpl;
export {};
//# sourceMappingURL=team-manager.d.ts.map