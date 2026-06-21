/**
 * 动态上下文编译 —— 编译 board 看板状态、待处理上下文、团队 Agent 状态。
 * 对应 Python: runtime._compile_before_user_dynamic()
 */

import { AgentRegistry } from "./agent/registry.js";
import { TERMINAL_REGISTRY } from "@little-house-studio/tools";

/**
 * 编译动态注入内容：Agent 状态、终端状态面板。
 */
export function compileDynamicContext(maouRoot: string, agentName?: string): string {
  const parts: string[] = [];

  // Agent 状态注入
  try {
    const registry = new AgentRegistry(maouRoot);
    const agentsText = formatAgentStatus(registry);
    if (agentsText) parts.push(agentsText);
  } catch {
    // 读取失败跳过
  }

  // 终端状态面板
  if (agentName) {
    const panel = TERMINAL_REGISTRY.agentStatusPanel(agentName);
    if (panel) {
      parts.push(`<terminal_status>\n${panel}\n</terminal_status>`);
    }
  }

  return parts.join("\n\n");
}

/**
 * 格式化团队 Agent 状态列表。
 */
export function formatAgentStatus(registry: AgentRegistry): string {
  try {
    const agents = registry.list();
    const lines = agents
      .filter((a) => a.name !== "main")
      .map((a) => `- ${a.name}: ${a.description || a.role || "无描述"}`);
    if (lines.length === 0) return "";
    return `<agent_status>\n${lines.join("\n")}\n</agent_status>`;
  } catch {
    return "";
  }
}