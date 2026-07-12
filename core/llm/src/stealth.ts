/**
 * Stealth Mode —— 工具名伪装
 *
 * 对标 pi-ai：把本项目的工具名映射成 Claude Code 的规范工具名（Bash/Read/Edit/…），
 * 让对 Claude Code 工具有特殊优化/识别的后端把请求当成"标准 agent"对待。
 *
 * 映射是可逆的：发送前 applySchemas 把工具名改成 Claude Code 名，收到工具调用后
 * restoreName 还原回本项目名以便查执行器。多个本项目工具映射到同一 Claude 名时，
 * 按出现顺序"先到先得"，其余保留原名（保证可逆，不产生歧义）。
 */

import type { ToolSchema } from "./tools/index.js";

/** 本项目工具名 → Claude Code 规范工具名（16 条） */
export const CLAUDE_CODE_TOOL_MAP: Record<string, string> = {
  use_terminal: "Bash",
  reader: "Read",
  write_file: "Write",
  edit_file: "Edit",
  glob: "Glob",
  grep: "Grep",
  find_code: "Grep",
  search_internet: "WebSearch",
  use_browser: "WebFetch",
  todo_manage: "TodoWrite",
  task_manage: "TodoWrite", // 兼容旧名
  notebook: "NotebookEdit",
  agent_message: "Task",
  agent_manage: "Task",
  project_manage: "Task",
  board: "Read",
  use_skill: "Task",
  todo_finish: "TodoWrite",
  task_finish: "TodoWrite", // 兼容旧名
};

/** 工具名映射器（有状态、可逆） */
export interface StealthMapper {
  /** 本项目名 → Claude Code 名（先到先得；冲突或无映射则保留原名） */
  forwardName(name: string): string;
  /** Claude Code 名 → 本项目名（还原；未知名原样返回） */
  restoreName(name: string): string;
  /** 批量改写工具 schema 的 name 字段 */
  applySchemas(schemas: ToolSchema[]): ToolSchema[];
}

/**
 * 创建一个工具名映射器。
 * @param map 自定义映射表（默认 CLAUDE_CODE_TOOL_MAP）
 */
export function createStealthMapper(map: Record<string, string> = CLAUDE_CODE_TOOL_MAP): StealthMapper {
  const forward = new Map<string, string>();
  const reverse = new Map<string, string>();
  const usedTargets = new Set<string>();

  function forwardName(name: string): string {
    const existing = forward.get(name);
    if (existing) return existing;
    const target = map[name];
    if (target && !usedTargets.has(target)) {
      usedTargets.add(target);
      forward.set(name, target);
      reverse.set(target, name);
      return target;
    }
    // 无映射或目标已被占用 → 保留原名
    forward.set(name, name);
    return name;
  }

  function restoreName(name: string): string {
    return reverse.get(name) ?? name;
  }

  function applySchemas(schemas: ToolSchema[]): ToolSchema[] {
    return schemas.map((s) => ({ ...s, name: forwardName(String(s.name)) }));
  }

  return { forwardName, restoreName, applySchemas };
}
