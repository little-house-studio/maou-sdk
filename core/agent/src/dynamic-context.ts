/**
 * 动态上下文编译 —— agent 层入口
 *
 * 从 @little-house-studio/prompt 层调用纯模板编译，
 * agent 层负责提供 PersonaStatusProvider 和 TerminalStatusProvider 实现。
 */

import { AgentRegistry } from "./agent/registry.js";
import { getTerminalStatusPanel, TASK_MANAGER } from "@little-house-studio/tools";
import type { Task } from "@little-house-studio/tools";
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
 * 格式化当前会话的 todo 清单，注入 before_user 区。
 *
 * 让 AI 每轮都能看到「还有哪些 todo 没做完 / 当前执行到哪一步」，
 * 并标注每个 todo 关联的归档块 ID（relatedBlockIds），
 * 便于 AI 在压缩后感知上下文归属。
 *
 * @returns 注入文本（含 <todo_plan> 标签）；无 todo 时返回空串
 */
function formatTodoPlan(tasks: Task[]): string {
  if (tasks.length === 0) return "";

  const completedIds = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
  const total = tasks.length;
  const done = completedIds.size;
  const inProgress = tasks.filter((t) => t.status === "in_progress");

  const lines: string[] = ["<todo_plan>", `当前 todo（已完成 ${done}/${total}）：`];
  for (const t of tasks) {
    let icon = t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[>]" : "[ ]";
    if (t.status === "pending" && t.deps.some((d) => !completedIds.has(d))) icon = "⏳";
    const deps = t.deps.length ? t.deps.join(",") : "—";
    const blocks = t.relatedBlockIds && t.relatedBlockIds.length > 0 ? t.relatedBlockIds.join(",") : "—";
    lines.push(`- ${icon} ${t.id} ${t.desc}  deps=[${deps}] blocks=[${blocks}]`);
  }
  if (inProgress.length === 1) {
    lines.push(`▶ 当前执行: ${inProgress[0].id} — ${inProgress[0].desc}`);
  } else if (inProgress.length > 1) {
    lines.push(`⚡ 并行: ${inProgress.map((t) => t.id).join(", ")}`);
  }
  if (done === total) {
    lines.push("🎉 全部完成，可回复用户收尾（无需再调 todo_finish）");
  } else {
    lines.push("完成当前项后调用 todo_finish(task_id, summary)，再继续下一项。");
  }
  lines.push("</todo_plan>");
  return lines.join("\n");
}

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
 * 编译动态注入内容：Agent 状态、终端状态面板、当前会话任务规划。
 *
 * agent 层负责组装 provider，模板编译委托给 prompt 层。
 *
 * @param sessionId - 会话 ID；传入时注入当前 todo 清单到 before_user 区，
 *                   让 AI 每轮感知「还有哪些 todo 没做完」并接管 loop 推进条件
 */
export function compileDynamicContext(maouRoot: string, agentName?: string, sessionId?: string): string {
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

  // Todo 状态改由 TodoOrchestrator 的靠后 user system_notice 注入（保护 prompt cache）。
  // 此处不再把 <todo_plan> 塞进动态 system/before_user 前缀。
  void sessionId;
  void formatTodoPlan;

  return parts.join("\n\n");
}

/** 导出纯格式化，供调试页/测试；runtime 主路径不用它注入 system */
export { formatTodoPlan };

// re-export prompt 层的纯模板函数（供外部直接使用）
export { compileDynamicContextTemplate, formatAgentStatus };
export type { PersonaStatusProvider, TerminalStatusProvider };
