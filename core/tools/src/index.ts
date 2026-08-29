/**
 * @little-house-studio/tools — 工具层
 * 工具基础类型从 @little-house-studio/types 引入（见 base.ts）。
 */

export { Tool, createToolResponse, toolDir, resolveToolRuntimePorts, toolFail } from './base.js'
export type {
  JsonSchema,
  ToolDefinition,
  ToolContext,
  ToolResponse,
  ToolCall,
  ToolResult,
  ToolRuntimePorts,
  ToolErrorCategory,
  ToolErrorInfo,
} from './base.js'

// 统一工具失败类型表（与 LLM errors 对称）
export {
  TOOL_ERROR_CATEGORIES,
  TOOL_ERROR_CATEGORY_EXAMPLES,
  TOOL_ERROR_PREFIX,
  makeToolError,
  toolFailFromThrown,
  classifyToolErrorMessage,
  classifyToolThrown,
  ensureToolError,
  isRetryableToolCategory,
  formatToolErrorForStream,
  parseToolErrorFromMessage,
} from './errors.js'
export type { ToolErrorExtras } from './errors.js'

// 路径沙箱（subagent project / task scoped）
export {
  resolveToolPath,
  safePath,
  pathGuardFromPolicy,
  pipelineIsolateGuard,
  machineOpenPathGuard,
  effectiveDenySegments,
  pathHitsDenySegments,
  parseEnvDenySegments,
  DEFAULT_PIPELINE_DENY_SEGMENTS,
} from './path-guard.js'
export type {
  PathGuard,
  PathGuardMode,
  ResolvedToolPath,
} from './path-guard.js'

export { ToolRegistry } from './registry.js'
export { ToolExecutor } from './executor.js'
export { registerBuiltins } from './impls/index.js'
export { createToolScaffold } from './scaffold.js'
export type { ScaffoldOptions } from './scaffold.js'
// 裁判评分工具（不进 registerBuiltins，裁判 agent 装配时单独注册）
export { GradeTool } from './eval/grade/tool.js'

// 终端引擎（full Rust / mini Node；harness/agent 运行时需要）
export {
  initTerminalEngine,
  shutdownTerminalEngine,
  cleanupAgentTerminals,
  getTerminalStatusPanel,
  listTerminals,
  getTerminalLogs,
} from './terminal/use_terminal/tool.js'
export {
  resolveTerminalBackend,
  resolveConfiguredMode,
  getActiveBackend,
  getTerminalResolution,
  setAgentTerminalMode,
  resolveInteractiveShell,
  resolveTerminalPersistPath,
  rebindTerminalPersist,
} from './terminal/resolve-backend.js'
export { isHumanTerminal } from './terminal/backend.js'
export {
  applyOutputLimit,
  inferPromptWaitState,
  peekOverflow,
  peekWaitState,
  rememberOverflow,
  rememberWaitState,
} from './terminal/overflow.js'
export type { TerminalWaitState } from './terminal/overflow.js'
export {
  TOOL_OUTPUT_SPILL_LIMIT,
  applySpillGuard,
  isSpillExempt,
} from './spill-guard.js'
export type {
  TerminalBackend,
  TerminalKind,
  TerminalResolution,
  TerminalInfo,
  RunResult,
  TerminalStreamEvent,
} from './terminal/backend.js'

// LSP 引擎生命周期（harness 退出时关语言服务器进程）
export {
  shutdownLspEngine,
  cleanupWorkspaceLsp,
} from './lsp/lsp/tool.js'

// 操作安全（三层门禁 + DCG + 审批策略）— 统一从 security/ 导出
export {
  setTerminalPolicyRoot,
  setTerminalReviewer,
  getTerminalReviewer,
  setTerminalApprover,
  getMode as getTerminalMode,
  setMode as setTerminalMode,
  addToWhitelist as addTerminalWhitelist,
  addToBlacklist as addTerminalBlacklist,
  decideCommand as decideTerminalCommand,
  normalizeCommand as normalizeTerminalCommand,
  commandPrefix as terminalCommandPrefix,
  gateTerminalCommand,
  assessCommandSecurity,
  evaluateWithDcg,
  checkLocalSecurityRules,
  checkMaouHardDeny,
  parseHardCheckCommand,
  runHardCheck,
  bindPermissionHookHost,
  consultPermissionHook,
  notifyPermissionDenied,
} from './security/index.js'
export {
  DEFAULT_PERMISSION_PRESET,
  PERMISSION_PRESETS,
  resolvePermissionPreset,
  isPermissionPresetId,
  listPermissionPresets,
} from './security/permission-preset.js'
export type { PermissionPreset, PermissionPresetId } from './security/permission-preset.js'
export type { HardCheckResult, HardCheckOptions } from './security/index.js'
export type {
  PermissionDecision,
  PermissionRequestPayload,
  PermissionHookResult,
  PermissionHookHost,
  PermissionConsult,
} from './security/index.js'
export {
  bindTerminalHookHost,
  gateTerminal,
  emitTerminal,
} from './terminal/terminal-hook-host.js'
export type {
  TerminalGateName,
  TerminalEmitName,
  TerminalGateResult,
  TerminalHookHost,
} from './terminal/terminal-hook-host.js'

