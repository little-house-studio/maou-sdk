/**
 * @little-house-studio/tools — 工具层
 * 工具基础类型从 @little-house-studio/types 引入（见 base.ts）。
 */

export { Tool, createToolResponse } from './base.js'
export type { JsonSchema, ToolDefinition, ToolContext, ToolResponse, ToolCall, ToolResult } from './base.js'

export { ToolRegistry } from './registry.js'
export { ToolExecutor } from './executor.js'
export { registerBuiltins } from './impls/index.js'

// 终端注册表（harness/agent 运行时需要）
export { TERMINAL_REGISTRY } from './terminal/registry.js'

// 技能管理（从 context 下放到此；context 包会从这里再导出）
export { SkillScanner, SkillContextManager } from './skill-context.js'
export type { SkillEntry, SkillChange, SkillContextResult } from './skill-context.js'
