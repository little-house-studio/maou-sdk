/**
 * @little-house-studio/tools — 工具层
 * 工具基础类型从 @little-house-studio/types 引入（见 base.ts）。
 */

export { Tool, createToolResponse } from './base.js'
export type { JsonSchema, ToolDefinition, ToolContext, ToolResponse, ToolCall, ToolResult } from './base.js'

export { ToolRegistry } from './registry.js'
export { ToolExecutor } from './executor.js'
export { registerBuiltins } from './impls/index.js'

// 终端引擎（Rust 驱动，harness/agent 运行时需要）
export {
  initTerminalEngine,
  shutdownTerminalEngine,
  cleanupAgentTerminals,
  getTerminalStatusPanel,
  setTerminalFilter,
  setTerminalSandbox,
  setTerminalPersistPath,
  listTerminals,
  getTerminalLogs,
} from './terminal/use_terminal/tool.js'

// LSP 引擎生命周期（harness 退出时关语言服务器进程）
export {
  shutdownLspEngine,
  cleanupWorkspaceLsp,
} from './code/lsp/tool.js'

// 技能管理（从 context 下放到此；context 包会从这里再导出）
export { SkillScanner, SkillContextManager } from './skill-context.js'
export type { SkillEntry, SkillChange, SkillContextResult } from './skill-context.js'

// ── 文件即工具 API（对标 Vercel Eve） ──
export { defineTool, DefinedToolAdapter, approval } from './define-tool.js'
export type {
  DefineToolConfig,
  ApprovalPredicate,
  ApprovalDecision,
  ToModelOutput,
  ModelOutputValue,
} from './define-tool.js'

// ── 动态工具加载器 ──
export { DynamicToolLoader } from './dynamic-tool-loader.js'
export type { DynamicToolLoadResult } from './dynamic-tool-loader.js'

// ── 工具输出压缩器（摄入层 token 压缩，对标 RTK）──
export {
  compressOutput,
  compressTerminalOutput,
  compressTestOutput,
  dedupeConsecutive,
  truncateMiddle,
  stripNoise,
  extractSignatures,
  groupGrepByFile,
} from './compress/output-compressor.js'
export type { CompressOptions, CompressLevel } from './compress/output-compressor.js'
