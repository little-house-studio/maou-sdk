/**
 * doc_extract 模式 —— 文档抽取任务禁止写代码/改文件。
 *
 * 对齐 Harness 优化计划 P1：
 *   读难文档时模型爱写脚本硬抠 → pre_tool_use 硬拦，逼它直接读。
 *
 * 启用方式（默认关，不影响日常 coding）：
 *   - 环境变量 MAOU_DOC_EXTRACT=1
 *   - createCodingAgent({ docExtractMode: true })
 *
 * Hook 逻辑在 SDK 进程内注册（不放进 skill 运行目录，模型改不到）。
 */

import { Hooks } from "@little-house-studio/agent";
import type { ToolCall } from "@little-house-studio/agent";

/** 默认拦截的写码 / 改文件工具 */
export const DOC_EXTRACT_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  "write_file",
  "edit_file",
  // 别名兼容
  "Write",
  "Edit",
  "write",
  "edit",
]);

/**
 * 文档抽取推荐白名单（可选：比 hook 更硬，直接不给模型看写工具）。
 * 使用方式：createCodingAgent({ toolWhitelist: DOC_EXTRACT_TOOL_WHITELIST })
 */
export const DOC_EXTRACT_TOOL_WHITELIST = [
  "reader",
  "glob",
  "grep",
  "find_code",
  "use_skill",
  "find_skill",
  "todo_manage",
  "todo_finish",
  "agent_message",
  "yield",
] as const;

const BLOCK_MSG = (toolName: string) =>
  `【doc_extract】本任务禁止写代码/改文件（已拦截 ${toolName}）。` +
  `请直接用 reader / grep / glob 阅读文档并抽取信息，不要写脚本、不要创建 .py/.js 再执行。` +
  `（关闭：unset MAOU_DOC_EXTRACT 或 docExtractMode:false）`;

export function isDocExtractEnabled(opts?: { docExtractMode?: boolean }): boolean {
  if (opts?.docExtractMode === true) return true;
  if (opts?.docExtractMode === false) return false;
  const v = (process.env.MAOU_DOC_EXTRACT ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * 是否应拦截该工具（纯函数，便于单测）。
 * What: block_write_tools
 * How: name_in_blocked_set
 */
export function shouldBlockDocExtractTool(toolName: string): boolean {
  const n = String(toolName ?? "").trim();
  if (!n) return false;
  if (DOC_EXTRACT_BLOCKED_TOOLS.has(n)) return true;
  // 宽松：*write* / *edit_file* 类
  const lower = n.toLowerCase();
  if (lower === "write_file" || lower === "edit_file") return true;
  return false;
}

/**
 * What: doc_extract_pre_tool
 * How: register_hooks_handler
 */
export function registerDocExtractHooks(hooks: Hooks): void {
  hooks.register("pre_tool_use", (kwargs: unknown) => {
    const bag = kwargs as { toolCall?: ToolCall | { name?: string } };
    const name = String(bag?.toolCall?.name ?? "");
    if (shouldBlockDocExtractTool(name)) {
      return BLOCK_MSG(name);
    }
    return true;
  });
}

/**
 * 组装 coding 用 Hooks（可叠加更多场景）。
 * What: create_coding_hooks
 * How: optional_doc_extract
 */
export function createCodingHooks(opts?: { docExtractMode?: boolean }): Hooks | undefined {
  if (!isDocExtractEnabled(opts)) return undefined;
  const hooks = new Hooks();
  registerDocExtractHooks(hooks);
  return hooks;
}
