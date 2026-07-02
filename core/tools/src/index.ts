/**
 * @little-house-studio/tools — 工具层
 * 工具基础类型从 @little-house-studio/types 引入（见 base.ts）。
 */

export { Tool, createToolResponse, toolDir } from './base.js'
export type { JsonSchema, ToolDefinition, ToolContext, ToolResponse, ToolCall, ToolResult } from './base.js'

export { ToolRegistry } from './registry.js'
export { ToolExecutor } from './executor.js'
export { registerBuiltins } from './impls/index.js'
export { createToolScaffold } from './scaffold.js'
export type { ScaffoldOptions } from './scaffold.js'
// 裁判评分工具（不进 registerBuiltins，裁判 agent 装配时单独注册）
export { GradeTool } from './eval/grade/tool.js'

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

// 终端审批策略（normal/auto/yolo + 黑白名单 + 小模型审核器注入 + 交互式审批器注入）
export {
  setTerminalPolicyRoot,
  setTerminalReviewer,
  setTerminalApprover,
  getMode as getTerminalMode,
  setMode as setTerminalMode,
  addToWhitelist as addTerminalWhitelist,
  addToBlacklist as addTerminalBlacklist,
  decideCommand as decideTerminalCommand,
} from './terminal/terminal-policy.js'
export type { TerminalMode, TerminalReviewer, TerminalApprover, PolicyAction, PolicyDecision } from './terminal/terminal-policy.js'

// 技能管理（从 context 下放到此；context 包会从这里再导出）
export { SkillScanner, SkillContextManager } from './skill-context.js'
export type { SkillEntry, SkillChange, SkillContextResult } from './skill-context.js'

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

// ── 任务规划管理器（TaskManager 单例 + TaskScheduler 依赖链推进）──
// 注：TaskManager 通过 setPersistCallback 解耦持久化（由调用方注入回调）
export { TASK_MANAGER, TaskManager, TaskScheduler } from './task/task_manage/tool.js'
export type { Task } from './task/task_manage/tool.js'

// ── 文件编辑历史 + 回退（diff 标记，支撑「被影响文件的回退机制」）──
export {
  record as recordFileEdit,
  undo as undoFileEdit,
  undoByToolCallId as undoFileEditByToolCallId,
  lastEdit as lastFileEdit,
  listEdits as listFileEdits,
  clearHistory as clearFileEditHistory,
  readBefore as readFileBefore,
} from './file/file-edit-history.js'
export type { FileEditRecord } from './file/file-edit-history.js'