export type {
  TerminalMode,
  TerminalReviewer,
  TerminalApprover,
  PolicyAction,
  PolicyDecision,
  SecurityTier,
  SecurityAssessment,
  SecurityGateResult,
} from './security/index.js'

// 技能管理（从 context 下放到此；context 包会从这里再导出）
export {
  SkillScanner,
  SkillContextManager,
  setDefaultSkillScanOptions,
  getDefaultSkillScanOptions,
  resolveSkillScanOptions,
  getSystemNpmSkillDirs,
  listSkillScanRoots,
  skillNameFromPath,
  skillVisibleToModel,
  skillMissingRequiredTools,
  clipSkillDescription,
  EMPTY_SKILL_CATALOG,
  EMPTY_SKILL_CATALOG_LINE,
  SKILL_DESCRIPTION_MAX_CHARS,
} from './skill-context.js'
export type {
  SkillEntry,
  SkillChange,
  SkillContextResult,
  SkillScanOptions,
  SkillScanRoot,
  SkillSource,
} from './skill-context.js'

export {
  toMaouToolName,
  toPiToolName,
  isSameTool,
  PI_TO_MAOU_TOOL,
  MAOU_TO_PI_TOOL,
} from './compat/tool-names.js'

// ── 动态工具加载器 ──
export { DynamicToolLoader } from './dynamic-tool-loader.js'
export type { DynamicToolLoadResult } from './dynamic-tool-loader.js'

// ── 工具输出压缩器（摄入层 token 压缩）──
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

// ── 会话级 Todo 清单 + 编排宿主桥 ──
// 编排实现（TodoOrchestrator 类）在 @little-house-studio/agent；
// tools 仅导出工具 + 宿主桥（bind / TODO_ORCHESTRATOR 代理）。
// TaskManager 通过 setPersistCallback 解耦持久化；调度见 core/agent/docs/TODO_ORCHESTRATOR.md
export { TASK_MANAGER, TODO_MANAGER, TaskManager, TaskScheduler, TodoManageTool, TaskManageTool } from './todo/task_manage/tool.js'
export type { Task, TodoItem } from './todo/task_manage/tool.js'
export { TodoFinishTool, TaskFinishTool } from './todo/task_finish/tool.js'
export {
  TODO_ORCHESTRATOR,
  bindTodoOrchestratorHost,
  getTodoOrchestrator,
  setTodoOrchestratorFallbackFactory,
} from './todo/todo-orchestrator-host.js'
export type { TodoForkRunner, TodoOrchestratorHost } from './todo/todo-orchestrator-host.js'
export type {
  TodoEvent,
  TodoEventType,
  TodoLane,
  TodoNotice,
  TodoNoticeKind,
  TodoPlanMeta,
  TodoFinishInput,
  TodoNodeStatus,
  LaneKind,
  LaneStatus,
} from './todo/todo-types.js'
export {
  formatTodoNoticeMessage,
  preprocessTodoSlash,
  buildPlanRequiredNotice,
} from './todo/todo-notice.js'

// ── 本 session 已编辑路径（给 write/edit 的先读后写豁免）──
export {
  record as recordFileEdit,
  wasEditedInSession,
  clearHistory as clearFileEditHistory,
} from './file/file-edit-history.js'

// ── 子 Agent 委托工具（文件即子 Agent 约定）──
// 不进 registerBuiltins：真正的工具实例由 AgentRuntime 在 run() 工具初始化阶段
// 通过 createSubagentDelegateTool() 按发现的子 Agent 动态创建并注册为 subagent_<name>。
// SubagentDelegateTool 类仅用于类型导出/文档化契约。
export { SubagentDelegateTool, createSubagentDelegateTool } from './agent_team/subagent_delegate/tool.js'
export {
  loadSubagentKindOptions,
  loadSubagentKindOptionsFromCtx,
  forkOptionsFromAgentJson,
  candidateAgentJsonPaths,
} from './agent_team/subagent-kind-options.js'
export type { LoadSubagentKindOptionsArgs } from './agent_team/subagent-kind-options.js'
export { collectDiff, formatDiffForReport } from './agent_team/diff-collector.js'
export type { DiffSummary, DiffEntry } from './agent_team/diff-collector.js'
export { ProjectAgentTool } from './project/project_agent/tool.js'
export { ChangeSelfTool } from './agent_team/change_self/tool.js'
export {
  bindReportWake,
  takeQuietReports,
  formatQuietReports,
  resetQuietReportsForTest,
} from './agent_team/report_to_parent/host.js'
export { installToolsContracts } from './security/contracts.js'

// ask_user 宿主桥：app / cli 用它把提问交给人（barrel 之前漏接）
export { bindAskUserHost, getAskUserHost, requestAskUser } from './ask_user/host.js'
export type {
  AskUserAnswers,
  AskUserHost,
  AskUserKind,
  AskUserOption,
  AskUserPlanDecision,
  AskUserQuestion,
  AskUserRequest,
  AskUserResult,
} from './ask_user/host.js'

