/**
 * 动态上下文编译 —— agent 层入口
 *
 * 从 @little-house-studio/prompt 层调用纯模板编译，
 * agent 层负责提供 PersonaStatusProvider 和 TerminalStatusProvider 实现。
 */

import { AgentRegistry } from "./agent/registry.js";
import { getTerminalStatusPanel } from "@little-house-studio/tools";
import {
  compileDynamicContextTemplate,
  formatAgentStatus,
} from "@little-house-studio/prompt";
import type {
  PersonaStatus,
  PersonaStatusProvider,
  TerminalStatusProvider,
} from "@little-house-studio/prompt";

/**
 * AgentRegistry 适配器 —— 实现 PersonaStatusProvider 接口
 */
class AgentRegistryStatusProvider implements PersonaStatusProvider {
  constructor(private registry: AgentRegistry) {}

  getStatus(): PersonaStatus[] {
    return this.registry.list().map((a) => ({
      name: a.name,
      role: a.role,
      status: a.status,
      team: a.team,
      description: a.description,
      parent: a.parent,
    }));
  }
}

/**
 * 终端引擎适配器 —— 实现 TerminalStatusProvider 接口
 */
class TerminalRegistryStatusProvider implements TerminalStatusProvider {
  agentStatusPanel(agentName: string): string | null {
    const panel = getTerminalStatusPanel(agentName);
    return panel || null;
  }
}

/**
 * 编译动态注入内容：Agent 状态、终端状态面板。
 *
 * agent 层负责组装 provider，模板编译委托给 prompt 层。
 */
export function compileDynamicContext(maouRoot: string, agentName?: string): string {
  const parts: string[] = [];

  // Agent 状态注入
  try {
    const registry = new AgentRegistry(maouRoot);
    const provider = new AgentRegistryStatusProvider(registry);
    const agentsText = formatAgentStatus(provider);
    if (agentsText) parts.push(agentsText);
  } catch {
    // 读取失败跳过
  }

  // 终端状态面板
  if (agentName) {
    const terminalProvider = new TerminalRegistryStatusProvider();
    const panel = terminalProvider.agentStatusPanel(agentName);
    if (panel) {
      parts.push(`<terminal_status>\n${panel}\n</terminal_status>`);
    }
  }

  return parts.join("\n\n");
}

// re-export prompt 层的纯模板函数（供外部直接使用）
export { compileDynamicContextTemplate, formatAgentStatus };
export type { PersonaStatusProvider, TerminalStatusProvider };
