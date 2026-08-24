/**
 * 监督工具：harness 内部工具，不进业务 builtins。
 * 只在监督 session 的 run 里动态注册。不再由 /goal 启动。
 */

import type { ToolRegistry } from "@little-house-studio/tools";
import { SupervisorTaskControlTool } from "./supervisor_task_control/tool.js";
import { SupervisorChatMainTool } from "./supervisor_chat_main/tool.js";

export const SUPERVISOR_HARNESS_TOOL_NAMES = [
  "supervisor_task_control",
  "supervisor_chat_main",
] as const;

export function registerSupervisorHarnessTools(registry: ToolRegistry): void {
  registry.register(new SupervisorTaskControlTool());
  registry.register(new SupervisorChatMainTool());
}
