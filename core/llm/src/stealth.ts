/**
 * Stealth Mode —— 工具名别名
 *
 * 发送时把本项目工具名换成常见 agent 名（Bash/Read/Edit/…），
 * 收到工具调用后再还原，以便查执行器。
 * 多个本项目工具映射到同一别名时，按出现顺序先到先得，其余保留原名。
 */

import type { ToolSchema } from "./tools/index.js";

/** 本项目工具名 → 常见 agent 工具名（16 条） */
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
  /** 本项目名 → 别名（先到先得；冲突或无映射则保留原名） */
  forwardName(name: string): string;
  /** 别名 → 本项目名（还原；未知名原样返回） */
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
