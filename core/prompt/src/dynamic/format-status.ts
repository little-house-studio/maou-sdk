/**
 * 动态上下文模板编译
 *
 * 从 agent 层拆分：纯模板部分进 prompt 层，依赖 AgentRegistry 的部分留 agent 层。
 * agent 层实现 PersonaStatusProvider，注入给 prompt 层。
 */

import type { PersonaStatus, PersonaStatusProvider, TerminalStatusProvider } from "./types.js";

// ─── 模板编译 ──────────────────────────────────────────────────────────────

/**
 * 格式化角色状态列表（纯模板，不依赖 AgentRegistry）
 *
 * @param provider 角色状态提供者（由 agent 层注入）
 * @param excludeName 要排除的角色名（默认 "main"）
 * @returns 格式化的 agent_status 文本，空字符串表示无内容
 */
export function formatAgentStatus(
  provider: PersonaStatusProvider | null | undefined,
  excludeName: string = "main",
): string {
  if (!provider) return "";
  try {
    const agents = provider.getStatus();
    const lines = agents
      .filter((a) => a.name !== excludeName)
      .map((a) => `- ${a.name}: ${a.description || a.role || "无描述"}`);
    if (lines.length === 0) return "";
    return `<agent_status>\n${lines.join("\n")}\n</agent_status>`;
  } catch {
    return "";
  }
}

/**
 * 格式化终端状态面板（纯模板，不依赖 TERMINAL_REGISTRY）
 *
 * @param provider 终端状态提供者（由 agent 层注入）
 * @param agentName 角色名
 * @returns 格式化的 terminal_status 文本，空字符串表示无内容
 */
export function formatTerminalStatus(
  provider: TerminalStatusProvider | null | undefined,
  agentName: string,
): string {
  if (!provider || !agentName) return "";
  try {
    const panel = provider.agentStatusPanel(agentName);
    if (!panel) return "";
    return `<terminal_status>\n${panel}\n</terminal_status>`;
  } catch {
    return "";
  }
}

/**
 * 编译动态注入内容（纯模板，不依赖 AgentRegistry 和 TERMINAL_REGISTRY）
 *
 * @param personaProvider 角色状态提供者（可选，由 agent 层注入）
 * @param terminalProvider 终端状态提供者（可选，由 agent 层注入）
 * @param agentName 当前角色名（可选，用于终端状态面板）
 * @returns 动态上下文文本
 */
export function compileDynamicContextTemplate(
  personaProvider?: PersonaStatusProvider | null,
  terminalProvider?: TerminalStatusProvider | null,
  agentName?: string,
): string {
  const parts: string[] = [];

  // Agent 状态注入
  const agentsText = formatAgentStatus(personaProvider);
  if (agentsText) parts.push(agentsText);

  // 终端状态面板
  if (agentName) {
    const terminalText = formatTerminalStatus(terminalProvider, agentName);
    if (terminalText) parts.push(terminalText);
  }

  return parts.join("\n\n");
}
