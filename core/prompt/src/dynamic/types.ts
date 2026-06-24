/**
 * 动态上下文模板类型
 *
 * agent 层实现 PersonaStatusProvider 接口，注入给 prompt 层。
 * prompt 层只负责模板编译，不依赖 AgentRegistry。
 */

// ─── 类型 ──────────────────────────────────────────────────────────────────

/**
 * 角色状态（由 agent 层提供）
 */
export interface PersonaStatus {
  /** 角色名 */
  name: string;
  /** 角色（如 assistant/coder/reviewer） */
  role: string;
  /** 当前状态（idle/running/error） */
  status: string;
  /** 团队（可选） */
  team?: string;
  /** 描述（可选） */
  description?: string;
  /** 父角色（可选，用于层级展示） */
  parent?: string;
}

/**
 * 角色状态提供者接口（由 agent 层实现）
 */
export interface PersonaStatusProvider {
  /** 获取所有角色状态 */
  getStatus(): PersonaStatus[];
}

/**
 * 终端状态提供者接口（由 tools 层实现，agent 层注入）
 */
export interface TerminalStatusProvider {
  /** 获取指定角色的终端状态面板 */
  agentStatusPanel(agentName: string): string | null;
}
