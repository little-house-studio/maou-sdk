/**
 * Agent 核心运行时 —— 异步生成器驱动的 agent 循环。
 *
 * 流程：
 * 1. 确保 session 存在 → 加载/创建
 * 2. 编译 prompt（首轮）
 * 3. Agent 循环（最大轮次）：
 *    a. 从 session 历史构建消息数组
 *    b. 通过 ModelCaller 调用 LLM（流式）
 *    c. yield 每个流式事件（assistant_delta, tool_call, tool_result 等）
 *    d. 解析响应中的工具调用
 *    e. 如有工具调用：执行工具 → 追加结果 → 继续循环
 *    f. 如无工具调用：退出循环
 * 4. yield done 事件
 *
 * 自动压缩：token 达到 80% 阈值时压缩（对齐 DSH thresholdRatio）。
 */

import { execSync } from "node:child_process";
import { PromptCompiler } from "@little-house-studio/prompt";
import { SessionStore, SessionManager, MemoryStore, CheckpointStore, extractMemories, unwrapAgentSendTag, installContextContracts } from "@little-house-studio/context";
import {
  appendToolResult,
  findToolCallIdByPayload,
  buildMessages,
  maybeCompress,
  ContextEngine,
  maouToLLMMessage,
  parseUsageTokens,
  composeContextBreakdown,
  formatContextBreakdownBlock,
  estimateSessionMessageTokens,
  estimateSystemTokens,
  estimateToolsTokens,
  resolveWorkspaceInstructionsEnabled,
  instructionRelPaths,
  emergencyTrimMessages,
  stripNonTextContent,
  MAX_ROUNDS,
  DEFAULT_AGENT_ROUND_LIMIT,
  DEFAULT_LOOP_THRESHOLD,
  CONTEXT_THRESHOLD_PERCENT,
  parseThinkingContextMode,
  shouldStoreThinkingInContext,
  resolveMicroCompactRounds,
  DEFAULT_MICRO_COMPACT_ROUNDS,
} from "@little-house-studio/context";
import type {
  HarnessSessionStore,
  ContextSchemeExtension,
  Summarizer,
  LLMMessage,
  ThinkingContextMode,
  ContextBreakdown,
  SessionMessageLike,
} from "@little-house-studio/context";
import { applyOnClearSession } from "@little-house-studio/context";
import { compileDynamicContext } from "../dynamic-context.js";
import { DynamicSnapshotGate, TimeContextGate, formatMultiplexerPane } from "../time-context.js";
import { TokenTracker } from "./token-tracker.js";
import type { TokenUsage } from "./token-tracker.js";
import { promptCacheLedger } from "./prompt-cache-ledger.js";
import { AgentRegistry } from "./registry.js";
import {
  detectContextOverflow,
  detectUnsupportedMediaContent,
  normalizeCacheUsage,
  resolveContextWindow,
} from "@little-house-studio/llm";
import type { ContextWindowSource } from "@little-house-studio/llm";
import { getTemplateRef } from "./template-ref.js";
import { renderAgentPreview, watchAgentPreview, readAgentWorkspaceInstructions, readAgentMicroCompactRounds } from "./template.js";
import { runAgentCommand } from "./command-runner.js";
import { CommandRegistry, registerBuiltinCommands, type CommandContext, type CommandResult } from "./command-registry.js";
import {
  ModelCaller,
  type ModelCallResult,
  type CallerStreamEvent,
  parseLlmErrorFromMessage,
  classifyFromThrown,
  AuxModelCaller,
  resolveHelperPreset,
  deriveJsonSettings,
  StreamJsonAccumulator,
} from "@little-house-studio/llm";
import type { LLMToolCall, APIPreset } from "@little-house-studio/llm";
import {
  isOutputTruncatedByLength,
  appendTruncationMarker,
  buildLengthContinuationControl,
  MAX_LENGTH_CONTINUATIONS,
  toolCallSignature,
  strictToolCallSignature,
  detectRepeatedToolLoop,
  buildToolLoopControl,
  consecutiveToolStreak,
  shouldNudgeToolStreak,
  buildToolStreakControl,
  findSameRoundResourceConflicts,
  toolActsExclusive,
  CANCELLED_NOT_STARTED,
} from "./runtime-recovery.js";
import { SUPERVISOR_MANAGER } from "./supervisor-manager.js";
import {
  SUPERVISOR_HARNESS_TOOL_NAMES,
  registerSupervisorHarnessTools,
} from "./supervisor/register.js";
import { SubagentRegistry } from "./subagent-registry.js";
import { AgentLifecycleManager } from "./agent-lifecycle.js";
import { MessageBus } from "./message-bus.js";
import type { ToolRegistry, ToolExecutor, ToolErrorInfo } from "@little-house-studio/tools";
import type { ToolContext } from "@little-house-studio/tools";
import {
  collectDiff,
  formatDiffForReport,
  ensureToolError,
  toolFail,
  bindPermissionHookHost,
  bindTerminalHookHost,
  takeQuietReports,
  formatQuietReports,
  bindReportWake,
  installToolsContracts,
} from "@little-house-studio/tools";
import type { PermissionRequestPayload, TerminalGateName, TerminalEmitName } from "@little-house-studio/tools";
import {
  collectMissingRequiredParams,
  missingRequiredToolResponse,
  hookBlockedToolResponse,
  executeThrownToolResponse,
} from "./tool-result-gates.js";
import {
  cleanupAgentTerminals,
  listTerminals,
  getTerminalLogs,
  setTerminalMode,
  setAgentTerminalMode,
  SkillContextManager,
  TASK_MANAGER,
  createSubagentDelegateTool,
  formatTodoNoticeMessage,
  preprocessTodoSlash,
  buildPlanRequiredNotice,
} from "@little-house-studio/tools";
import { TODO_ORCHESTRATOR } from "./todo/index.js";
import {
  registerJob,
  completeJob,
  takeSettledJobs,
  noteAutoWake,
  resetWakeStreak,
} from "./job-registry.js";
import { buildToolContext } from "./runtime-tool-context.js";
import {
  isTodoPlanSettled as isTodoPlanSettledHelper,
  flushTodoNotices as flushTodoNoticesHelper,
  afterTodoTools as afterTodoToolsHelper,
} from "./runtime-todo.js";
import {
  appendSessionEvent,
  appendLedgerEvent,
  describeContextDrift,
  flushLedger,
  isLedgerBarrier,
  takeContextStructure,
  readLedgerRecords,
  compactLockOpen,
  polishSessionTitle,
  bindSessionLedgerPort,
  bindSessionGoalPort,
  sessionGoals,
  goalHarness,
  sessionPlan,
  sessionPlanFile,
  bindSessionPlanPort,
  renderPlanPolicy,
  renderGoalRoundPrompt,
  authorHuman,
  authorAgent,
  authorSystem,
  formatSenderEnvelope,
} from "@little-house-studio/context";
import type { GoalClosePending, GoalMessageSource } from "@little-house-studio/types";
import { decideGoalSettle, goalRoundPromptKind, parseTaskCompletion } from "@little-house-studio/types";
import { planHarnessGoal, decideHarnessRound } from "./goal/harness-loop.js";
import type { AgentSkillOptions } from "../bootstrap/skills.js";
import { createAgentSkillManager, applyAgentSkillOptions } from "../bootstrap/skills.js";
import type { SubagentExecutorLike } from "@little-house-studio/types";
import type { StreamEvent } from "@little-house-studio/types";
import type { MessageImage } from "@little-house-studio/types";
import { Profiler, resolveUserMaouRoot, detectExpression } from "@little-house-studio/types";
import { Hooks, type HookUi, appendHookSystemPrompt, takeHookMessage, isHookContinue } from "./hooks.js";
import { loadHookScripts } from "./hook-loader.js";
import { FileDiffWatch } from "../agent_factory/file-diff-watch.js";
import {
  CacheRebuildHost,
  mergeCacheRebuildTriggers,
  parseCacheRebuildTriggers,
  type CacheRebuildPointEvent,
  type CacheRebuildPointResult,
  type CacheRebuildTriggers,
} from "./cache-rebuild.js";

/** loop.ts 脚本的判定上下文（shouldContinueLoop 入参）。 */
interface LoopScriptCtx {
  toolCalls: { name: string; endsLoop: boolean }[];
  endsLoopFailed: boolean;
  tasksIncomplete: boolean;
  round: number;
}
import { MESSAGE_QUEUE, MessageQueue } from "./message-queue.js";
import type { QueuedMessage } from "./message-queue.js";
import { existsSync, mkdirSync, cpSync, readdirSync, rmSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Runtime 配置 ──────────────────────────────────────────────────────────

export interface RuntimeOptions {
  compiler: PromptCompiler;
  sessions: SessionStore;
  tools: ToolRegistry;
  toolExecutor: ToolExecutor;
  /** 模型调用函数（由 ModelCaller 提供） */
  callModel: (params: ModelCallParams) => AsyncGenerator<CallerStreamEvent, ModelCallResult>;
  /** agent 轮次上限，0 = 无限 */
  agentRoundLimit?: number;
  /** 循环检测阈值 */
  loopThreshold?: number;
  /** 日志函数 */
  log?: (level: string, message: string) => void;
  /** maou 根目录 */
  maouRoot?: string;
  /** 项目根目录 */
  projectRoot?: string;
  /** 全局 agent 不创建/读取调用路径下的 `.maou/agents`。 */
  agentScope?: "project" | "global";
  /**
   * ContextEngine 上下文压缩闭环（可选）。
   * 注入 harnessStore 时启用：每轮 sync→compress→toLLMHistory。
   */
  harnessStore?: HarnessSessionStore;
  contextExtensions?: ContextSchemeExtension[];
  /** 可插拔 LLM 摘要器（compress 时生成真摘要；缺省回退确定性 truncate）。 */
  summarizer?: Summarizer;
  /**
   * 辅助模型调用器（可选）—— 统一辅助调用管道（压缩/路由等）。
   * 注入后：若同时注入了 summarizer，summarizer 仍用旧路径（向后兼容）；
   * 若注入了 auxModelCaller 但没注入 summarizer，summarizer 自动用 auxModelCaller 构建。
   */
  auxModelCaller?: AuxModelCaller;
  /**
   * 辅助模型 preset 解析函数（可选）—— 返回当前 agent 应使用的辅助模型 preset。
   * runtime 在每轮 run 开始时调用，传入 agentName 和主 preset，返回辅助 preset。
   * 未注入：辅助调用回退主 preset。
   */
  resolveHelperPreset?: (agentName: string, mainPreset: APIPreset) => APIPreset;
  /** 钩子管理器（可选）。注入后 agent 循环会在各生命周期点触发 hooks。 */
  hooks?: Hooks;
  /**
   * 缓存重建点默认触发开关。
   * 未传时：大压缩/归档、手动 /compact（非微压缩）、新建/清空会话均触发。
   * agent.json `cacheRebuild` 可再覆盖。
   */
  cacheRebuild?: Partial<CacheRebuildTriggers>;
  /**
   * 消息队列（可选）。注入后 agent 循环会在 round_end / loop_end / task_complete
   * 检查队列，投递等待中的用户消息。缺省则使用全局 MESSAGE_QUEUE 单例。
   */
  messageQueue?: MessageQueue;
  /**
   * 调用主 Agent（监督模式专用）—— 由 harness 注入。
   *
   * supervisor_chat_main 工具调此函数把消息派给主 Agent。
   * 函数接收 (mainSessionId, message, abortSignal)，返回 AsyncGenerator<StreamEvent, string>：
   *   - yield 主 Agent 的流式事件（可选上报前端）
   *   - return 主 Agent 的最终输出文本
   *
   * AgentRuntime 在 processToolCalls 中根据当前 sessionId 查 SUPERVISOR_MANAGER 拿到
   * mainSessionId，再调此函数 —— 这样多用户同时开监督不会串台。
   *
   * 缺省（undefined）→ supervisor_chat_main 工具返回错误。
   */
  callMainAgent?: (mainSessionId: string, message: string, abortSignal?: AbortSignal) => AsyncGenerator<StreamEvent, string>;

  // ── 可插拔工厂（缺省使用内部默认实现，注入后可替换为自定义）──
  /** SessionManager 工厂（缺省 new SessionManager(sessions, maouRoot)） */
  createSessionManager?: (sessions: SessionStore, maouRoot: string) => SessionManager;
  /** CheckpointStore 工厂（缺省 new CheckpointStore(sessions)） */
  createCheckpointStore?: (sessions: SessionStore) => CheckpointStore;
  /** MemoryStore 工厂（缺省 new MemoryStore(maouRoot, agentName)） */
  createMemoryStore?: (maouRoot: string, agentName: string) => MemoryStore;
  /** TokenTracker 工厂（缺省 new TokenTracker(maouRoot, agentName, preset)） */
  createTokenTracker?: (maouRoot: string, agentName: string, preset: Record<string, unknown>) => TokenTracker;
  /** SkillContextManager 工厂（缺省 createAgentSkillManager + skillOptions） */
  createSkillManager?: (agentName: string, projectRoot: string, maouRoot: string) => SkillContextManager;
  /**
   * Skill 扫描 / 白名单（Agent 层）。
   * includeSystemNpmSkills 默认 true → 扫描 ~/.agents/skills 等 NPM 全局路径。
   */
  skillOptions?: AgentSkillOptions;
  /**
   * 会话级文件 diff 监听（变更感知）。
   * - true：启用默认配置（reader/edit/write 触碰入名单，before_user 注入可选通知）
   * - 对象：自定义 idle/notice 阈值与工具集
   * - false/缺省：不启用
   */
  fileDiffWatch?: boolean | {
    maxIdleRounds?: number;
    maxChangeNoticesWithoutTouch?: number;
    touchTools?: readonly string[];
  };
}

export interface ModelCallParams {
  preset: APIPreset;
  messages: Record<string, unknown>[];
  stream: boolean;
  toolSchemas?: Record<string, unknown>[] | null;
  nativeToolCalling?: boolean;
  autoFormat?: boolean;
  jsonSettings?: Record<string, unknown> | null;
  /** 会话 ID（用于 raw 日志记录） */
  sessionId?: string;
  /** 当前轮次（用于 raw 日志记录） */
  round?: number;
  /** 中断信号 —— 透传到底层 fetch，真正中止网络请求 */
  abortSignal?: AbortSignal;
}

export interface RunOptions {
  /** API 预设 */
  preset: APIPreset;
  /** 自动格式化响应 */
  autoFormat?: boolean;
  /** agent 模式（多轮工具调用） */
  agentMode?: boolean;
  /** 沙箱模式 */
  sandboxMode?: string;
  /** JSON 输出设置 */
  jsonSettings?: Record<string, unknown> | null;
  /** 是否流式 */
  stream?: boolean;
  /** 初始化 agent 名称 */
  initAgentName?: string;
  /** 发送者名称，默认 "user" */
  userName?: string;
  /** 附带指令（如 goal）→ 先走 /command，正文仍按 AgentSendMessage 写入 */
  userCommand?: string;
  /** 用户消息附图（写入 SessionMessage.images，buildMessages 会带上） */
  userImages?: MessageImage[];
  userVideo?: Array<{ mimeType: string; data: string }>;
  userAudio?: Array<{ mimeType: string; data: string }>;
  /** 用户消息 source（缺省 human） */
  userMessageSource?: string;
  /** 内部：跳过 goal-round driver 外壳（driver 自己调 run 时打开） */
  skipGoalDriver?: boolean;
  /** 内部：本轮是已承认的 goal round */
  goalRound?: GoalMessageSource;
  /** 中断信号——收到中断时停止 agent 循环 */
  abortSignal?: AbortSignal;
  /** 平台上下文注入 —— 由插件（如飞书）提供，追加在 system prompt 之后 */
  platformContext?: string;
  /** 绑定级项目根路径 —— 由插件（如飞书）提供，覆盖 AgentRuntime.projectRoot */
  bindingProjectRoot?: string;
  /**
   * MCP 代理工具名列表（P2-4）。
   * fork 子 Agent 时，若 inheritMcp !== false，SubagentExecutor 把父 Agent 的 MCP 工具
   * 包装成 proxy Tool 实例传给 runFn；runFn 调 AgentRuntime.registerMcpProxyTools() 注册后，
   * 把工具名列表通过此字段传入 run()，run() 会把它们加入工具白名单（避免被 nativeToolSchemas 过滤）。
   */
  mcpProxyToolNames?: string[];
  /**
   * 子 Agent 工具白名单覆盖（kind 解析后由 SubagentExecutor 传入）。
   * - undefined：沿用 PERMISSION ∩ agent.json tools
   * - []：无工具（helper 单轮强制；nativeToolSchemas 收到空集）
   * - string[]：与既有白名单取交集（若无既有白名单则直接用此列表）
   */
  toolWhitelistOverride?: string[];
  /**
   * 路径沙箱（project subagent）。也会写入 per-session map 供 processToolCalls 注入。
   */
  pathGuard?: {
    mode: "inherit" | "hard" | "audit" | "open";
    roots: string[];
    auditRoots?: string[];
  };
  /**
   * 思考回灌上下文模式（覆盖 agent.json thinking_context_mode）。
   * - never: 不写入
   * - first_round: 仅本 loop 第一回合（默认）
   * - always: 每回合都写
   */
  thinkingContextMode?: ThinkingContextMode;
  /** 覆盖 agent.json micro_compact_rounds */
  microCompactRounds?: number;
}

export function classifyCompactError(message: string): string {
  const m = message.toLowerCase();
  if (/忙|busy|running/.test(m)) return "busy";
  if (/变了|changed|generation|fingerprint/.test(m)) return "content_changed";
  if (/摘要|summar/.test(m)) return "summary_failed";
  if (/提交|commit/.test(m)) return "commit_failed";
  if (/磁盘|write|persist|enospc|eacces/.test(m)) return "not_written";
  if (/区间|no_range|无可压/.test(m)) return "no_range";
  return "commit_failed";
}

/**
 * 落盘屏障失败时给人看的一句话。
 *
 * 屏障是"做之前先记下要做什么"：写不进盘就停手，否则崩溃之后没人能判断
 * 这次请求发出去了没有、这个工具改了世界没有。
 */
/** 压缩报告里的真 seq 区间；没顶掉整条消息时什么都不带，不用 0 假装。 */
export function compactSeqRange(report: { seqFrom?: number; seqTo?: number }): {
  seqFrom?: number;
  seqTo?: number;
} {
  if (typeof report.seqFrom !== "number" || typeof report.seqTo !== "number") return {};
  return { seqFrom: report.seqFrom, seqTo: report.seqTo };
}

export function ledgerBarrierHuman(type: string, reason: string): string {
  const what =
    type === "tool/dispatch"
      ? "本次不动手"
      : type === "turn/start"
        ? "本轮不开口"
        : "本轮不开口";
  return `账未落盘，${what}：${reason}。磁盘写不进去时继续跑会丢掉这一步的记录，崩了之后无法判断它到底发生过没有。请先处理磁盘（空间 / 权限 / 路径）再重试。`;
}

/** 距本 loop 最后一条用户消息的墙钟。assistant 落盘 / abort 写入 loopDurationMs。 */
function loopDurationSinceLastUser(
  sessions: SessionStore,
  sessionId: string,
  endMs: number,
): number | undefined {
  const msgs = sessions.load(sessionId)?.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]!.role !== "user") continue;
    const t = Date.parse(String(msgs[i]!.createdAt ?? ""));
    if (!Number.isFinite(t) || t <= 0 || endMs < t) return undefined;
    return endMs - t;
  }
  return undefined;
}

// ─── AgentRuntime ──────────────────────────────────────────────────────────

export class AgentRuntime {
  private compiler: PromptCompiler;
  private sessions: SessionStore;
  private sessionManager: SessionManager;
  private checkpointStore: CheckpointStore;
  private tools: ToolRegistry;
  private toolExecutor: ToolExecutor;
  private callModelFn: (params: ModelCallParams) => AsyncGenerator<CallerStreamEvent, ModelCallResult>;
  private agentRoundLimit: number;
  private loopThreshold: number;
  private logFn: (level: string, message: string) => void;
  private maouRoot: string;
  private projectRoot: string;
  private agentScope: "project" | "global";
  /** 当前 run() 的实际工作目录（agent.json working_dir 或 projectRoot）—— workspaceChanges/PromptCompiler 用 */
  private effectiveWorkingDir: string = "";
  /** agent.json terminalMode（full|mini），与审批用 terminal_mode 无关 */
  private agentTerminalBackend?: "full" | "mini";
  /** agent.json computerUse.mode（auto|ax|pixels） */
  private agentComputerUseMode?: "auto" | "ax" | "pixels";
  /** ContextEngine 闭环依赖（可选） */
  /** agent.json micro_compact_rounds；该 Agent 所有微压功能共用 */
  private microCompactRounds = DEFAULT_MICRO_COMPACT_ROUNDS;
  private harnessStore?: HarnessSessionStore;
  private contextExtensions?: ContextSchemeExtension[];
  private summarizer?: Summarizer;
  /** 辅助模型调用器（统一辅助调用管道） */
  private auxModelCaller?: AuxModelCaller;
  /** 辅助模型 preset 解析函数 */
  private resolveHelperPresetFn?: (agentName: string, mainPreset: APIPreset) => APIPreset;
  /** 压缩回调（由外部注入，用于压缩区落盘） */
  onCompress?: (sessionId: string, stage: string, summary: string, taskBlocks: string[]) => void;
  /** 钩子管理器（可选） */
  private hooks?: Hooks;
  /** 消息队列（缺省全局单例） */
  private messageQueue: MessageQueue;
  /** per-session 内部 AbortController（用于 interrupt 模式触发 abort） */
  private abortControllers = new Map<string, AbortController>();
  /** 指令注册表（统一管理所有 /xxx 指令，匹配成功不走 AI） */
  readonly commandRegistry: CommandRegistry;
  /** TOOL.md 文件监听是否已启动 */
  private _toolPromptWatchStarted = false;
  /** 子 Agent 真并行执行器（可选；harness 注入 runFn 后才可用）。
   * 注入到 ToolContext.subagentExecutor，agent_message 工具据此 fork 子 Agent。
   */
  private subagentExecutor?: SubagentExecutorLike;
  /** per-session 路径沙箱（project/task subagent） */
  private _sessionPathGuards = new Map<
    string,
    { mode: "inherit" | "hard" | "audit" | "open"; roots: string[]; auditRoots?: string[] }
  >();
  /** 已注册的子 Agent delegate 工具名（subagent_<name>），用于下次 run 前清理，
   * 避免上一次 run 注册的 subagent_<name> 在子 Agent 目录变更后残留。 */
  private _registeredSubagentTools: Set<string> = new Set();
  /** 监督工具，只在监督 session 挂上，下次 run 先卸。 */
  private _registeredSupervisorTools: Set<string> = new Set();
  /**
   * MCP 连接管理器（可选）。
   * Runtime 门面或 harness 注入后，run() 会在工具初始化阶段 ensureLoaded + sync 工具表，
   * 并把 descriptors/invoker 同步到 SubagentExecutor（inheritMcp）。
   */
  private mcpManager?: import("./mcp/manager.js").McpConnectionManager;
  /** 是否在 run 时自动加载 agent connections/（默认 true） */
  private mcpAutoLoad = true;
  /** 当前 agent 已同步到 registry 的 MCP host 工具名（非 proxy） */
  private _registeredMcpHostTools: Set<string> = new Set();
  /** 调用主 Agent（监督模式专用）—— 由 harness 注入 */
  private callMainAgentFn?: (mainSessionId: string, message: string, abortSignal?: AbortSignal) => AsyncGenerator<StreamEvent, string>;

  /**
   * per-session yield 结果回调（P2-1）。
   *
   * SubagentExecutor.fork 在运行子 Agent 前调 setYieldHandler(sessionId, handler)
   * 注册；processToolCalls 构建 ToolContext 时从该 map 读取并注入到 ctx.yieldResult。
   * 子 Agent 调 yield 工具时，回调把 result 上交给 fork；fork 检测到后结束子 Agent。
   * run 结束时清理（clearYieldHandler）。
   */
  private yieldHandlers = new Map<string, (result: string, summary?: string) => void>();

  /**
   * 当前 run() 内每轮 LLM 调用使用的 preset。
   * 初始为 options.preset；运行中可通过 switchPreset() 切换，下一轮生效。
   * null 表示当前无运行中的 run。
   * 支持「先快速模型规划→再慢模型执行」场景：外部在 run 进行中调 switchPreset 即可。
   */
  private currentPreset: APIPreset | null = null;

  /**
   * 压缩失败退避：sessionId → 下次允许再试的时间戳。
   * 失败时本轮不压、不杀 run；间隔后自动再试，直到成功或用户 abort。
   */
  private compressRetryAfter = new Map<string, number>();
  /** 默认压缩失败后 15s 再试 */
  private static COMPRESS_RETRY_MS = 15_000;

  /**
   * 上一条主模型回报的 prompt + output（消息上显示的占用）。
   */
  private sessionLastOccupancy = new Map<string, {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheReported: boolean;
    /** 记账时会话里有多少条消息 —— 之后新增的部分只能靠估算补 */
    anchorMessageCount?: number;
  }>();
  /** 压缩后占用清零，禁止再读磁盘上一条 usage。 */
  private sessionOccupancyCleared = new Set<string>();
  /** 上一次真正发出去的 system / tools，供分区条估算。 */
  private sessionLastPromptParts = new Map<string, {
    systemPrompt: string;
    toolSchemas: unknown;
    toolCount: number;
    skillCount: number;
    mcpCount: number;
  }>();

  // ── 可插拔工厂（缺省使用内部默认实现）──
  private createSessionManagerFn: (sessions: SessionStore, maouRoot: string) => SessionManager;
  private createCheckpointStoreFn: (sessions: SessionStore) => CheckpointStore;
  private createMemoryStoreFn: (maouRoot: string, agentName: string) => MemoryStore;
  private createTokenTrackerFn: (maouRoot: string, agentName: string, preset: Record<string, unknown>) => TokenTracker;
  private createSkillManagerFn: (agentName: string, projectRoot: string, maouRoot: string) => SkillContextManager;
  private skillOptions?: AgentSkillOptions;
  /** 会话级文件 diff 监听（coding 等产品可选启用） */
  private fileDiffWatch: FileDiffWatch | null = null;
  /** 压缩遮蔽说明书后，下一轮整份重组 */
  private instructionRebaseline = new Set<string>();
  private timeContextGate: TimeContextGate | null = null;
  private lastMultiplexerPane = "";
  /** 每轮重算的运行时快照：变了才注入，变空要说清旧的作废。按会话分。 */
  private dynamicSnapshotGates = new Map<string, DynamicSnapshotGate>();
  private cacheRebuildTriggers: CacheRebuildTriggers;
  private cacheRebuild: CacheRebuildHost;
  private _hooksLoadedFor = new Set<string>();
  private lastExpression = new Map<string, string>();

  constructor(options: RuntimeOptions) {
    this.compiler = options.compiler;
    this.sessions = options.sessions;
    this.tools = options.tools;
    this.toolExecutor = options.toolExecutor;
    this.callModelFn = options.callModel;
    this.agentRoundLimit = options.agentRoundLimit ?? DEFAULT_AGENT_ROUND_LIMIT;
    this.loopThreshold = options.loopThreshold ?? DEFAULT_LOOP_THRESHOLD;
    this.logFn = options.log ?? (() => {});
    this.maouRoot = options.maouRoot ?? resolveUserMaouRoot();
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.agentScope = options.agentScope ?? "project";
    this.harnessStore = options.harnessStore;
    this.contextExtensions = options.contextExtensions;
    this.summarizer = options.summarizer;
    this.auxModelCaller = options.auxModelCaller;
    this.resolveHelperPresetFn = options.resolveHelperPreset;
    this.hooks = options.hooks;
    this.messageQueue = options.messageQueue ?? MESSAGE_QUEUE;
    this.callMainAgentFn = options.callMainAgent;
    this.cacheRebuildTriggers = mergeCacheRebuildTriggers(options.cacheRebuild);
    this.cacheRebuild = new CacheRebuildHost({
      hooks: () => this.hooks,
      resolveTriggers: (agentName) =>
        mergeCacheRebuildTriggers(
          this.cacheRebuildTriggers,
          this.lookupAgentCacheRebuild(agentName),
        ),
      onFired: (event, generation) => {
        this.log(
          "info",
          `[cache_rebuild_point] reason=${event.reason} session=${event.sessionId ?? ""} gen=${generation}`,
        );
      },
    });

    // 工厂：优先使用注入的实现，缺省使用内部默认
    this.createSessionManagerFn = options.createSessionManager ?? ((s, r) => new SessionManager(s, r));
    this.createCheckpointStoreFn = options.createCheckpointStore ?? ((s) => new CheckpointStore(s));
    this.createMemoryStoreFn = options.createMemoryStore ?? ((r, n) => new MemoryStore(r, n));
    this.createTokenTrackerFn = options.createTokenTracker ?? ((r, n, p) => new TokenTracker(r, n, p));
    // skill 选项：先写入 tools 默认，保证 use_skill 与文件缓存区 skill 索引同口径
    applyAgentSkillOptions(options.skillOptions);
    this.skillOptions = options.skillOptions;
    this.createSkillManagerFn =
      options.createSkillManager ??
      ((n, p, r) => createAgentSkillManager(n, p, r, this.skillOptions));

    // 文件 diff 监听名单（变更感知）
    if (options.fileDiffWatch) {
      const fd =
        options.fileDiffWatch === true
          ? {}
          : options.fileDiffWatch;
      this.fileDiffWatch = new FileDiffWatch({
        projectRoot: this.projectRoot,
        maxIdleRounds: fd.maxIdleRounds,
        maxChangeNoticesWithoutTouch: fd.maxChangeNoticesWithoutTouch,
        touchTools: fd.touchTools,
      });
    }

    // 注入 interrupt 回调：interrupt 模式 enqueue 时自动 abort 当前 run
    // （未注入时只返回 shouldAbort=true，需调用方自行 abort）
    this.messageQueue.setOnInterrupt((sid, mode) => {
      this.abortCurrentRun(sid, mode);
      this.log("info", `[MSG_QUEUE] session=${sid} 触发 ${mode}，已 abort 当前 run`);
    });

    // 初始化上下文管理层（通过工厂）
    this.sessionManager = this.createSessionManagerFn(this.sessions, this.maouRoot);
    this.sessionManager.loadState();
    this.checkpointStore = this.createCheckpointStoreFn(this.sessions);

    // 初始化指令注册表（内置指令 + 外部可扩展）
    this.commandRegistry = new CommandRegistry();
    registerBuiltinCommands(this.commandRegistry);
    this.bindPermissionHooks();
    this.bindTerminalHooks();
    try { installContextContracts(); } catch { /* 契约登记失败不影响运行 */ }
    try { installToolsContracts(); } catch { /* 契约登记失败不影响运行 */ }
    bindReportWake((parentId, message, fromSessionId, fromAgent) => {
      this.messageQueue.rememberSessionDir(parentId, this.sessions.sessionDir);
      this.messageQueue.enqueue(
        parentId,
        formatSenderEnvelope({
          body: message,
          from: fromAgent?.trim() || fromSessionId,
          type: "report",
        }),
        {
          mode: "after_round_complete",
          source: "report_to_parent",
          metadata: {
            fromSessionId,
            fromAgent,
            from: fromAgent?.trim() || fromSessionId,
            wake: true,
          },
          sessionDir: this.sessions.sessionDir,
        },
      );
    });
  }

  setHookUi(ui: HookUi): void {
    if (!this.hooks) this.hooks = new Hooks();
    this.hooks.ui = ui;
  }

  getHooks(): Hooks {
    if (!this.hooks) this.hooks = new Hooks();
    return this.hooks;
  }

  /**
   * 缓存重建点：判断默认触发 → pre_cache_rebuild（可 cancel）→ 点 hook → post。
   * 扩展与产品可直接调用；压缩 / 新建会话等内部时机也会走这里。
   */
  async atCacheRebuildPoint(
    event: CacheRebuildPointEvent,
  ): Promise<CacheRebuildPointResult> {
    const sessionId = event.sessionId;
    const agentName =
      event.agentName ??
      (sessionId ? this.sessions.load(sessionId)?.agentName : undefined);
    return this.cacheRebuild.atPoint({ ...event, agentName });
  }

  getCacheRebuildGeneration(sessionId: string): number {
    return this.cacheRebuild.getGeneration(sessionId);
  }

  notifyDeviceOnline(deviceId: string): Promise<void> {
    return this.getHooks().deviceOnline(deviceId);
  }

  notifyDeviceOffline(deviceId: string): Promise<void> {
    return this.getHooks().deviceOffline(deviceId);
  }

  notifyConfigChange(payload: Record<string, unknown> = {}): Promise<void> {
    return this.getHooks().configChange(payload);
  }

  notifySessionFork(
    parentSessionId: string,
    childSessionId: string,
    extra: Record<string, unknown> = {},
  ): void {
    void this.getHooks().sessionFork(parentSessionId, childSessionId, extra);
  }

  private bindPermissionHooks(): void {
    bindPermissionHookHost({
      request: async (payload: PermissionRequestPayload) => {
        const r = await this.getHooks().permissionRequest({ ...payload });
        if (r.decision === "allow") return { decision: "allow" };
        if (r.decision === "deny" || !r.allowed) {
          return { decision: "deny", reason: r.blockReason ?? payload.reason };
        }
        return { decision: "ask" };
      },
      denied: (payload: PermissionRequestPayload) => {
        void this.getHooks().permissionDenied({ ...payload });
      },
    });
  }

  /** use_terminal 专用闸门/观察；tools 经 bindTerminalHookHost 回调到这里。 */
  private bindTerminalHooks(): void {
    bindTerminalHookHost({
      gate: async (name: TerminalGateName, payload: Record<string, unknown>) => {
        const r = await this.getHooks().trigger(name, payload);
        return {
          allowed: r.allowed && !r.cancel,
          reason: r.blockReason,
          command: r.command,
          data: r.data,
        };
      },
      emit: (name: TerminalEmitName, payload: Record<string, unknown>) => {
        void this.getHooks().trigger(name, payload);
      },
    });
  }

  /** stop / stop_failure 要求继续时，把 reason 注入会话再跑一轮 */
  private injectHookContinue(
    sessionId: string,
    round: number,
    source: string,
    content: string,
  ): StreamEvent[] {
    const text = content.trim() || "请继续完成未竟事项。";
    appendSessionEvent(this.sessions, sessionId, {
      kind: "runtime_control",
      content: text,
      source,
      author: authorSystem("hook", "hook"),
      meta: { round },
    });
    return [
      this.logEvent("info", `[hook] ${source} 要求继续`),
      this.event("session_inject", {
        kind: "runtime_control",
        source,
        content: text.slice(0, 200),
        round,
        author: { type: "system", id: "hook", displayName: "hook" },
      }),
    ];
  }

  private async evaluateStopHook(
    sessionId: string,
    round: number,
    extra: Record<string, unknown> = {},
  ): Promise<{ prevented: boolean; inject: string }> {
    const r = await this.hooks?.stop({ sessionId, round, ...extra });
    if (!isHookContinue(r)) {
      void this.hooks?.notification({ kind: "idle", sessionId, round, ...extra });
      return { prevented: false, inject: "" };
    }
    const inject =
      r?.blockReason ||
      takeHookMessage(r?.message, "") ||
      (typeof r?.systemPrompt === "string" ? r.systemPrompt : "") ||
      "请继续完成未竟事项。";
    return { prevented: true, inject };
  }

  private fireErrorHooks(data: Record<string, unknown>): void {
    const message = String(data.message ?? "");
    void this.hooks?.error(message, data);
  }

  /**
   * DSH tools/pre-execute：deny 拦截；ask 再走 permission_request（未批准则 fail-closed）。
   * write_file / edit_file 先打 fs/*-intent。
   */
  private async gateToolCall(
    tcInfo: { id?: string; name: string; parameters?: unknown },
    sessionId: string,
    round: number,
  ): Promise<boolean> {
    const hooks = this.hooks;
    if (!hooks) return true;
    const name = tcInfo.name;
    const intentPayload = { toolCall: tcInfo, sessionId, round, toolName: name };
    const intent =
      name === "write_file" || name === "write"
        ? await hooks.fsWriteIntent(intentPayload)
        : name === "edit_file" || name === "edit"
          ? await hooks.fsEditIntent(intentPayload)
          : undefined;
    if (intent && !intent.allowed) {
      hooks.lastBlockReason = intent.blockReason ?? hooks.lastBlockReason;
      return false;
    }
    const pre = await hooks.preToolUseGate(tcInfo as never);
    if (!pre.allowed) return false;
    if (pre.decision !== "ask") return true;
    const perm = await hooks.permissionRequest({
      toolName: name,
      toolCall: tcInfo,
      sessionId,
      round,
      reason: pre.blockReason,
    });
    if (perm.decision === "allow") return true;
    hooks.lastBlockReason =
      perm.blockReason ?? pre.blockReason ?? "permission ask 未获批准";
    void hooks.permissionDenied({
      toolName: name,
      toolCall: tcInfo,
      sessionId,
      round,
      reason: hooks.lastBlockReason,
    });
    return false;
  }

  private async ensureAgentHooksLoaded(agentName: string): Promise<void> {
    if (this._hooksLoadedFor.has(agentName)) return;
    this._hooksLoadedFor.add(agentName);
    try {
      const registry = new AgentRegistry(
        this.maouRoot,
        this.agentScope === "project" ? this.projectRoot : undefined,
      );
      const dir = registry.resolveAgentDir(agentName);
      const templateDir = getTemplateRef(dir) ?? dir;
      const dirs: string[] = [];
      if (templateDir) dirs.push(join(templateDir, "hook"));
      if (dir !== templateDir) dirs.push(join(dir, "hook"));
      const { loaded } = await loadHookScripts(this.getHooks(), dirs);
      if (loaded.length > 0) {
        this.log("info", `[hook] 已加载 ${loaded.length} 个脚本`);
      }
    } catch (err) {
      this.log("warning", `[hook] 脚本加载失败: ${err}`);
    }
  }

  private lookupAgentCacheRebuild(agentName?: string): Partial<CacheRebuildTriggers> | undefined {
    const name = agentName?.trim();
    if (!name) return undefined;
    try {
      const registry = new AgentRegistry(
        this.maouRoot,
        this.agentScope === "project" ? this.projectRoot : undefined,
      );
      const entry = registry.get(name);
      return parseCacheRebuildTriggers(
        (entry as { cacheRebuild?: unknown } | undefined)?.cacheRebuild,
      );
    } catch {
      return undefined;
    }
  }

  private async afterCompressMaybeRebuild(opts: {
    sessionId: string;
    agentName?: string;
    stage?: string;
    source: "auto" | "manual" | "overflow";
  }): Promise<void> {
    await this.atCacheRebuildPoint({
      reason: opts.source === "manual" ? "manual_compact" : "context_compress",
      sessionId: opts.sessionId,
      agentName: opts.agentName,
      stage: opts.stage,
    });
  }

  /** 强制压缩（/compact 与 UI 触发） */
  async forceCompressSession(sessionId: string): Promise<{
    ok: boolean;
    stage?: string;
    originalTokens?: number;
    compressedTokens?: number;
    droppedSummary?: string;
    taskBlocks?: string[];
    error?: string;
    code?: string;
  }> {
    if (this.isRunning(sessionId)) {
      return { ok: false, error: "正忙：当前会话还在跑，空闲后再压。", code: "busy" };
    }
    if (!this.harnessStore) {
      return { ok: false, error: "压缩引擎未启用", code: "not_written" };
    }
    try {
      const compactGate = await this.hooks?.preCompact({ sessionId, force: true, reason: "command" });
      if (compactGate?.cancel) {
        return { ok: false, error: "压缩被扩展取消", code: "commit_failed" };
      }
      if (compactGate?.compaction?.summary) {
        this.sessionManager.setRollingSummary(sessionId, compactGate.compaction.summary);
        this.sessionManager.saveState();
      }
      const engine = new ContextEngine({
        sessionId,
        harnessStore: this.harnessStore,
        extensions: this.contextExtensions,
        summarizer: this.summarizer,
        microTurn: this.sessions.getMicroTurn(sessionId),
        microRounds: this.microCompactRounds,
      });
      const session = this.sessions.load(sessionId);
      const branch = this.sessions.getLlmHistoryMessages(sessionId);
      const msgs = (branch.length ? branch : session?.messages ?? []) as unknown as Array<Record<string, unknown>>;
      // B1：优先 harness 工作集 + session 增量，避免从全量 session 重压
      engine.seedWorkingSet(msgs);
      const limit = this.resolveContextLimit();
      const known = this.resolveSessionContextTokens(sessionId, engine.getHistory());
      this.writeCompactBracket(sessionId, "start", { source: "manual" });
      const report = await engine.compress(limit, {
        knownTokens: known,
        force: true,
        sourceSessionMessages: msgs,
      });
      this.compressRetryAfter.delete(sessionId);
      this.clearLastOccupancy(sessionId);
      if (report.stage === "activeStage") {
        this.writeCompactBracket(sessionId, "end", { error: "no_range", stage: report.stage, source: "manual" });
        return {
          ok: false,
          error: "没有可压缩的区间",
          code: "no_range",
          stage: report.stage,
          originalTokens: report.originalTokens,
          compressedTokens: report.compressedTokens,
          droppedSummary: report.droppedSummary,
          taskBlocks: report.blockIds,
        };
      }
      const existing = this.sessionManager.getRollingSummary(sessionId) ?? "";
      const merged = existing && report.droppedSummary
        ? `${existing}\n\n---\n\n${report.droppedSummary}`
        : (report.droppedSummary || existing);
      if (merged) {
        this.sessionManager.setRollingSummary(sessionId, merged);
        this.sessionManager.saveState();
      }
      this.onCompress?.(sessionId, report.stage, report.droppedSummary, report.blockIds ?? []);
      const seqRange = compactSeqRange(report);
      this.writeCompactBracket(sessionId, "summary", {
        stage: report.stage,
        source: "manual",
        originalTokens: report.originalTokens,
        compressedTokens: report.compressedTokens,
        summary: report.droppedSummary,
        ...seqRange,
      });
      this.sessions.appendMessage(sessionId, "user", report.droppedSummary || "上下文已压缩", {
        kind: "compact",
        source: "compact",
        ...(seqRange.seqFrom != null
          ? { surfaceOp: { op: "replace" as const, start: seqRange.seqFrom, end: seqRange.seqTo! } }
          : {}),
      });
      this.sessions.bumpReplaceGeneration(sessionId);
      this.writeCompactBracket(sessionId, "end", {
        stage: report.stage,
        source: "manual",
        originalTokens: report.originalTokens,
        compressedTokens: report.compressedTokens,
        ...seqRange,
      });
      this.instructionRebaseline.add(sessionId);
      await this.hooks?.postCompact(report.compressedTokens ?? 0);
      await this.afterCompressMaybeRebuild({
        sessionId,
        agentName: session?.agentName,
        stage: report.stage,
        source: "manual",
      });
      return {
        ok: true,
        stage: report.stage,
        originalTokens: report.originalTokens,
        compressedTokens: report.compressedTokens,
        droppedSummary: report.droppedSummary,
        taskBlocks: report.blockIds,
      };
    } catch (e) {
      this.writeCompactBracket(sessionId, "end", { error: String(e), source: "manual" });
      this.compressRetryAfter.set(sessionId, Date.now() + AgentRuntime.COMPRESS_RETRY_MS);
      const msg = String(e);
      return { ok: false, error: msg, code: classifyCompactError(msg) };
    }
  }

  private dynamicSnapshotGate(sessionId: string): DynamicSnapshotGate {
    const key = sessionId || "anon";
    let gate = this.dynamicSnapshotGates.get(key);
    if (!gate) {
      gate = new DynamicSnapshotGate();
      this.dynamicSnapshotGates.set(key, gate);
    }
    return gate;
  }

  /**
   * 上下文窗口：压缩判定、占用条、/context 共用这一个数。
   * 顺序见 llm/context-window.ts —— 预设 → 模型目录 → 旧 maxTokens → 保守兜底。
   */
  private resolveContextLimit(preset?: APIPreset | null): number {
    return resolveContextWindow(
      (preset ?? this.currentPreset) as unknown as Record<string, unknown>,
    ).window;
  }

  private resolveContextWindowInfo(preset?: APIPreset | null): {
    window: number;
    source: ContextWindowSource;
    model?: string;
  } {
    return resolveContextWindow(
      (preset ?? this.currentPreset) as unknown as Record<string, unknown>,
    );
  }

  /**
   * 压缩后的统一记账：占用锚点作废、说明书基线重发、运行时快照重发。
   * 压缩可能把上一份快照剪掉了，不重置门就再也不注入。
   */
  private clearLastOccupancy(sessionId: string): void {
    this.sessionLastOccupancy.delete(sessionId);
    this.sessionOccupancyCleared.add(sessionId);
    this.instructionRebaseline.add(sessionId);
    this.dynamicSnapshotGates.get(sessionId || "anon")?.reset();
  }

  private occupancyFromUsageRecord(
    usage: Record<string, unknown> | null | undefined,
  ): {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheReported: boolean;
  } {
    const n = normalizeCacheUsage(usage);
    if (n.promptTotal > 0 || n.output > 0) {
      return {
        input: n.promptTotal,
        output: n.output,
        cacheRead: n.cacheRead,
        cacheWrite: n.cacheWrite,
        cacheReported: n.reported,
      };
    }
    const parsed = parseUsageTokens(usage ?? undefined);
    return {
      input: parsed.input,
      output: parsed.output,
      cacheRead: 0,
      cacheWrite: 0,
      cacheReported: false,
    };
  }

  private emptyOccupancy(): {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheReported: boolean;
  } {
    return {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cacheReported: false,
    };
  }

  private peekLastOccupancy(sessionId: string): {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheReported: boolean;
  } {
    const mem = this.sessionLastOccupancy.get(sessionId);
    if (mem && (mem.input > 0 || mem.output > 0)) return mem;
    if (this.sessionOccupancyCleared.has(sessionId)) return this.emptyOccupancy();
    try {
      const latest = this.sessions.getLatestUsage(sessionId);
      const usage = this.occupancyFromUsageRecord(latest.usage as Record<string, unknown>);
      if (usage.input > 0 || usage.output > 0) return usage;
    } catch { /* ignore */ }
    return this.emptyOccupancy();
  }

  /** 会话消息的启发式估算；skipFirst 之前的部分已被 usage 锚点算过。 */
  private estimateSessionTokens(sessionId: string, skipFirst = 0): number {
    try {
      const session = this.sessions.load(sessionId);
      const msgs = (session?.messages ?? []) as unknown as SessionMessageLike[];
      let total = 0;
      for (let i = Math.max(0, skipFirst); i < msgs.length; i++) {
        const m = msgs[i];
        if (!m) continue;
        if (String(m.role ?? "") === "system") continue;
        if (m.visibility === "ui") continue;
        total += estimateSessionMessageTokens(m).tokens;
      }
      return total;
    } catch {
      return 0;
    }
  }

  /** 无锚点时的整份估算：system + tools + messages。 */
  private estimateWholeContextTokens(sessionId: string): number {
    const parts = this.sessionLastPromptParts.get(sessionId);
    return (
      estimateSystemTokens(parts?.systemPrompt) +
      estimateToolsTokens(parts?.toolSchemas) +
      this.estimateSessionTokens(sessionId)
    );
  }

  /**
   * 上下文占用：厂商 usage 锚点优先，锚点之后新增的消息用启发式补。
   * 压缩判定和占用条读同一个数 —— 别在别处再长一把尺。
   */
  private resolveSessionContextUsage(
    sessionId: string,
    opts?: { ignoreStaleApi?: boolean },
  ): { used: number; estimated: boolean } {
    const anchored = (row: {
      input: number;
      output: number;
      anchorMessageCount?: number;
    }): { used: number; estimated: boolean } => {
      const base = row.input + row.output;
      const delta =
        row.anchorMessageCount != null
          ? this.estimateSessionTokens(sessionId, row.anchorMessageCount)
          : 0;
      return { used: base + delta, estimated: delta > 0 };
    };

    const mem = this.sessionLastOccupancy.get(sessionId);
    if (mem && (mem.input > 0 || mem.output > 0)) return anchored(mem);

    if (!opts?.ignoreStaleApi && !this.sessionOccupancyCleared.has(sessionId)) {
      const usage = this.peekLastOccupancy(sessionId);
      if (usage.input > 0 || usage.output > 0) {
        this.sessionLastOccupancy.set(sessionId, usage);
        return anchored(usage);
      }
    }

    // 没有任何锚点：整份估算，让第一条消息发出去之前尺子上也有数
    return { used: this.estimateWholeContextTokens(sessionId), estimated: true };
  }

  private resolveSessionContextTokens(
    sessionId: string,
    _history?: unknown,
    opts?: { ignoreStaleApi?: boolean },
  ): number {
    return this.resolveSessionContextUsage(sessionId, opts).used;
  }

  /** 记下上一条消息上显示的 input / output */
  private recordLastOccupancy(
    sessionId: string,
    usage: Record<string, unknown> | null | undefined,
  ): void {
    const parsed = this.occupancyFromUsageRecord(usage);
    if (parsed.input <= 0 && parsed.output <= 0) return;
    let anchorMessageCount: number | undefined;
    try {
      anchorMessageCount = this.sessions.load(sessionId)?.messages?.length;
    } catch { /* 拿不到条数就退回纯锚点 */ }
    this.sessionLastOccupancy.set(sessionId, { ...parsed, anchorMessageCount });
    this.sessionOccupancyCleared.delete(sessionId);
  }

  getUsageStatsForSession(sessionId: string): {
    input: number;
    output: number;
    total: number;
    rounds: number;
    cacheRead?: number;
  } | null {
    try {
      const session = this.sessions.load(sessionId);
      if (!session) return null;
      let input = 0;
      let output = 0;
      let cacheRead = 0;
      let rounds = 0;
      for (const m of session.messages ?? []) {
        const role = (m as { role?: string }).role;
        const usage = (m as { usage?: Record<string, number> }).usage;
        if (usage && (usage.input || usage.output || usage.prompt_tokens)) {
          const parsed = parseUsageTokens(usage as Record<string, unknown>);
          input += parsed.input;
          output += parsed.output;
          cacheRead += Number(usage.cacheRead ?? usage.cache_read_input_tokens ?? 0) || 0;
        }
        if (role === "user") rounds++;
      }
      return { input, output, total: input + output, rounds, cacheRead };
    } catch {
      return null;
    }
  }

  /**
   * /usage 报告：
   * Session: cost · API duration · wall duration · code changes
   * Tokens + Context + Today (TokenTracker)
   */
  getUsageReportForSession(sessionId: string): {
    text: string;
    meta?: Record<string, unknown>;
  } | null {
    try {
      const session = this.sessions.load(sessionId);
      if (!session) return null;

      const stats = this.getUsageStatsForSession(sessionId) ?? {
        input: 0,
        output: 0,
        total: 0,
        rounds: 0,
        cacheRead: 0,
      };
      const ctx = this.getContextSnapshotForSession(sessionId);

      // wall / API duration
      const createdAt = Date.parse(String((session as { createdAt?: string }).createdAt ?? "")) || Date.now();
      const wallMs = Math.max(0, Date.now() - createdAt);
      let apiMs = 0;
      for (const m of session.messages ?? []) {
        const d = Number((m as { duration?: number }).duration ?? 0);
        if (d > 0) apiMs += d;
      }

      // cost from TokenTracker today + session estimate via pricing
      const agentName = session.agentName || "coding";
      const preset = (this.currentPreset ?? {}) as Record<string, unknown>;
      const tracker = this.createTokenTrackerFn(this.maouRoot, agentName, preset);
      const daily = tracker.getDailySummary();
      const pricing = (preset.pricing as {
        input_price?: number;
        output_price?: number;
        cache_hit_price?: number;
        currency?: string;
      } | undefined) ?? {};
      const ip = Number(pricing.input_price ?? 0);
      const op = Number(pricing.output_price ?? 0);
      const cp = Number(pricing.cache_hit_price ?? 0);
      const currency = String(pricing.currency ?? "USD").toUpperCase();
      const cache = stats.cacheRead ?? 0;
      const effectiveIn = Math.max(0, stats.input - cache);
      let sessionCost =
        (effectiveIn / 1e6) * ip + (stats.output / 1e6) * op + (cache / 1e6) * cp;
      // 无 pricing 时给 0 并标注 estimate
      const hasPricing = ip > 0 || op > 0 || cp > 0;
      if (!hasPricing) sessionCost = 0;

      // code changes: git diff --numstat
      let added = 0;
      let removed = 0;
      try {
        const out = execSync(
          "git diff --numstat HEAD 2>/dev/null || git diff --numstat 2>/dev/null || true",
          { cwd: this.projectRoot, encoding: "utf-8", timeout: 3000 },
        );
        for (const line of out.split("\n")) {
          const m = line.trim().match(/^(\d+)\s+(\d+)\s+/);
          if (!m) continue;
          added += parseInt(m[1]!, 10) || 0;
          removed += parseInt(m[2]!, 10) || 0;
        }
      } catch {
        /* no git */
      }

      const fmtDur = (ms: number) => {
        if (ms < 1000) return `${ms}ms`;
        const s = ms / 1000;
        if (s < 60) return `${s.toFixed(1)}s`;
        const m = Math.floor(s / 60);
        const rs = s - m * 60;
        if (m < 60) return `${m}m ${rs.toFixed(1)}s`;
        const h = Math.floor(m / 60);
        const rm = m - h * 60;
        return `${h}h ${rm}m ${Math.floor(rs)}s`;
      };

      const costStr = hasPricing
        ? `${currency === "USD" ? "$" : currency + " "}${sessionCost.toFixed(4)}`
        : "(set preset.pricing for estimate)";

      const bar = (pct: number, w = 24) => {
        const f = Math.round(Math.min(1, Math.max(0, pct / 100)) * w);
        return "█".repeat(f) + "░".repeat(Math.max(0, w - f));
      };

      const lines: string[] = [
        "Usage",
        "",
        "Session",
        `  Total cost:            ${costStr}`,
        `  Total duration (API):  ${fmtDur(apiMs)}`,
        `  Total duration (wall): ${fmtDur(wallMs)}`,
        `  Total code changes:    ${added} lines added, ${removed} lines removed`,
        `  Rounds:                ${stats.rounds}`,
        "",
        "Tokens (this session)",
        `  Input:                 ${stats.input.toLocaleString()}`,
        `  Output:                ${stats.output.toLocaleString()}`,
        `  Cache read:            ${(stats.cacheRead ?? 0).toLocaleString()}`,
        `  Total:                 ${stats.total.toLocaleString()}`,
      ];

      if (ctx) {
        lines.push(
          "",
          "Context window",
          `  ${bar(ctx.pct)} ${ctx.pct.toFixed(1)}%`,
          `  Used:                 ${ctx.used.toLocaleString()} / ${ctx.max.toLocaleString()} (last in ${ctx.lastInput.toLocaleString()} + out ${ctx.lastOutput.toLocaleString()})`,
          `  Remaining:            ${ctx.remaining.toLocaleString()}`,
          `  Thresholds:           compact ${ctx.compactAt}% · summary ${ctx.summaryAt}% · archive ${ctx.archiveAt}%`,
          "",
          "Composition (heuristic)",
          formatContextBreakdownBlock(ctx.breakdown),
        );
      }

      if (daily && (daily.total_input_tokens || daily.total_output_tokens || daily.total_cost)) {
        lines.push(
          "",
          "Today (this agent, local TokenTracker)",
          `  Input:                 ${(daily.total_input_tokens ?? 0).toLocaleString()}`,
          `  Output:                ${(daily.total_output_tokens ?? 0).toLocaleString()}`,
          `  Cache hit:             ${(daily.total_cache_hit_tokens ?? 0).toLocaleString()} (${((daily.cache_hit_rate ?? 0) * 100).toFixed(1)}%)`,
          `  Est. cost:             ${daily.total_cost ?? 0} ${currency}`,
          `  Records:               ${daily.record_count ?? 0}`,
        );
      }

      lines.push(
        "",
        "Note: context used is last message input+output. Session totals sum logged usage.",
        "Subscription plan bars (5h/weekly) require vendor account API — not available for raw OpenAI-compatible keys.",
      );

      return {
        text: lines.join("\n"),
        meta: {
          usage: true,
          sessionCost,
          wallMs,
          apiMs,
          added,
          removed,
          ...stats,
          context: ctx ?? undefined,
        },
      };
    } catch {
      return null;
    }
  }

  getContextSnapshotForSession(sessionId: string): {
    used: number;
    max: number;
    pct: number;
    remaining: number;
    compactAt: number;
    summaryAt: number;
    archiveAt: number;
    lastInput: number;
    lastOutput: number;
    lastCacheRead: number;
    lastCacheWrite: number;
    usedIsEstimate: boolean;
    windowSource: ContextWindowSource;
    windowModel?: string;
    breakdown: ContextBreakdown;
  } | null {
    try {
      const session = this.sessions.load(sessionId);
      if (!session) return null;
      const last = this.peekLastOccupancy(sessionId);
      // 与压缩判定同一个数：锚点 + 锚点后新消息的估算
      const occ = this.resolveSessionContextUsage(sessionId);
      const used = occ.used;
      const win = this.resolveContextWindowInfo();
      const max = win.window;
      const pct = max > 0 ? (used / max) * 100 : 0;
      const parts = this.sessionLastPromptParts.get(sessionId);
      const breakdown = composeContextBreakdown({
        window: max,
        used,
        usedIsEstimate: occ.estimated,
        promptTotal: last.input,
        output: last.output,
        cacheRead: last.cacheRead,
        cacheWrite: last.cacheWrite,
        cacheReported: last.cacheReported,
        systemText: parts?.systemPrompt,
        toolSchemas: parts?.toolSchemas,
        messages: session.messages ?? [],
        toolCount: parts?.toolCount,
        skillCount: parts?.skillCount,
        mcpCount: parts?.mcpCount,
      });
      return {
        used,
        max,
        pct,
        remaining: Math.max(0, max - used),
        compactAt: CONTEXT_THRESHOLD_PERCENT,
        summaryAt: 80,
        archiveAt: 90,
        lastInput: last.input,
        lastOutput: last.output,
        lastCacheRead: last.cacheRead,
        lastCacheWrite: last.cacheWrite,
        usedIsEstimate: occ.estimated,
        windowSource: win.source,
        windowModel: win.model,
        breakdown,
      };
    } catch {
      return null;
    }
  }

  private isGoalDriverExempt(sessionId: string): boolean {
    if (SUPERVISOR_MANAGER.isSupervisorSession(sessionId)) return true;
    const session = this.sessions.load(sessionId);
    return Boolean(session?.parentSessionId);
  }

  private shouldContinueGoal(sessionId: string): boolean {
    const goal = sessionGoals.get(this.sessions.sessionDir, sessionId);
    return Boolean(goal && goal.phase === "active" && goal.activation === "armed");
  }

  private reserveGoalRound(sessionId: string): { prompt: string; source: GoalMessageSource } | undefined {
    const goal = sessionGoals.get(this.sessions.sessionDir, sessionId);
    if (!goal || goal.phase !== "active" || goal.activation !== "armed") return undefined;
    if (goal.roundsStarted >= goal.maxGoalRounds) {
      try {
        sessionGoals.block(this.sessions.sessionDir, sessionId, { id: goal.id, revision: goal.revision }, {
          code: "round-limit",
          message: `Goal reached its configured limit of ${goal.maxGoalRounds} rounds.`,
        }, { skipRoundFloor: true });
      } catch { /* already transitioned */ }
      return undefined;
    }
    const state = this.goalDriverState(sessionId, goal.id);
    const round = goal.roundsStarted + 1;
    const last = parseTaskCompletion(this.lastAssistantText(sessionId));
    const progressPercent = last.kind === "percent" ? last.percent : undefined;
    return {
      prompt: renderGoalRoundPrompt(goal, round, {
        progressPercent,
        kind: goalRoundPromptKind(state.closePending),
      }),
      source: { kind: "goal", goalId: goal.id, revision: goal.revision, round },
    };
  }

  private lastAssistantText(sessionId: string): string {
    const msgs = this.sessions.getLlmHistoryMessages(sessionId);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m?.role === "assistant") return String(m.content ?? "");
    }
    return "";
  }

  private goalDriver = new Map<string, {
    goalId: string;
    kickbacks: number;
    closePending?: GoalClosePending;
  }>();

  private goalDriverState(sessionId: string, goalId: string) {
    const current = this.goalDriver.get(sessionId);
    if (!current || current.goalId !== goalId) {
      const next: { goalId: string; kickbacks: number; closePending?: GoalClosePending } = {
        goalId,
        kickbacks: 0,
      };
      this.goalDriver.set(sessionId, next);
      return next;
    }
    return current;
  }

  private clearGoalDriver(sessionId: string): void {
    this.goalDriver.delete(sessionId);
  }

  private settleGoalFromLastAssistant(sessionId: string, extras?: { countKickback?: boolean }): void {
    const goal = sessionGoals.get(this.sessions.sessionDir, sessionId);
    if (!goal || goal.phase !== "active") {
      this.clearGoalDriver(sessionId);
      return;
    }
    const state = this.goalDriverState(sessionId, goal.id);
    const decided = decideGoalSettle({
      pending: state.closePending,
      report: parseTaskCompletion(this.lastAssistantText(sessionId)),
      kickbacks: state.kickbacks,
      countKickback: extras?.countKickback === true,
    });
    state.kickbacks = decided.kickbacks;
    state.closePending = decided.pending;
    if (!decided.apply) return;
    this.clearGoalDriver(sessionId);
    try {
      if (decided.apply.outcome === "failed") {
        sessionGoals.block(
          this.sessions.sessionDir,
          sessionId,
          { id: goal.id, revision: goal.revision },
          { code: "failed", message: "The working agent reported the goal as failed." },
          { skipRoundFloor: true },
        );
      } else {
        sessionGoals.complete(this.sessions.sessionDir, sessionId, {
          id: goal.id,
          revision: goal.revision,
        });
      }
    } catch {
      /* already transitioned */
    }
  }

  private pauseArmedGoal(sessionId: string): void {
    const goal = sessionGoals.get(this.sessions.sessionDir, sessionId);
    if (!goal || goal.phase !== "active" || goal.activation !== "armed") return;
    this.clearGoalDriver(sessionId);
    try {
      sessionGoals.pause(this.sessions.sessionDir, sessionId, { id: goal.id, revision: goal.revision });
    } catch { /* ignore */ }
  }

  private pauseActiveHarness(sessionId: string): void {
    if (!goalHarness.isActive(this.sessions.sessionDir, sessionId)) return;
    try {
      goalHarness.pause(this.sessions.sessionDir, sessionId, "user");
    } catch { /* ignore */ }
  }

  private runGoalRound = new Map<string, GoalMessageSource>();

  private bindGoalPort(sessionId: string) {
    const session = this.sessions.load(sessionId);
    const isRoot = !SUPERVISOR_MANAGER.isSupervisorSession(sessionId) && !session?.parentSessionId;
    const goalRound = this.runGoalRound.get(sessionId);
    const authority = goalRound
      ? { kind: "goal-round" as const, source: goalRound }
      : { kind: "direct-human" as const };
    return bindSessionGoalPort(this.sessions.sessionDir, sessionId, {
      isRootAgent: isRoot,
      authority,
    });
  }

  /**
   * 核心运行循环 —— 异步生成器，yield 流式事件。
   */
  async *run(
    sessionId: string | null | undefined,
    userMessage: string,
    options: RunOptions,
  ): AsyncGenerator<StreamEvent> {
    if (!options.skipGoalDriver) {
      const boot = this.sessions.ensure(sessionId ?? undefined, options.initAgentName);
      yield* this.run(boot.id, userMessage, { ...options, skipGoalDriver: true });
      if (this.isGoalDriverExempt(boot.id)) return;
      this.settleGoalFromLastAssistant(boot.id, { countKickback: false });
      while (this.shouldContinueGoal(boot.id) && !options.abortSignal?.aborted) {
        if (this.messageQueue.size(boot.id) > 0) break;
        const admitted = this.reserveGoalRound(boot.id);
        if (!admitted) break;
        yield* this.run(boot.id, admitted.prompt, {
          ...options,
          skipGoalDriver: true,
          userMessageSource: "goal",
          goalRound: admitted.source,
        });
        this.settleGoalFromLastAssistant(boot.id, { countKickback: true });
        if (options.abortSignal?.aborted) {
          this.pauseArmedGoal(boot.id);
          this.pauseActiveHarness(boot.id);
          break;
        }
      }
      return;
    }

    // task 指令可改写消息；用局部可变变量承接
    let activeUserMessage = userMessage;
    // ── 性能埋点：本次 run 的 profiler（常驻、低开销，定位各阶段耗时）──
    const prof = new Profiler(`run:${(sessionId ?? "new").slice(0, 8)}`);

    // ── 1. 确保 session 存在（新会话首条消息即绑定到 initAgentName，如 coding）──
    const session = prof.sync("ensure_session", () => this.sessions.ensure(sessionId ?? undefined, options.initAgentName));
    sessionId = session.id;
    if (options.goalRound) this.runGoalRound.set(sessionId, options.goalRound);
    else this.runGoalRound.delete(sessionId);
    // 新一轮用户消息：允许「todo 全部完成后」再要一轮收尾
    this._todoFinalReplyGranted.delete(sessionId);
    this.log("info", `[RUN] start session=${sessionId} msg_len=${activeUserMessage.length}`);
    this.sessions.markLive(sessionId);
    {
      const turnBarrier = this.ledgerBarrier(sessionId, "turn/start", {});
      if (!turnBarrier.ok) {
        const reason = ledgerBarrierHuman("turn/start", turnBarrier.reason);
        this.fireErrorHooks({ message: reason, round: 0, reason: "ledger_barrier" });
        yield this.logEvent("error", `[ledger] turn/start 未落盘，拒绝开轮`);
        yield this.event("error", { message: reason, round: 0, blocked: true });
        yield this.event("done", { sessionId, rounds: 0, blocked: true });
        return;
      }
    }

    // pathGuard：RunOptions 优先，否则用 per-session map
    if (options.pathGuard) {
      this.setSessionPathGuard(sessionId, options.pathGuard);
    }

    // ── P1-4 生命周期：adopt agent 并标记 running（main agent 跟踪 + subagent 复用）──
    const lifecycle = AgentLifecycleManager.global();
    const runAgentName = session.agentName || "main";
    lifecycle.adopt(sessionId, runAgentName);
    lifecycle.setStatus(sessionId, "running");
    // P1-3 消息总线：注册 mailbox（让 broadcast / 其他 agent 能向本 session 投递）
    MessageBus.global().register(runAgentName);

    // ── 1. 指令匹配：/xxx 指令直接执行，不走 AI ──
    const commandName = (options.userCommand ?? "").replace(/^\//, "").trim();
    const commandPlain = unwrapAgentSendTag(activeUserMessage).trim();
    const commandInput = commandName
      ? (commandPlain ? `/${commandName} ${commandPlain}` : `/${commandName}`)
      : activeUserMessage;
    const cmdCtx: CommandContext = {
      rawInput: commandInput.trim(),
      args: "",
      sessionId: sessionId!,
      agentName: session.agentName || "main",
      maouRoot: this.maouRoot,
      projectRoot: this.projectRoot,
      runtime: {
        createSession: async (initAgentName?: string) => {
          const created = this.sessions.create(undefined, initAgentName);
          await this.atCacheRebuildPoint({
            reason: "session_new",
            sessionId: created.id,
            agentName: initAgentName ?? created.agentName,
          });
          return created;
        },
        clearSession: async (sid: string) => {
          this.sessions.clearSession(sid);
          applyOnClearSession(sid, this.contextExtensions);
          try { TASK_MANAGER.manage(sid, "delete", null); } catch { /* ignore */ }
          this.messageQueue.clear(sid);
          await this.atCacheRebuildPoint({
            reason: "session_clear",
            sessionId: sid,
            agentName: session.agentName,
          });
        },
        setAgentName: (sid: string, name: string) => {
          try { (this.sessions as { setAgentName?: (id: string, n: string) => void }).setAgentName?.(sid, name); } catch { /* ignore */ }
        },
        clearTaskState: (sid: string) => {
          applyOnClearSession(sid, this.contextExtensions);
          try { TASK_MANAGER.manage(sid, "delete", null); } catch { /* ignore */ }
        },
        clearMessageQueue: (sid: string) => { this.messageQueue.clear(sid); },
        forceCompress: async (sid: string) => this.forceCompressSession(sid),
        getUsageStats: (sid: string) => this.getUsageStatsForSession(sid),
        getUsageReport: (sid: string) => this.getUsageReportForSession(sid),
        getContextSnapshot: (sid: string) => this.getContextSnapshotForSession(sid),
        sessionDir: this.sessions.sessionDir,
        sessionGoal: this.bindGoalPort(sessionId!),
        // 监督模式（独立能力，不由 /ultragoal 或 /goal 启动）
        startSupervisorMode: (mainSessionId: string, agentName: string, chatKey?: string): string => {
          const supervisorSession = this.sessions.create(undefined, agentName);
          // 取主 session 的 agentName 用于 MessageBus 双向寻址
          const mainSession = this.sessions.load(mainSessionId);
          const mainAgentName = mainSession?.agentName ?? "main";
          SUPERVISOR_MANAGER.bind({
            mainSessionId,
            supervisorSessionId: supervisorSession.id,
            supervisorAgentName: agentName,
            mainAgentName,
            chatKey,
          });
          // 注册 MessageBus mailbox：让主 Agent 能 send 给 supervisor，supervisor 也能收到
          MessageBus.global().register(agentName);
          MessageBus.global().register(mainAgentName);
          this.log("info", `[SUPERVISOR] bind main=${mainSessionId}(${mainAgentName}) → supervisor=${supervisorSession.id}(${agentName})`);
          return supervisorSession.id;
        },
        // supervisor_task_control end：解除绑定，返回主 session ID
        endSupervisorMode: (supervisorSessionId: string): string | undefined => {
          const binding = SUPERVISOR_MANAGER.getBySupervisor(supervisorSessionId);
          if (!binding) return undefined;
          const mainSessionId = binding.mainSessionId;
          SUPERVISOR_MANAGER.unbind(mainSessionId);
          this.log("info", `[SUPERVISOR] unbind supervisor=${supervisorSessionId} → main=${mainSessionId}`);
          return mainSessionId;
        },
        abortSignal: options.abortSignal,
      },
    };
    let harnessKickoff = false;
    const cmdResult = await this.commandRegistry.tryExecute(commandInput, cmdCtx);
    if (cmdResult) {
      const meta = cmdResult.meta ?? {};
      // task 模式（如 /init、/goal create|resume）：把指令正文当作用户任务注入，继续走正常 AI 流程
      if (meta.asUserTask && typeof meta.taskPrompt === "string" && meta.taskPrompt.trim()) {
        activeUserMessage = String(meta.taskPrompt);
        harnessKickoff = meta.harnessArmed === true;
        this.log(
          "info",
          `[RUN] 指令任务注入 → ${String(meta.command ?? "").trim() || "task"}（继续 AI）`,
        );
        // fall through to agent loop
      } else {
        // 指令匹配成功，直接返回结果（固定回复 / 脚本输出）
        const effectiveSessionId = (meta.sessionId as string) ?? sessionId!;
        yield this.event("session", { sessionId: effectiveSessionId });
        yield this.event("assistant", { content: cmdResult.content, round: 0 });
        if (meta.compress) {
          yield this.event("context_refresh", { source: "manual", stage: meta.stage });
        }
        yield this.event("done", { sessionId: effectiveSessionId, rounds: 0, ...meta });
        this.log("info", `[RUN] 指令命中 → ${activeUserMessage.trim().split(/\s/)[0]}`);
        return;
      }
    }

    // ── 1a. 内部 AbortController：让 MessageQueue interrupt 模式可以触发 abort ──
    // 合并外部 abortSignal：外部触发 → 内部也 abort；内部触发 → 外部感知不到（但本轮 run 会退出）
    // 注：interrupt_immediately 模式会在 break 处重置 controller（创建新的），让 run 继续下一轮
    let internalController = new AbortController();
    this.abortControllers.set(sessionId, internalController);
    const externalSignal = options.abortSignal;
    const linkExternalAbort = (ctrl: AbortController) => {
      if (!externalSignal) return;
      if (externalSignal.aborted) {
        if (!ctrl.signal.aborted) ctrl.abort("external_already_aborted");
      } else {
        externalSignal.addEventListener("abort", () => {
          if (!ctrl.signal.aborted) ctrl.abort("external_abort");
        }, { once: true });
      }
    };
    linkExternalAbort(internalController);
    // effectiveAbortSignal：内部 controller 的 signal（已合并外部 abort）
    let effectiveAbortSignal: AbortSignal = internalController.signal;

    // 路由权威：显式传了 initAgentName 且与会话当前 agent 不一致 → 重绑定。
    // 修复：旧会话以 main 创建后（如飞书群会话），即便绑定指向 coding 也一直走 main。
    // 飞书每条消息都带 init_agent_name=<绑定agent>，故此处让绑定真正生效。
    if (options.initAgentName && session.agentName !== options.initAgentName) {
      try {
        (this.sessions as { setAgentName?: (id: string, n: string) => void }).setAgentName?.(sessionId!, options.initAgentName);
        session.agentName = options.initAgentName;
        this.log("info", `[RUN] 会话 agent 重绑定 → ${options.initAgentName}`);
      } catch { /* ignore */ }
    }

    const agentName = session.agentName || "main";
    const maouRoot = this.maouRoot;
    // Agent 实例由业务层创建（createAgentFromTemplate），SDK 不自动物化

    // 绑定级 projectRoot 覆盖（飞书 binding.project_root → 覆盖运行时 projectRoot）
    const effectiveProjectRoot = options.bindingProjectRoot || this.projectRoot;

    // ── 从 agent.json 读取 round_limit + promptRoot/entrypoint ──
    const endAgentConfig = prof.start("agent_config");
    let effectiveRoundLimit = this.agentRoundLimit;
    let agentPromptRoot: string = "";
    let agentEntrypoint: string = "system/system.md";
    let effectiveWorkingDir = effectiveProjectRoot;
    let compressionLevel: "off" | "normal" | "aggressive" = "normal";
    let verifyCommand = "";
    const usesProjectAgent = this.agentScope === "project" || Boolean(options.bindingProjectRoot);
    const registry = new AgentRegistry(
      maouRoot,
      usesProjectAgent ? effectiveProjectRoot : undefined,
    );
    // 机器级主 agent（如 ops）只使用 <maouRoot>/agents；显式绑定路径的 project 子 Agent
    // 则在目标项目内解析/物化 agent 配置。
    if (usesProjectAgent) {
      const projectAgentResult = registry.ensureProjectAgent(agentName);
      if (projectAgentResult.created) {
        this.log("info", `[RUN] 项目级 agent '${agentName}' 已物化 → ${projectAgentResult.dir} (${projectAgentResult.reason})`);
      }
    }
    const agentEntry = registry.get(agentName);
    if (!agentEntry) {
      const errMsg = `agent '${agentName}' 不存在（~/.maou/agents/${agentName}/agent.json 缺失）`;
      yield this.logEvent("error", errMsg);
      this.fireErrorHooks({ message: errMsg, round: 0 });
      void this.hooks?.stopFailure({ message: errMsg, round: 0, reason: "agent_missing" });
      yield this.event("error", { message: errMsg, round: 0 });
      yield this.event("done", { sessionId, rounds: 0, error: errMsg });
      return;
    }
    if (typeof agentEntry.round_limit === "number" && agentEntry.round_limit > 0) {
      effectiveRoundLimit = agentEntry.round_limit;
      this.log("info", `[RUN] agent=${agentName} round_limit=${effectiveRoundLimit}`);
    }
    // 思考回灌：RunOptions 覆盖 agent.json，缺省 first_round
    const agentWorkspaceFlag = readAgentWorkspaceInstructions(agentEntry);
    let workspaceInstructionsOn = resolveWorkspaceInstructionsEnabled({
      agent: agentWorkspaceFlag,
    });
    const timeCtxRaw =
      (agentEntry as { timeContext?: { enabled?: boolean; minIntervalMs?: number } }).timeContext ??
      (agentEntry as { time_context?: { enabled?: boolean; minIntervalMs?: number } }).time_context;
    this.timeContextGate = timeCtxRaw?.enabled
      ? new TimeContextGate({
          enabled: true,
          minIntervalMs: timeCtxRaw.minIntervalMs,
        })
      : null;
    const thinkingContextMode: ThinkingContextMode = parseThinkingContextMode(
      options.thinkingContextMode ??
        (agentEntry as { thinking_context_mode?: unknown }).thinking_context_mode,
    );
    this.log("info", `[RUN] agent=${agentName} thinking_context_mode=${thinkingContextMode}`);
    this.microCompactRounds = resolveMicroCompactRounds(
      options.microCompactRounds ?? readAgentMicroCompactRounds(agentEntry as unknown as Record<string, unknown>),
    );
    this.log("info", `[RUN] agent=${agentName} micro_compact_rounds=${this.microCompactRounds}`);
    const tc = (agentEntry as { tool_compression?: string }).tool_compression;
    if (tc === "off" || tc === "normal" || tc === "aggressive") compressionLevel = tc;
    const vc = (agentEntry as { verify_command?: string }).verify_command;
    if (typeof vc === "string" && vc.trim()) verifyCommand = vc.trim();
    const tm = (agentEntry as { terminal_mode?: string }).terminal_mode;
    if (tm === "normal" || tm === "auto" || tm === "yolo") {
      try { setTerminalMode(agentName, tm); } catch { /* ignore */ }
    }
    const tb = (agentEntry as { terminalMode?: string; terminal_backend?: string }).terminalMode
      ?? (agentEntry as { terminal_backend?: string }).terminal_backend;
    if (tb === "full" || tb === "mini") {
      this.agentTerminalBackend = tb;
      try { setAgentTerminalMode(tb); } catch { /* ignore */ }
    } else {
      this.agentTerminalBackend = undefined;
      try { setAgentTerminalMode(undefined); } catch { /* ignore */ }
    }
    const cuRaw = (agentEntry as { computerUse?: { mode?: string }; computerUseMode?: string }).computerUse?.mode
      ?? (agentEntry as { computerUseMode?: string }).computerUseMode;
    const cu = typeof cuRaw === "string" ? cuRaw.trim().toLowerCase() : "";
    this.agentComputerUseMode = cu === "auto" || cu === "ax" || cu === "pixels" ? cu : undefined;
    // working_dir：优先 agent.json 配置，否则 projectRoot（process.cwd）
    const agentWorkingDir = (agentEntry as { working_dir?: string }).working_dir;
    if (agentWorkingDir && typeof agentWorkingDir === "string" && agentWorkingDir.trim()) {
      effectiveWorkingDir = agentWorkingDir.trim();
    }
    this.effectiveWorkingDir = effectiveWorkingDir;
    // promptRoot：必须存在 prompt/system/system.md，否则抛错
    try {
      agentPromptRoot = registry.getPromptRoot(agentName);
      agentEntrypoint = registry.getPromptEntrypoint(agentName);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      yield this.logEvent("error", errMsg);
      this.fireErrorHooks({ message: errMsg, round: 0 });
      void this.hooks?.stopFailure({ message: errMsg, round: 0, reason: "prompt_root" });
      yield this.event("error", { message: errMsg, round: 0 });
      yield this.event("done", { sessionId, rounds: 0, error: errMsg });
      return;
    }

    // ── 1a. 清理 session-scoped 条目 ──
    endAgentConfig();
    const endSessionCleanup = prof.start("session_cleanup");
    try {
      const cleaned = this.tools.cleanupSession(sessionId);
      if (cleaned > 0) {
        this.log("info", `[CLEANUP] ${cleaned} 个工具清理了 session 条目`);
      }
    } catch (err) {
      this.log("warning", `[CLEANUP] session 清理失败: ${err}`);
    }

    // ── 1a2. 清理常驻终端 ──
    try {
      cleanupAgentTerminals(agentName);
      this.log("info", `[CLEANUP] 常驻终端已终止并释放`);
    } catch (err) {
      this.log("warning", `[CLEANUP] 终端清理失败: ${err}`);
    }

    // ── 1b. 沙箱快照 ──
    endSessionCleanup();
    const endSnapshot = prof.start("sandbox_snapshot");
    this.snapshotBeforeRun(maouRoot);
    endSnapshot();

    // yield session 事件
    yield this.event("session", { sessionId });
    await this.ensureAgentHooksLoaded(agentName);
    await this.hooks?.sessionStart(sessionId!);

    // ── 2. 编译 prompt ──
    yield this.event("status", { text: "编译 Prompt..." });
    yield this.logEvent("info", "开始编译 Prompt");

    // 每个 agent 必须自带 prompt/system/system.md（getPromptRoot 已校验）。
    // 每个 run 创建独立 PromptCompiler，杜绝并发竞态。
    let systemPrompt: string;
    let runCompiler: PromptCompiler | null = null;
    runCompiler = new PromptCompiler({ promptRoot: agentPromptRoot, projectRoot: effectiveWorkingDir, entrypoint: agentEntrypoint });
    const endCompile = prof.start("compile_prompt");
    try {
      systemPrompt = runCompiler.compile();
    } catch (err) {
      const errMsg = `Prompt 编译失败: ${err}`;
      this.log("error", errMsg);
      this.fireErrorHooks({ message: errMsg, round: 0 });
      void this.hooks?.stopFailure({ message: errMsg, round: 0, reason: "prompt_compile" });
      yield this.event("error", { message: errMsg, round: 0 });
      yield this.event("done", { sessionId, rounds: 0, error: errMsg });
      return;
    } finally {
      endCompile();
    }
    yield this.logEvent("info", `Prompt 编译完成，长度=${systemPrompt.length}`);

    // ── 2a. 编译 before_user（before_user/before_user.md）──
    let beforeUserContent = "";
    const endBeforeUser = prof.start("compile_before_user");
    try {
      if (runCompiler && agentPromptRoot && existsSync(join(agentPromptRoot, "before_user", "before_user.md"))) {
        beforeUserContent = runCompiler.compile("before_user/before_user.md");
        yield this.logEvent("info", `before_user 编译完成，长度=${beforeUserContent.length}`);
      }
    } catch {
      // 不存在则静默跳过
    } finally {
      endBeforeUser();
    }

    // ── eve: 加载 compression 提示词（compression/compression.md），压缩时覆盖默认 summarizer prompt ──
    let compressionPromptText = "";
    try {
      if (runCompiler && agentPromptRoot && existsSync(join(agentPromptRoot, "compression", "compression.md"))) {
        compressionPromptText = runCompiler.compile("compression/compression.md").trim();
      }
    } catch { /* 不存在则用默认 */ }
    // 每个 run 包一层 summarizer，把本 agent 的 compression 提示词注入（race-safe，不改共享态）
    // 优先级：
    //   1. 显式注入 summarizer（harness 层提供）—— 包一层 compression prompt
    //   2. auxModelCaller 自动构建 summarizer —— 用辅助 preset，独立 token 统计
    //   3. 都没有 → undefined（上游回退确定性 truncate）
    const runSummarizer: Summarizer | undefined = (() => {
      if (this.summarizer) {
        return compressionPromptText
          ? (input: Parameters<Summarizer>[0]) => this.summarizer!({ ...input, prompt: compressionPromptText })
          : this.summarizer;
      }
      if (this.auxModelCaller) {
        const aux = this.auxModelCaller;
        const resolveFn = this.resolveHelperPresetFn;
        const mainPreset = options.preset;
        const sid = sessionId ?? "";
        return async (input: Parameters<Summarizer>[0]) => {
          // 默认压缩提示词（agent 的 compression.md 优先，由调用方通过 input.prompt 注入）
          const sys = (typeof input.prompt === "string" && input.prompt.trim())
            ? input.prompt
            : (input.kind === "micro"
              ? "你是上下文压缩器。把下面这段对话压成 2-4 句中文要点，保留关键决策/结论/未完成事项，只输出要点。"
              : "你是上下文压缩器。把下面这段任务对话压成简洁中文摘要，保留：目标、关键决策、改动过的文件、命令结果、未完成事项、重要结论。只输出摘要文本，不要寒暄。");
          const transcript = input.messages
            .map((m) => `[${m.role}] ${String(m.content ?? "").slice(0, 4000)}`)
            .join("\n")
            .slice(0, 24000);
          const helperPreset = resolveFn ? resolveFn(agentName, mainPreset) : mainPreset;
          const result = await aux.callText(
            {
              preset: helperPreset,
              systemPrompt: sys,
              userPrompt: transcript,
              abortSignal: options.abortSignal,
              context: { sessionId: sid, tag: `compressor:${input.kind}` },
            },
            mainPreset, // fallback 主 preset
          );
          return result.content; // 失败时为空串 → 上游回退 truncate
        };
      }
      return undefined;
    })();

    // ── 注入实际工作目录（让 agent 知道自己驻扎在哪、所有相对路径基于此）──
    // effectiveWorkingDir 已在上方从 agent.json working_dir 计算
    systemPrompt = `${systemPrompt}\n\n<workspace>\n你当前的工作目录（所有文件读写、终端命令、相对路径均以此为根）：${effectiveWorkingDir}\n</workspace>`;

    // ── eve: 渲染 PREVIEW（把 system/before_user/compression 的最终渲染结果写到 prompt/PREVIEW/，调试用）──
    // 注意：要传「实例目录」而非 agentPromptRoot 的父目录——引用模式下 agentPromptRoot 是模板目录，
    // 父目录会指错。实例目录优先项目级 .maou/agents/<name>，回退全局 ~/.maou/agents/<name>。
    try {
      if (agentPromptRoot) {
        const instDir =
          (registry.projectAgentsDir && existsSync(join(registry.projectAgentsDir, agentName)))
            ? join(registry.projectAgentsDir, agentName)
            : join(registry.agentsDir, agentName);
        renderAgentPreview(instDir, this.projectRoot);
        // 监听模板源文件变化，自动重新渲染 PREVIEW（设计：检测到内容变了就渲染）
        watchAgentPreview(instDir, this.projectRoot);
      }
    } catch { /* 渲染失败不影响主流程 */ }

    // ── 2b. 编译动态注入内容（board / pending / agents 状态 / task 规划） ──
    const dynamicInjections = prof.sync("dynamic_context", () => compileDynamicContext(maouRoot, agentName, sessionId!));

    // ── 2b2. Skill 注入（修复：原本 SkillContextManager 从未被 runtime 调用 → 技能列表从不进提示词）──
    // compile() 首轮产出 bakedContent（skill 索引 → 文件缓存区 / 稳定前缀，缓存断点之前），
    // 后续轮产出 incrementalContent（<skill_update> → 上下文动态区）。
    let skillManager: SkillContextManager | null = null;
    let skillCount = 0;
    try {
      skillManager = this.createSkillManagerFn(agentName, this.projectRoot, maouRoot);
    } catch (err) {
      this.log("warning", `[SKILL] 管理器创建失败: ${err}`);
      skillManager = null;
    }

    // ── 2c. 加载 OUTPUT.jsonc 派生 jsonSettings（用于 response_format 强制 JSON 输出） ──
    // 开关：preset.output_format === "none" 时彻底禁用结构化 JSON 输出（跳过 OUTPUT.jsonc），
    // 改走纯原生 tool calling —— 对工具调用判断力弱的模型更友好（避免强制 JSON 引发过度调用）。
    let outputJsonSettings: Record<string, unknown> | null = null;
    const structuredDisabled = (options.preset as { output_format?: string }).output_format === "none";
    if (structuredDisabled) {
      yield this.logEvent("info", "output_format=none：已禁用结构化 JSON 输出，使用原生 tool calling");
    } else {
      try {
        // OUTPUT.jsonc 只在 agent 根目录下查找
        const outputPaths = [
          join(maouRoot, "agents", agentName, "OUTPUT.jsonc"),
        ];
        for (const outputFile of outputPaths) {
          if (existsSync(outputFile)) {
            const outputText = readFileSync(outputFile, "utf-8");
            outputJsonSettings = deriveJsonSettings(outputText) as unknown as Record<string, unknown>;
            yield this.logEvent("info", "OUTPUT.jsonc 已加载，启用 JSON 结构化输出");
            break;
          }
        }
      } catch (err) {
        yield this.logEvent("warning", `OUTPUT.jsonc 加载失败: ${err}`);
      }
    }

    const initialPreset = options.preset;
    // 初始化 currentPreset：支持运行时 switchPreset() 在下一轮生效。
    // 循环内统一从 this.currentPreset 取当前 preset（而非 options.preset 固定值）。
    this.currentPreset = initialPreset;
    let lastPreset: APIPreset = initialPreset;
    const autoFormat = options.autoFormat ?? true;
    const agentMode = options.agentMode ?? true;
    const sandboxMode = options.sandboxMode ?? "normal";
    const stream = options.stream ?? true;

    yield this.logEvent(
      "info",
      `运行模式: ${agentMode ? "Agent Mode" : "Single Turn"} / auto_format=${autoFormat} / stream=${stream}`,
    );

    // ── 初始化工具调用依赖 ──
    const endToolSetup = prof.start("tool_setup");
    // 文件即 Agent：加载 agent 级工具目录
    this.tools.clearAgentToolsDirs();
    try {
      const agentToolsDir = join(maouRoot, "agents", agentName, "tools");
      this.tools.addAgentToolsDir(agentToolsDir);
    } catch { /* ignore */ }

    // ── 文件即子 Agent：扫描 subagents/ 目录，动态注册 subagent_<name> 工具 ──
    // SubagentRegistry.loadForAgent 扫描 agents/<name>/subagents/<child>/ 目录，
    // 发现子 Agent 后通过 createSubagentDelegateTool 动态注册工具。
    // LLM 调用 subagent_<name> 时，工具内部调 ctx.subagentExecutor.fork() 委托任务。
    try {
      // 清理上次 run 注册的 subagent_<name> 工具（子 Agent 目录可能已变更）
      for (const oldName of this._registeredSubagentTools) {
        this.tools.unregister(oldName);
      }
      this._registeredSubagentTools.clear();

      // ── P2-4 清理上次 run 注册的 MCP proxy 工具（跨 session 不残留）──
      for (const oldName of this._registeredMcpProxyTools) {
        this.tools.unregister(oldName);
      }
      this._registeredMcpProxyTools.clear();

      for (const oldName of this._registeredSupervisorTools) {
        this.tools.unregister(oldName);
      }
      this._registeredSupervisorTools.clear();
      if (SUPERVISOR_MANAGER.isSupervisorSession(sessionId!)) {
        registerSupervisorHarnessTools(this.tools);
        for (const name of SUPERVISOR_HARNESS_TOOL_NAMES) {
          this._registeredSupervisorTools.add(name);
        }
        this.log("info", `[SUPERVISOR] 已注册 harness 工具: ${SUPERVISOR_HARNESS_TOOL_NAMES.join(", ")}`);
        yield this.logEvent("info", "已注册监督工具（仅本 session）");
      }

      const subReg = new SubagentRegistry(maouRoot);
      const count = subReg.loadForAgent(agentName);
      if (count > 0) {
        for (const sub of subReg.listAll()) {
          const tool = createSubagentDelegateTool(sub.name, sub.description);
          this.tools.register(tool);
          this._registeredSubagentTools.add(`subagent_${sub.name}`);
        }
        this.log("info", `[SUBAGENT] 发现 ${count} 个子 Agent: ${subReg.listAll().map(s => s.name).join(", ")}`);
        yield this.logEvent("info", `已注册 ${count} 个子 Agent 委托工具（subagent_*）`);
      }
    } catch (err) {
      this.log("warning", `[SUBAGENT] 子 Agent 扫描/注册失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── MCP host：加载 connections/ 并注册 mcp__* 工具 ──
    if (this.mcpManager) {
      try {
        if (this.mcpAutoLoad) {
          const result = await this.mcpManager.ensureLoadedForAgent(maouRoot, agentName, {
            projectRoot: effectiveProjectRoot,
          });
          if (result.discovered > 0 || result.ok > 0) {
            this.log(
              "info",
              `[MCP] agent=${agentName} discovered=${result.discovered} connected=${result.ok} failed=${result.failed}`,
            );
            if (result.ok > 0) {
              yield this.logEvent(
                "info",
                `MCP：已连接 ${result.ok} 个 server` +
                  (result.failed > 0 ? `（${result.failed} 个失败）` : ""),
              );
            } else if (result.failed > 0) {
              yield this.logEvent("warning", `MCP：${result.failed} 个连接失败（fail-closed）`);
            }
          }
        }
        // MCP 暴露策略：agent.json mcp_tool_strategy（coding 默认 gateway）
        const { readMcpToolStrategyFromAgentConfig } = await import("./mcp/strategy.js");
        const mcpStrategy = readMcpToolStrategyFromAgentConfig(
          agentEntry as unknown as Record<string, unknown>,
          // coding / ops 默认 gateway（提示词与元工具 mcp 对齐）；其它 agent 默认 flat
          agentName === "coding" || agentName === "ops" || agentEntry.role === "ops"
            ? "gateway"
            : "flat",
        );
        this.mcpManager.setToolExposureStrategy(mcpStrategy);
        this.log("info", `[MCP] tool exposure strategy=${mcpStrategy} (agent=${agentName})`);

        // 同步工具表（即使未新连接，也刷新 registry 与 subagent 继承）
        const names = this.mcpManager.syncToRegistry(this.tools, mcpStrategy);
        this._registeredMcpHostTools = new Set(names);
        this.syncMcpToSubagentExecutor();
        if (names.length > 0) {
          this.log(
            "info",
            `[MCP] registered ${names.length} LLM-visible tool(s): ${names.slice(0, 8).join(", ")}${names.length > 8 ? "…" : ""}` +
              (mcpStrategy === "gateway"
                ? ` [gateway; ${this.mcpManager.listDescriptors().length} underlying MCP tools]`
                : ""),
          );
        }

        // MCP catalog → system prompt（辅通道）
        // gateway 模式：catalog 帮助模型知道有 MCP；真正调用走元工具 `mcp`
        // flat 模式：catalog + 全量 tool schemas
        try {
          // agent.json: mcp_catalog_detail = full | servers_only | auto
          // auto：指令总数≤25 注入完整 tool 列表，否则仅服务名（专门 MCP agent 可设 full 强制全量）
          const agentRec = agentEntry as unknown as Record<string, unknown>;
          const rawDetail = agentRec?.mcp_catalog_detail
            ?? (agentRec?.mcp as { catalog_detail?: string } | undefined)?.catalog_detail;
          const catalogDetail =
            rawDetail === "full" || rawDetail === "servers_only" || rawDetail === "auto"
              ? rawDetail
              : "auto";
          const rawThr =
            agentRec?.mcp_catalog_full_threshold
            ?? (agentRec?.mcp as { full_inject_threshold?: unknown } | undefined)
              ?.full_inject_threshold;
          const thrNum = Number(rawThr);
          const fullInjectThreshold =
            Number.isFinite(thrNum) && thrNum > 0 ? thrNum : 25;
          const catalog = await this.mcpManager.buildCatalogPrompt({
            enrichLists: true,
            detail: catalogDetail,
            fullInjectThreshold,
          });
          if (catalog) {
            let catalogBlock = catalog;
            if (mcpStrategy === "gateway") {
              catalogBlock =
                catalog +
                "\n\n<mcp_gateway_hint>\n" +
                "MCP tools are NOT each listed in your tools array. Use the single tool named exactly `mcp` " +
                "(never invent a tool named `mcp list` or `mcp__...` as top-level tools).\n" +
                "  list — one shot: full description + parameters for every matching tool\n" +
                "  call — execute mcp__server__tool via the mcp tool\n" +
                "Examples:\n" +
                "  mcp({ action: \"list\" })\n" +
                "  mcp({ action: \"list\", server: \"my-server\" })\n" +
                "  mcp({ action: \"call\", name: \"mcp__server__tool\", arguments: {...} })\n" +
                "</mcp_gateway_hint>";
            }
            systemPrompt = `${systemPrompt}\n\n${catalogBlock}`;
            yield this.logEvent(
              "info",
              `已注入 MCP catalog 到系统提示词（strategy=${mcpStrategy}, catalog_detail=${catalogDetail}, llm_tools=${names.length}, underlying=${this.mcpManager.listDescriptors().length}, servers=${this.mcpManager.sessionCount}）`,
            );
          }
        } catch (catErr) {
          this.log(
            "warning",
            `[MCP] catalog 注入失败: ${catErr instanceof Error ? catErr.message : String(catErr)}`,
          );
        }
      } catch (err) {
        this.log(
          "warning",
          `[MCP] 加载/同步失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 合并白名单：PERMISSION.jsonc ∩ agent.json tools
    // PERMISSION.jsonc 只在 agent 根目录下
    let toolWhitelist: Set<string> | undefined;
    try {
      const permPaths = [
        join(maouRoot, "agents", agentName, "PERMISSION.jsonc"),
      ];
      for (const permFile of permPaths) {
        if (existsSync(permFile)) {
          const perm = JSON.parse(readFileSync(permFile, "utf-8"));
          if (Array.isArray(perm.tool_whitelist)) {
            toolWhitelist = new Set(perm.tool_whitelist);
            break;
          }
        }
      }
    } catch { /* ignore */ }

    // agent.json tools 白名单（与 PERMISSION 取交集）。
    // project 子 Agent 可通过 bindingProjectRoot 切换到目标项目，即使母 Agent 是 global。
    try {
      const registry = new AgentRegistry(
        maouRoot,
        this.agentScope === "project" || options.bindingProjectRoot
          ? effectiveProjectRoot
          : undefined,
      );
      const agentEntry = registry.get(agentName);
      if (agentEntry?.tools && Array.isArray(agentEntry.tools)) {
        if (agentEntry.tools.includes("*")) {
          // "*" 表示该 agent 允许全部工具：不缩窄 PERMISSION 白名单（若 PERMISSION 也是 * 或不存在则全允许）
          // 这里不改动 toolWhitelist
        } else {
          const agentToolSet = new Set(agentEntry.tools as string[]);
          if (toolWhitelist) {
            // 取交集
            const intersection = new Set([...toolWhitelist].filter(x => agentToolSet.has(x)));
            toolWhitelist = intersection.size > 0 ? intersection : undefined;
          } else {
            toolWhitelist = agentToolSet;
          }
        }
      }
    } catch { /* ignore */ }

    // 子 Agent 委托工具纳入白名单：若 agent 配置了白名单（非 *），需把已注册的
    // subagent_<name> 工具加入白名单，否则 nativeToolSchemas 会过滤掉它们。
    if (toolWhitelist && this._registeredSubagentTools.size > 0) {
      for (const name of this._registeredSubagentTools) {
        toolWhitelist.add(name);
      }
    }
    if (toolWhitelist && !this.isGoalDriverExempt(sessionId!)) {
      for (const name of ["get_goal", "create_goal", "update_goal", "submit_plan"] as const) {
        toolWhitelist.add(name);
      }
    }
    if (toolWhitelist && this._registeredSupervisorTools.size > 0) {
      for (const name of this._registeredSupervisorTools) {
        toolWhitelist.add(name);
      }
    }

    // ── 子 Agent kind 工具白名单覆盖（SubagentExecutor → runFn → 此处）──
    // helper 单轮：override=[] → 强制无 tool schemas
    // task/project：override=预设/显式白名单，与既有白名单取交集
    if (options.toolWhitelistOverride !== undefined) {
      const override = options.toolWhitelistOverride;
      if (override.length === 0) {
        toolWhitelist = new Set<string>(["report_to_parent"]);
      } else {
        const overrideSet = new Set(override);
        if (toolWhitelist) {
          const intersection = new Set([...toolWhitelist].filter((x) => overrideSet.has(x)));
          // 若交集为空仍用 override（子任务预设优先于母 PERMISSION 过窄）
          toolWhitelist = intersection.size > 0 ? intersection : overrideSet;
        } else {
          toolWhitelist = overrideSet;
        }
      }
    }

    // ── P2-4 MCP proxy 工具纳入白名单 ──
    // fork 子 Agent 时（inheritMcp !== false），executor 传 mcpProxyTools，
    // runFn 调 registerMcpProxyTools() 注册后把工具名通过 RunOptions.mcpProxyToolNames 传入。
    // 若 agent 配置了白名单（非 *），需把 proxy 工具名加入白名单，否则被 nativeToolSchemas 过滤。
    // helper 单轮（空 override）不加入 MCP proxy。
    const mcpProxyNames = options.mcpProxyToolNames ?? [];
    const stripAllTools = options.toolWhitelistOverride?.length === 0;
    if (toolWhitelist && mcpProxyNames.length > 0 && !stripAllTools) {
      for (const name of mcpProxyNames) {
        toolWhitelist.add(name);
      }
    }

    // ── MCP host 工具纳入白名单 ──
    // flat：mcp__* 全量；gateway：仅元工具 `mcp`
    // 与 subagent_* 相同：有白名单时必须显式加入，否则 nativeToolSchemas 过滤掉。
    if (toolWhitelist && this._registeredMcpHostTools.size > 0 && !stripAllTools) {
      for (const name of this._registeredMcpHostTools) {
        toolWhitelist.add(name);
      }
    }

    try {
      if (skillManager) {
        skillManager.setAvailableTools(toolWhitelist ? [...toolWhitelist] : null);
        const skillFirst = skillManager.compile();
        skillCount = skillFirst.currentSkills.size;
        if (skillFirst.bakedContent) {
          systemPrompt = `${systemPrompt}\n\n${skillFirst.bakedContent}`;
          yield this.logEvent("info", "已注入可用 skill 列表到系统提示词");
        }
      }
    } catch (err) {
      this.log("warning", `[SKILL] 注入失败: ${err}`);
    }

    if (
      workspaceInstructionsOn &&
      sessionId &&
      this.fileDiffWatch &&
      (this.agentScope === "project" || options.bindingProjectRoot)
    ) {
      try {
        this.fileDiffWatch.pinPaths(sessionId, instructionRelPaths(), "instruction");
      } catch { /* ignore */ }
    }

    const planActive = sessionPlan.isActive(this.sessions.sessionDir, sessionId!);
    const planFile = sessionPlanFile(this.sessions.sessionDir, sessionId!);
    const childSession = Boolean(
      this.sessions.readMeta(sessionId!)?.parent_session_id ||
        sessionId!.includes("::fork::"),
    );
    if (toolWhitelist && childSession) toolWhitelist.add("report_to_parent");
    let toolSchemas = stripAllTools
      ? (this.tools.nativeToolSchemas?.(new Set(["report_to_parent"])) ?? [])
      : (this.tools.nativeToolSchemas?.(toolWhitelist) ?? null);
    if (toolSchemas) {
      toolSchemas = toolSchemas.filter((schema) => {
        const name = String((schema as { name?: string }).name ?? "");
        if (!childSession && name === "report_to_parent") return false;
        if (childSession && name === "ask_user") return false;
        return true;
      });
    }
    // nativeToolCalling 在循环内按当前 preset 每轮重算（支持 switchPreset 切换模型后
    // 不同 tool-calling 能力）。toolSchemas 固定不变（白名单决定）。

    // ── 工具提示词注入（TOOL.md → systemPrompt）──
    // 每个工具目录下若有 TOOL.md，其内容作为该工具的补充说明注入系统提示词
    // 仅注入白名单内工具的提示词，避免无关工具干扰 AI
    // 首次调用时启动文件监听（热编译），后续 TOOL.md 变更自动更新缓存
    try {
      if (!this._toolPromptWatchStarted) {
        (this.tools as { startToolPromptWatch?: () => void }).startToolPromptWatch?.();
        this._toolPromptWatchStarted = true;
      }
      const toolsAny = this.tools as any;
      const toolPrompts: Map<string, string> | undefined = toolsAny.getToolPrompts?.(toolWhitelist);
      this.log("info", `[TOOL_PROMPT] getToolPrompts called, whitelist=${toolWhitelist ? [...toolWhitelist].join(',') : 'all'}, result=${toolPrompts ? toolPrompts.size : 'undefined'}`);
      if (toolPrompts && toolPrompts.size > 0) {
        let toolPromptSection = "<tool_instructions>\n以下是你可使用的工具的补充说明，请在调用对应工具时遵循这些指引：\n";
        for (const [toolName, prompt] of toolPrompts) {
          toolPromptSection += `\n<tool name="${toolName}">\n${prompt}\n</tool>\n`;
        }
        toolPromptSection += "\n</tool_instructions>";
        systemPrompt = `${systemPrompt}\n\n${toolPromptSection}`;
        yield this.logEvent("info", `已注入 ${toolPrompts.size} 个工具提示词到系统提示词`);
      }
    } catch (err) {
      this.log("warning", `[TOOL_PROMPT] 注入失败: ${err}`);
    }
    if (planActive) {
      const planSnap = sessionPlan.get(this.sessions.sessionDir, sessionId!);
      systemPrompt = `${systemPrompt}\n\n${renderPlanPolicy(planFile, planSnap?.objective)}`;
      yield this.logEvent("info", "已注入计划模式指引");
    }
    endToolSetup();

    {
      const refresh = await this.hooks?.promptRefresh({
        systemPrompt,
        agentName,
        sessionId,
      });
      if (refresh?.systemPrompt) {
        systemPrompt = appendHookSystemPrompt(systemPrompt, refresh.systemPrompt);
      }
    }

    // ── /todo：清洗指令词 + 靠后追加 plan_required notice（不改 system，保 cache）──
    const todoPre = preprocessTodoSlash(activeUserMessage);
    let effectiveUserMessage = todoPre.message;
    if (todoPre.requirePlan) {
      const notice = buildPlanRequiredNotice();
      notice.targetSessionId = sessionId!;
      effectiveUserMessage = `${effectiveUserMessage}\n\n${formatTodoNoticeMessage(notice)}`;
      yield this.logEvent("info", "[todo] /todo 已注入 plan_required system_notice");
    }

    if (goalHarness.isActive(this.sessions.sessionDir, sessionId!)) {
      const snap = goalHarness.get(this.sessions.sessionDir, sessionId!);
      if (harnessKickoff || !snap?.planReady) {
        yield this.event("status", { text: "规划目标合同..." });
        const helper =
          this.resolveHelperPresetFn?.(agentName, this.currentPreset ?? initialPreset)
          ?? this.currentPreset
          ?? initialPreset;
        const planned = await planHarnessGoal({
          sessionDir: this.sessions.sessionDir,
          sessionId: sessionId!,
          aux: this.auxModelCaller,
          preset: helper,
          fallbackPreset: this.currentPreset ?? initialPreset,
          abortSignal: effectiveAbortSignal,
        });
        if (!planned.ok) {
          yield this.event("assistant", { content: planned.message, round: 0 });
          yield this.event("done", { sessionId, rounds: 0 });
          this.abortControllers.delete(sessionId);
          this.currentPreset = null;
          this.clearYieldHandler(sessionId);
          return;
        }
        if (harnessKickoff) {
          activeUserMessage = planned.prompt;
          effectiveUserMessage = planned.prompt;
        }
      }
    }

    // ── 将用户消息写入 session（kind=human_user, author=human）──
    {
      const preMsg = await this.hooks?.preMessage({
        role: "user",
        content: effectiveUserMessage,
      } as never);
      if (preMsg && !preMsg.allowed) {
        const reason = preMsg.blockReason ?? "用户消息被 hook 拦截";
        yield this.logEvent("warning", `[hook] pre_message 拦截: ${reason}`);
        this.fireErrorHooks({ message: reason, round: 0, reason: "pre_message" });
        yield this.event("error", { message: reason, round: 0, blocked: true });
        yield this.event("done", { sessionId, rounds: 0, blocked: true });
        this.abortControllers.delete(sessionId);
        this.currentPreset = null;
        this.clearYieldHandler(sessionId);
        return;
      }
      if (preMsg?.message !== undefined) {
        effectiveUserMessage = takeHookMessage(preMsg.message, effectiveUserMessage);
      }
      if (preMsg?.systemPrompt) {
        systemPrompt = appendHookSystemPrompt(systemPrompt, preMsg.systemPrompt);
      }
    }
    appendSessionEvent(this.sessions, sessionId!, {
      kind: "human_user",
      content: effectiveUserMessage,
      source: options.userMessageSource ?? "human",
      author: options.goalRound
        ? authorSystem("goal", "goal")
        : authorHuman("user", options.userName ?? "user"),
      meta: {
        ...(options.goalRound ? { goalSource: options.goalRound } : {}),
        ...(todoPre.requirePlan ? { had_todo_slash: true } : {}),
        ...(options.userImages?.length
          ? {
              images: options.userImages.map((img) => ({
                mimeType: img.mimeType,
                ...(img.hash ? { hash: img.hash } : img.data ? { data: img.data } : {}),
                ...(img.name ? { name: img.name } : {}),
                ...(img.bytes != null ? { bytes: img.bytes } : {}),
                ...(img.width != null ? { width: img.width } : {}),
                ...(img.height != null ? { height: img.height } : {}),
              })),
            }
          : {}),
        ...(options.userVideo?.length ? { video: options.userVideo } : {}),
        ...(options.userAudio?.length ? { audio: options.userAudio } : {}),
        ...(options.userCommand ? { command: options.userCommand } : {}),
      },
    });
    this.scheduleTitlePolish(sessionId!);
    resetWakeStreak(sessionId!);

    // ── 3. Agent 循环 ──
    let roundCount = 0;
    const maxRounds = effectiveRoundLimit > 0 ? effectiveRoundLimit : MAX_ROUNDS;
    const notifiedBgCompletions = new Set<string>();
    /** 本 run 内 structured_memory 只召回一次，避免子轮 accessCount 抖动打 cache */
    let runMemoryCache: { formattedContext: string } | null = null;
    // 完成前自动验证（#9）：失败则注入结果让模型自修，最多 MAX_VERIFY_FIX 次
    let verifyAttempts = 0;
    const MAX_VERIFY_FIX = 2;
    // #16 可观测：本次 run 的累计重试次数与 token
    let totalRetries = 0;
    let totalTokens = 0;
    let harnessTokensSeen = 0;
    // 最近一轮的 assistant 文本（loop 结束后供监督模式推送用）
    let lastAssistantContent = "";
    // 空响应重试：LLM 偶尔返回 content="" + 无 tool_calls（如 deepseek 长上下文下 completion_tokens=1）。
    // 注入 <continue> 提示让模型重新生成，最多 MAX_EMPTY_RETRIES 次，仍空才真正退出。
    let emptyResponseRetries = 0;
    const MAX_EMPTY_RETRIES = 5;
    // max_tokens（finishReason=length）截断后续写次数
    let lengthContinuations = 0;
    // 工具死循环检测：最近签名窗口 + 催促上限
    const recentToolSignatures: string[] = [];
    // streak 专用：严格全参数签名 + 该签名对应的原始调用（催促文案要点名参数）
    const recentStrictSignatures: string[] = [];
    const strictSignatureCalls = new Map<
      string,
      { name?: string; parameters?: Record<string, unknown> }
    >();
    let toolLoopNudges = 0;
    const MAX_TOOL_LOOP_NUDGES = 3;
    const toolLoopWindow = Math.max(3, this.loopThreshold ?? 10);
    // 本轮工具调用摘要（loop_report 用：累计整个 run 的工具调用，不只最后一轮）
    let lastRoundToolSummary = "";
    // 累计本次 run 所有轮的工具调用次数（loop_report 用：即使最后一轮空转，也能反映之前干了啥）
    const runToolCounts: Record<string, number> = {};

    while (roundCount < maxRounds) {
      // ── P1-3 消息总线：每轮 poll 自己的 mailbox，把队友消息作为 user 消息注入 ──
      // 队友通过 agent_manage message action 走 MessageBus.send 投递（带 from 说话人）。
      // 正文包成 <message from="…">，模型侧认发送者。
      // 不替代 callMainAgent（supervisor→main 仍走紧耦合路径）。
      const pendingBus = MessageBus.global().inbox(runAgentName);
      for (const busMsg of pendingBus) {
        const tagged = formatSenderEnvelope({
          body: busMsg.body,
          from: busMsg.from,
          to: busMsg.to && busMsg.to !== "*" ? busMsg.to : undefined,
          type: busMsg.replyTo ? "reply" : undefined,
          inReplyTo: busMsg.replyTo ? busMsg.replyTo.slice(0, 8) : undefined,
        });
        appendSessionEvent(this.sessions, sessionId!, {
          kind: "agent_message",
          content: tagged,
          source: "message_bus",
          author: authorAgent(busMsg.from, busMsg.from),
          meta: { from: busMsg.from, busMessageId: busMsg.id },
        });
        yield this.event("session_inject", {
          kind: "agent_message",
          source: "message_bus",
          content: tagged,
          from: busMsg.from,
          author: { type: "agent", id: busMsg.from, displayName: busMsg.from },
        });
        yield this.logEvent("info", `📬 收到 ${busMsg.from} → ${runAgentName} 的总线消息，已注入 session`);
      }

      // ── P0-5: 每轮取当前 preset（支持运行时 switchPreset 切换 model）──
      // 初始为 options.preset；运行中 switchPreset() 更新 this.currentPreset，
      // 下一轮此处取到新 preset，所有后续 LLM 调用 / contextLimit / 日志都用新值。
      const preset = this.currentPreset ?? initialPreset;
      if (preset !== lastPreset) {
        // 模型切换：发 model_switched 事件让 TUI 更新状态栏
        yield {
          type: "model_switched",
          model: preset.model ?? "(unknown)",
          previousModel: lastPreset.model ?? "(unknown)",
          round: roundCount + 1,
        } as StreamEvent;
        yield this.logEvent(
          "info",
          `模型切换: ${lastPreset.model ?? "(unknown)"} → ${preset.model ?? "(unknown)"}（第 ${roundCount + 1} 轮生效）`,
        );
        lastPreset = preset;
      }
      // 每轮按当前 preset 重算 nativeToolCalling（不同模型 tool-calling 能力可能不同）
      const nativeToolCalling = Boolean(preset.nativeToolCalling ?? true) && Boolean(toolSchemas?.length);

      // 检查中断信号（已合并外部 + 内部 interrupt）
      if (effectiveAbortSignal.aborted) {
        const reason = String(internalController.signal.reason ?? "unknown");
        // interrupt_immediately：不退出 run，重置 controller 后继续下一轮
        // （让 buildMessages 看到队列消息后正常处理）
        if (reason === "interrupt_immediately") {
          this.log("info", `[RUN] session=${sessionId} interrupt_immediately：重置 controller，继续下一轮处理队列消息`);
          internalController = new AbortController();
          this.abortControllers.set(sessionId, internalController);
          linkExternalAbort(internalController);
          effectiveAbortSignal = internalController.signal;
          // 投递队列里的 interrupt 消息到 session（runExited=false，但已 abort 过，符合 interrupt 模式投递条件）
          const interruptMessages = this.messageQueue.dequeueIfReady(sessionId!, "loop_end", {
            runExited: false,
            aborted: true,
            allTasksComplete: this.checkAllTasksComplete(sessionId!),
          });
          for (const msg of interruptMessages) {
            const r = this.messageQueue.deliver(sessionId!, msg, this.sessions);
            if (r.delivered) {
              yield this.logEvent("info", `📨 投递队列消息 #${msg.id} (${msg.mode}) 到 session（interrupt_immediately）`);
              yield this.event("queued_user", {
                id: msg.id,
                content: msg.message,
                mode: msg.mode,
                source: msg.source,
                phase: "interrupt_immediately",
              });
            } else {
              yield this.logEvent("warning", `📨 投递队列消息 #${msg.id} 失败（interrupt_immediately）: ${r.reason}`);
            }
          }
          roundCount++;
          continue;
        }
        this.log("info", `[RUN] session=${sessionId} 收到中断信号（${reason}），停止循环`);
        this.pauseActiveHarness(sessionId!);
        this.pauseArmedGoal(sessionId!);
        await this.hooks?.abort("用户中断");
        void this.hooks?.notification({ kind: "cancelled", sessionId, reason: "用户中断" });
        {
          const wall = loopDurationSinceLastUser(this.sessions, sessionId!, Date.now());
          this.sessions.appendMessage(sessionId!, "system", "已中断", {
            source: "runtime",
            ...(wall != null ? { loopDurationMs: wall } : {}),
          });
        }
        yield this.event("info", { message: "已中断" });
        break;
      }

      this.log("info", `[RUN] round ${roundCount + 1} start`);
      {
        const startGate = await this.hooks?.beforeAgentStart({
          roundNumber: roundCount + 1,
          systemPrompt,
        });
        if (startGate?.systemPrompt) {
          systemPrompt = appendHookSystemPrompt(systemPrompt, startGate.systemPrompt);
        }
        if (startGate && !startGate.allowed) {
          const reason = startGate.blockReason ?? "agent/pre-step 拒绝本步";
          yield this.logEvent("warning", `[hook] before_agent_start 拒绝: ${reason}`);
          const stopGate = await this.evaluateStopHook(sessionId!, roundCount + 1, {
            reason: "pre_step_reject",
            lastAssistant: lastAssistantContent,
          });
          if (stopGate.prevented) {
            for (const ev of this.injectHookContinue(
              sessionId!,
              roundCount + 1,
              "before_agent_start",
              stopGate.inject,
            )) {
              yield ev;
            }
            this.finishAgentRoundContext(sessionId!);
            await this.hooks?.agentStop(roundCount + 1);
            roundCount++;
            continue;
          }
          this.finishAgentRoundContext(sessionId!);
          await this.hooks?.agentStop(roundCount + 1);
          break;
        }
      }
      await this.hooks?.agentStart(roundCount + 1);

      // ── 3a-pre. 注入后台终端完成/超时通知 ──
      // 找回原 use_terminal 的 toolCallId，走 appendToolResult：
      // 已配对过则自动写成 role=user，不再伪造 term_notify_*。
      {
        const bgTerminals = listTerminals(agentName);
        for (const t of bgTerminals) {
          if (t.kind === "human" || t.id.startsWith("human_")) continue;
          registerJob(sessionId!, t.id, {
            kind: "terminal",
            label: t.description,
            status: t.state === "running" ? "running" : t.state === "interrupted" ? "stopping" : "running",
          });
          if (notifiedBgCompletions.has(t.id)) continue;
          if (t.state === "running") continue;
          if (t.state === "interrupted") continue;

          completeJob(
            sessionId!,
            t.id,
            t.state === "killed" ? "cancelled" : t.exitCode === 0 ? "done" : "failed",
          );
          notifiedBgCompletions.add(t.id);
          const wake = noteAutoWake(sessionId!);
          if (!wake.allowed) continue;
          const output = await getTerminalLogs(t.id, agentName, 2000);
          const statusLabel =
            t.state === "killed" ? "已终止" :
            t.exitCode === 0 ? "已完成" :
            t.exitCode != null ? `已失败(退出码${t.exitCode})` : "已结束";
          const ok = t.exitCode === 0 || (t.exitCode == null && t.state !== "killed");
          const content =
            `<terminal-message>\n` +
            `终端「${t.description}」(ID: ${t.id}) ${statusLabel}。\n` +
            (output ? `\n输出:\n${output}\n` : "") +
            `</terminal-message>`;
          const sessionMsgs = (this.sessions.load(sessionId!)?.messages ?? []) as Array<
            Record<string, unknown>
          >;
          const originalId =
            findToolCallIdByPayload(sessionMsgs, "terminal_id", t.id) ??
            findToolCallIdByPayload(sessionMsgs, "id", t.id);
          const notifyParams = {
            event: "background_complete",
            terminal_id: t.id,
            description: t.description,
            exit_code: t.exitCode,
            state: t.state,
          };
          this.persistToolResult(
            sessionId!,
            {
              name: "use_terminal",
              content,
              ok,
              toolCallId: originalId,
              payload: notifyParams,
            },
            {
              source: "terminal-notification",
              meta: {
                terminal_id: t.id,
                tool_parameters: notifyParams,
                ok,
              },
            },
          );
          if (originalId) {
            yield this.event("tool_result", {
              toolCallId: originalId,
              name: "use_terminal",
              content,
              ok,
              round: roundCount + 1,
              source: "terminal-notification",
            });
          }
        }
      }

      // 重新加载 session
      const currentSession = this.sessions.load(sessionId!) ?? session;
      const sessionMessages = this.sessions.getLlmHistoryMessages(sessionId!) ?? currentSession.messages;
      const currentRound = roundCount + 1;
      this.tickMicroCompactClock(
        sessionId!,
        sessionMessages as unknown as Array<Record<string, unknown>>,
        roundCount === 0,
      );

      // ── 3a-pre2. 每轮刷新动态注入（board / pending / agent 状态） ──
      // 首轮编译一次后持续复用，后续轮次只刷新动态部分，避免重复编译 BEFORE_USER.md
      const gitBlock = await prof.async("git_changes", () => this.workspaceChanges(), { round: currentRound });
      // 会话文件 diff 监听：仅用户新消息轮（roundCount===0）注入 before_user 区
      let fileDiffNotice = "";
      if (this.fileDiffWatch && sessionId) {
        try {
          const own = roundCount === 0 ? this.fileDiffWatch.consumeUserTurnDiffs(sessionId) : "";
          const foreign = this.fileDiffWatch.consumeForeignDiffs(sessionId);
          const instructions =
            workspaceInstructionsOn && roundCount === 0
              ? this.fileDiffWatch.consumeInstructionNotices(sessionId)
              : "";
          fileDiffNotice = [own, foreign, instructions].filter((s) => s && s.trim()).join("\n\n");
        } catch { /* ignore */ }
      }
      // Skill 增量：本轮新增/删除/更新（首轮已写入文件缓存区，这里只补上下文动态区）
      let skillIncremental = "";
      if (roundCount > 0 && skillManager) {
        try { skillIncremental = skillManager.compile().incrementalContent ?? ""; } catch { /* ignore */ }
      }
      const quietReport = formatQuietReports(takeQuietReports(sessionId!));
      const timeBlock = this.timeContextGate?.consume({
        turn: currentRound,
        step: roundCount + 1,
      }) ?? "";
      const paneBlock = formatMultiplexerPane();
      const paneNotice =
        paneBlock && paneBlock !== this.lastMultiplexerPane
          ? ((this.lastMultiplexerPane = paneBlock), paneBlock)
          : "";
      const dynamicSnapshot = this.dynamicSnapshotGate(sessionId!).consume(
        roundCount === 0 ? dynamicInjections : compileDynamicContext(maouRoot, agentName, sessionId!),
      );
      const currentDynamicInjections =
        dynamicSnapshot
        + (gitBlock ? `\n\n${gitBlock}` : "")
        + (skillIncremental ? `\n\n${skillIncremental}` : "")
        + (fileDiffNotice ? `\n\n${fileDiffNotice}` : "")
        + (quietReport ? `\n\n${quietReport}` : "")
        + (timeBlock ? `\n\n${timeBlock}` : "")
        + (paneNotice ? `\n\n${paneNotice}` : "");
      const effectiveBeforeUser = roundCount === 0 ? beforeUserContent : "";

      // ── 3a. 构建消息数组 ──
      // 记忆只在首轮召回并整 run 复用：子轮反复 recall 会写回 accessCount，
      // 导致 structured_memory 顺序/内容抖动，打掉 prompt prefix cache。
      if (roundCount === 0 || !runMemoryCache) {
        runMemoryCache = prof.sync("memory_recall", () => {
          const memoryStore = this.createMemoryStoreFn(this.maouRoot, agentName);
          return memoryStore.recall(activeUserMessage, 5);
        }, { round: currentRound });
      }
      const memoryResult = runMemoryCache;

      // 自动压缩检查
      // 阈值基于输入上下文上限 maxContext（非输出 maxTokens）。
      // 占用：上一条回报的 input + output。
      const contextLimit = this.resolveContextLimit(preset);
      const compressTriggerAt = contextLimit * (CONTEXT_THRESHOLD_PERCENT / 100);

      // ── ContextEngine 闭环路径（注入 stores 时启用）──
      // B1：优先 harness 工作集 + session 增量，不再每轮从全量 SessionStore 重建。
      // - harness 对齐可用 → 复用压缩后工作集，append 新 turn；始终 toLLMHistory
      // - harness 缺失/不对齐 → 从全量 session 初始化；仅当本轮真正压缩后用压缩历史
      //   （未压缩时保持 sessionMessages 路径，保留多模态图片旁路）
      let compressedHistory: LLMMessage[] | undefined;
      const engineEnabled = Boolean(this.harnessStore);
      const endCompress = prof.start("context_compress", { round: currentRound, path: engineEnabled ? "engine" : "legacy" });
      if (engineEnabled) {
        const retryAt = this.compressRetryAfter.get(sessionId!) ?? 0;
        const now = Date.now();
        const allowTry = now >= retryAt;
        const sessionMsgsWire = sessionMessages as unknown as Array<Record<string, unknown>>;
        try {
          const engine = new ContextEngine({
            sessionId: sessionId!,
            harnessStore: this.harnessStore!,
            extensions: this.contextExtensions,
            summarizer: runSummarizer,
            microTurn: this.sessions.getMicroTurn(sessionId!),
            microRounds: this.microCompactRounds,
          });
          const seed = engine.seedWorkingSet(sessionMsgsWire);
          // harness 已有工作集：即使本轮不压，也必须用 harness 历史，否则 B1 复发
          if (seed.useAsLlmHistory) {
            compressedHistory = engine.toLLMHistory();
          }

          if (allowTry) {
            const usedTokens = this.resolveSessionContextTokens(sessionId!, engine.getHistory(), {
              ignoreStaleApi: seed.fromHarness,
            });
            if (usedTokens >= compressTriggerAt) {
              const compactGate = await this.hooks?.preCompact({
                sessionId,
                usedTokens,
                contextLimit,
              });
              if (compactGate?.cancel) {
                // Pi session_before_compact: 扩展取消本次自动压缩
              } else if (compactLockOpen(readLedgerRecords(this.sessions.sessionDir, sessionId!))) {
                this.log("info", `[ContextEngine] compact lock open, skip auto`);
              } else {
              if (compactGate?.compaction?.summary) {
                this.sessionManager.setRollingSummary(sessionId!, compactGate.compaction.summary);
                this.sessionManager.saveState();
              }
              if (this.checkpointStore.shouldAutoCheckpoint("compression")) {
                this.checkpointStore.createCheckpoint(
                  sessionId!, `auto_before_compression_round_${currentRound}`, true, "compression",
                );
              }
              this.writeCompactBracket(sessionId!, "start", { source: "auto" });
              let report;
              try {
                report = await engine.compress(contextLimit, {
                  knownTokens: usedTokens,
                  sourceSessionMessages: sessionMsgsWire,
                });
              } catch (e) {
                this.writeCompactBracket(sessionId!, "end", { error: String(e), source: "auto" });
                throw e;
              }
              if (report.stage !== "activeStage") {
                compressedHistory = engine.toLLMHistory();
                this.compressRetryAfter.delete(sessionId!);
                this.clearLastOccupancy(sessionId!);
                const existing = this.sessionManager.getRollingSummary(sessionId!) ?? "";
                const merged = existing && report.droppedSummary
                  ? `${existing}\n\n---\n\n${report.droppedSummary}`
                  : (report.droppedSummary || existing);
                if (merged) {
                  this.sessionManager.setRollingSummary(sessionId!, merged);
                  this.sessionManager.saveState();
                }
                if (this.onCompress) {
                  try {
                    this.onCompress(sessionId!, report.stage, report.droppedSummary, report.blockIds ?? []);
                  } catch { /* 落盘失败不影响主流程 */ }
                }
                this.recordCompactSurface(sessionId!, "auto", report);
                yield this.event("context_refresh", { source: "auto", stage: report.stage });
                // 仅大压缩 / 归档出人话；微压缩只推占用条
                if (
                  report.stage === "summaryStage" ||
                  report.stage === "archiveStage"
                ) {
                  yield this.compressLogEvent({
                    stage: report.stage,
                    originalTokens: report.originalTokens,
                    compressedTokens: report.compressedTokens,
                    droppedSummary: report.droppedSummary,
                    taskBlocks: report.blockIds,
                  });
                } else {
                  this.log(
                    "info",
                    `[ContextEngine] 微压缩 stage=${report.stage} token ${report.originalTokens}→${report.compressedTokens}`,
                  );
                }
                await this.hooks?.postCompact(report.compressedTokens ?? 0);
                await this.afterCompressMaybeRebuild({
                  sessionId: sessionId!,
                  agentName,
                  stage: report.stage,
                  source: "auto",
                });
              } else {
                this.writeCompactBracket(sessionId!, "end", { error: "no_range", stage: report.stage, source: "auto" });
                if (seed.useAsLlmHistory) {
                  compressedHistory = engine.toLLMHistory();
                }
              }
              }
            }
          } else {
            const waitSec = Math.ceil((retryAt - now) / 1000);
            this.log("info", `[ContextEngine] 压缩退避中，${waitSec}s 后再试`);
            // 退避期间若 harness 可用，仍用工作集，避免回退全量 session 再次爆窗
            if (seed.useAsLlmHistory) {
              compressedHistory = engine.toLLMHistory();
            }
          }
        } catch (err) {
          // 失败：本轮不压、不杀 loop；隔段时间再试，直到成功或用户 abort
          const wait = AgentRuntime.COMPRESS_RETRY_MS;
          this.compressRetryAfter.set(sessionId!, Date.now() + wait);
          const errMsg = `[ContextEngine] 压缩失败，本轮跳过并在 ${wait / 1000}s 后重试: ${err}`;
          this.log("error", errMsg);
          yield this.logEvent("warning", errMsg);
          // 不 return — 用未压缩上下文继续本轮
        }
      }
      endCompress();

      const messages = prof.sync("build_messages", () => buildMessages({
        systemPrompt,
        sessionMessages,
        roundCount,
        currentRound,
        userOpts: {
          beforeUserContent: effectiveBeforeUser,
          dynamicInjections: currentDynamicInjections,
          userMessage: roundCount === 0 ? activeUserMessage : "",
          userName: options.userName ?? "user",
        },
        platformContext: options.platformContext,
        rollingSummary: this.sessionManager.getRollingSummary(sessionId!) ?? "",
        structuredMemory: memoryResult.formattedContext,
        projectRoot: this.agentScope === "project" || options.bindingProjectRoot
          ? effectiveProjectRoot
          : undefined,
        workspaceInstructions: workspaceInstructionsOn,
        replaceWorkspaceBaseline: sessionId ? this.instructionRebaseline.has(sessionId) : false,
        compressedHistory,
      }), { round: currentRound });
      if (sessionId && this.instructionRebaseline.has(sessionId)) {
        this.instructionRebaseline.delete(sessionId);
      }
      if (sessionId) this.assertContextStructure(sessionId);

      // ── 历史段最终化 ──
      let finalMessages: Record<string, unknown>[];
      if (engineEnabled) {
        // ContextEngine 已处理压缩，messages 即最终消息。
        finalMessages = messages;
      } else {
        // 旧路径：maybeCompress（同步 truncate shim）。
        // 压缩前自动快照
        const legacyGate = await this.hooks?.preCompact({ sessionId, path: "legacy" });
        if (legacyGate?.cancel) {
          finalMessages = messages;
        } else {
        if (this.checkpointStore.shouldAutoCheckpoint("compression")) {
          this.checkpointStore.createCheckpoint(
            sessionId!,
            `auto_before_compression_round_${currentRound}`,
            true,
            "compression",
          );
        }

        // legacy：用上一条占用触发
        const legacyUsed = this.resolveSessionContextTokens(sessionId!);
        const compressResult = prof.sync("context_compress_legacy", () => {
          return maybeCompress(messages, contextLimit, {
            knownTokens: legacyUsed,
            force: legacyUsed >= compressTriggerAt,
          });
        }, { round: currentRound });
        finalMessages = compressResult.messages;
        const compressed = compressResult.compressed;
        const droppedSummary = compressResult.droppedSummary;
        if (compressed) {
          this.clearLastOccupancy(sessionId!);
          // 把本轮新产生的摘要拼接到滚动摘要里，让后续轮次依然能看到被丢弃内容的线索
          const existing = this.sessionManager.getRollingSummary(sessionId!) ?? "";
          const merged = existing
            ? `${existing}\n\n---\n\n${droppedSummary}`
            : droppedSummary;
          this.sessionManager.setRollingSummary(sessionId!, merged);
          this.sessionManager.saveState();

          // 压缩区落盘：通过 onCompress 回调通知外部（由 MaouServer 注入 HarnessSessionStore）
          if (this.onCompress) {
            try {
              this.onCompress(sessionId!, compressResult.stage, droppedSummary, compressResult.taskBlocks ?? []);
            } catch {
              // 落盘失败不影响主流程
            }
          }
          this.writeCompactBracket(sessionId!, "start", { source: "legacy" });
          this.recordCompactSurface(sessionId!, "legacy", compressResult);
          yield this.event("context_refresh", { source: "legacy", stage: compressResult.stage });

          if (
            compressResult.stage === "summaryStage" ||
            compressResult.stage === "archiveStage"
          ) {
            yield this.compressLogEvent({
              stage: compressResult.stage,
              originalTokens: compressResult.originalTokens,
              compressedTokens: compressResult.compressedTokens,
              droppedSummary: droppedSummary,
              taskBlocks: compressResult.taskBlocks,
            });
          }
          await this.hooks?.postCompact(compressResult.compressedTokens ?? 0);
          await this.afterCompressMaybeRebuild({
            sessionId: sessionId!,
            agentName,
            stage: compressResult.stage,
            source: "auto",
          });
        }
        }
      }

      // 封印上一轮 prompt-cache 累计到分桶 samples（首轮 current 为空 → no-op）
      const sealed = promptCacheLedger().sealRound(
        agentName,
        sessionId!,
        String(preset.model ?? ""),
      );
      yield this.event("agent_round", {
        round: currentRound,
        agentMode,
        cache: sealed,
      });
      yield this.logEvent("info", `开始第 ${currentRound} 轮`);
      yield this.event("status", { text: "调用模型..." });
      yield this.logEvent("info", `调用模型: ${preset.model}`);
      await this.hooks?.agentThinking();
      await this.hooks?.responseStart();

      // ── 3b. 调用 LLM（流式）──
      // - 瞬时故障：ModelCaller 内部可原样重试
      // - 上下文溢出：禁止原样重试；强制压缩 → 降 extras → 紧急截断 → 再请求
      // - 不支持 image_url：剥多模态后重试（勿误判为超窗）
      // - 目标：绝不因一次超窗把会话钉死，只剩「新话题」
      let result: ModelCallResult;
      const MODEL_RETRIES = 2;
      /** 超窗恢复次数：每次更狠（0.50 → 0.35 → 0.22 全包预算 + 紧急 trim） */
      const MAX_CTX_OVERFLOW_RECOVER = 3;
      const MAX_MEDIA_RECOVER = 1;
      let modelAttempt = 0;
      let ctxOverflowRecoveries = 0;
      let mediaRecoveries = 0;
      // 溢出后可关掉重型 extras，降低固定开销
      let overflowLeanMode = false;

      for (;;) {
        const endLlm = prof.start("llm_call", {
          round: currentRound,
          model: preset.model,
          attempt: modelAttempt,
          ctx_recover: ctxOverflowRecoveries,
        });
        try {
          const reqGate = await this.hooks?.agentRequest({
            round: currentRound,
            sessionId,
            model: preset.model,
          });
          // 落盘屏障：账没落上就不向模型开口（这一步花钱且不可逆）
          const barrier = sessionId
            ? this.ledgerBarrier(sessionId, "model/request", {
                round: currentRound,
                step: roundCount + 1,
                model: preset.model,
                messages: finalMessages.length,
              })
            : ({ ok: true } as const);
          if (!barrier.ok) {
            result = this.errorCallResult(ledgerBarrierHuman("model/request", barrier.reason));
          } else if (reqGate && (!reqGate.allowed || reqGate.cancel)) {
            result = this.errorCallResult(
              reqGate.blockReason ?? "agent/request 拦截了本次模型调用",
            );
          } else {
          if (sessionId) {
            this.sessionLastPromptParts.set(sessionId, {
              systemPrompt,
              toolSchemas: nativeToolCalling ? toolSchemas : null,
              toolCount: Array.isArray(toolSchemas) ? toolSchemas.length : 0,
              skillCount,
              mcpCount: this.mcpManager?.listDescriptors().length ?? 0,
            });
          }
          const callGen = this.callModelFn({
            preset,
            messages: finalMessages,
            stream,
            toolSchemas: nativeToolCalling ? toolSchemas : null,
            nativeToolCalling,
            autoFormat,
            jsonSettings: options.jsonSettings ?? outputJsonSettings ?? null,
            sessionId: sessionId ?? undefined,
            round: currentRound,
            abortSignal: effectiveAbortSignal,
          });

          // 字段级流式提取：每轮创建新 accumulator（每轮重置）
          const jsonAcc = new StreamJsonAccumulator();

          let iterResult = await callGen.next();
          while (!iterResult.done) {
            const streamEvent = iterResult.value as CallerStreamEvent;

            yield {
              type: streamEvent.type,
              ...streamEvent.data,
            };

            if (streamEvent.type === "assistant_delta" && streamEvent.data.delta) {
              jsonAcc.feed(String(streamEvent.data.delta));
              for (const field of jsonAcc.getNewFields()) {
                yield {
                  type: "field_complete",
                  fieldName: field.name,
                  fieldValue: field.value,
                  rawValue: field.rawValue,
                } as StreamEvent;
              }
              for (const [, field] of jsonAcc.getStreamingFields()) {
                yield {
                  type: "field_streaming",
                  fieldName: field.name,
                  content: field.content,
                  delta: field.delta,
                } as StreamEvent;
              }
            }

            iterResult = await callGen.next();
          }
          result = iterResult.value;
          }
        } catch (err) {
          this.log("warning", `[RUN] model call failed: ${err}`);
          result = this.errorCallResult(String(err));
        } finally {
          endLlm();
        }

        const errBlob =
          result.validationError ||
          result.rawResponse ||
          (result as { error?: string }).error ||
          "";
        const errText = `${errBlob}\n${String(result.content ?? "")}`;

        // ── 多模态不支持 → 剥 image 后重试（勿当超窗）──
        if (
          detectUnsupportedMediaContent(errText) &&
          mediaRecoveries < MAX_MEDIA_RECOVER &&
          !effectiveAbortSignal.aborted
        ) {
          mediaRecoveries++;
          const stripped = stripNonTextContent(
            finalMessages as Array<Record<string, unknown>>,
          );
          if (stripped.stripped > 0) {
            finalMessages = stripped.messages;
            yield this.logEvent(
              "warning",
              `模型不支持多模态内容，已移除 ${stripped.stripped} 处非文本块后重试`,
            );
            yield this.event("status", {
              text: `Unsupported media · stripped · retry`,
            });
            await this.hooks?.agentThinking();
            continue;
          }
        }

        // ── 上下文溢出 → 强制压缩 / 瘦身 / 紧急截断 → 再请求 ──
        const overflow = detectContextOverflow(errText);
        if (
          overflow &&
          ctxOverflowRecoveries < MAX_CTX_OVERFLOW_RECOVER &&
          !effectiveAbortSignal.aborted
        ) {
          ctxOverflowRecoveries++;
          overflowLeanMode = true;
          yield this.logEvent(
            "warning",
            `上下文超限（API），强制收缩后重试 ${ctxOverflowRecoveries}/${MAX_CTX_OVERFLOW_RECOVER}`,
          );
          yield this.event("status", {
            text: `Context overflow · shrink · ${ctxOverflowRecoveries}/${MAX_CTX_OVERFLOW_RECOVER}`,
          });
          this.compressRetryAfter.delete(sessionId!);
          this.clearLastOccupancy(sessionId!);

          try {
            const shrunk = await this.forceShrinkPromptForOverflow({
              sessionId: sessionId!,
              contextLimit,
              attempt: ctxOverflowRecoveries,
              engineEnabled,
              runSummarizer,
              systemPrompt,
              toolSchemas,
              sessionMessages: sessionMessages as unknown as Array<Record<string, unknown>>,
              effectiveBeforeUser: "",
              currentDynamicInjections: "",
              structuredMemory: "",
              rollingSummary:
                ctxOverflowRecoveries >= 2
                  ? ""
                  : (this.sessionManager.getRollingSummary(sessionId!) ?? ""),
              platformContext: options.platformContext,
              projectRoot:
                this.agentScope === "project" || options.bindingProjectRoot
                  ? effectiveProjectRoot
                  : undefined,
              userName: options.userName ?? "user",
              roundCount,
              currentRound,
              activeUserMessage,
              finalMessages: finalMessages as Array<Record<string, unknown>>,
              leanExtras: true,
            });
            if (shrunk.ok || shrunk.surfaceChanged) {
              finalMessages = shrunk.finalMessages;
              if (shrunk.compressedHistory) compressedHistory = shrunk.compressedHistory;
              if (shrunk.stage && shrunk.stage !== "activeStage") {
                yield this.event("context_refresh", { source: "overflow", stage: shrunk.stage });
                yield this.compressLogEvent({
                  stage: shrunk.stage,
                  originalTokens: shrunk.originalTokens ?? 0,
                  compressedTokens: shrunk.estimatedTokens,
                  droppedSummary: shrunk.droppedSummary ?? "",
                  taskBlocks: shrunk.taskBlocks ?? [],
                });
              } else if (shrunk.emergencyTrimmed) {
                yield this.logEvent(
                  "warning",
                  `紧急截断历史 ${shrunk.dropped ?? 0} 条`,
                );
              }
              await this.hooks?.agentThinking();
              continue;
            }
            yield this.logEvent(
              "warning",
              `上下文溢出恢复未改变工作集`,
            );
          } catch (ce) {
            yield this.logEvent(
              "warning",
              `上下文溢出后强制收缩失败: ${ce instanceof Error ? ce.message : String(ce)}`,
            );
          }
        }

        // 重试判定：模型应答但不可用（空内容 + 校验失败 / 错误结果）。
        // 中断信号优先；有原生工具调用即视为可用，不重试。
        // 不可重试（quota/auth/…）走 LLM 结构化字段 errorRetryable / errorCategory，
        // 不再用 FreeUsageLimit 正则。
        const unusable =
          !result.content &&
          !!result.validationError &&
          result.nativeToolCalls.length === 0;
        const unusableOverflow = detectContextOverflow(result.validationError || "");
        const unusableMedia = detectUnsupportedMediaContent(result.validationError || "");
        // LLM structured: prefer errorRetryable; else parse [llm_error] prefix / classify
        const modelErrNonRetryable = (() => {
          if (result.errorRetryable === false) return true;
          if (result.errorRetryable === true) return false;
          const parsed = parseLlmErrorFromMessage(result.validationError || "");
          if (parsed) return !parsed.retryable;
          const c = classifyFromThrown(new Error(result.validationError || ""));
          // Only block retries for known terminal categories (not unknown JSON noise)
          return (
            !c.retryable &&
            (c.category === "quota_exhausted" ||
              c.category === "auth" ||
              c.category === "content_policy" ||
              c.category === "context_overflow")
          );
        })();
        if (
          unusable &&
          !unusableOverflow &&
          !unusableMedia &&
          !modelErrNonRetryable &&
          modelAttempt < MODEL_RETRIES &&
          !effectiveAbortSignal.aborted
        ) {
          modelAttempt++;
          yield this.logEvent(
            "warning",
            `模型返回不可用（${result.validationError}），原样重试 ${modelAttempt}/${MODEL_RETRIES}`,
          );
          await this.hooks?.agentThinking();
          continue;
        }
        break;
      }

      // 超窗耗尽仍失败：写清可恢复提示（会话 harness 若已压过，下轮可续，不必只能 /new）
      if (
        !result.content &&
        result.validationError &&
        detectContextOverflow(result.validationError)
      ) {
        const tip =
          `${result.validationError}\n\n` +
          `【上下文超限】已尝试自动压缩/截断仍失败。` +
          `完整记录仍在会话中；可再发一条消息（将继续用压缩工作集）、执行 /compact，或新开话题。`;
        result = this.errorCallResult(tip);
      }

      // 桥接 LLM 内部细分计时（首字节/生成）到 profiler，区分"网络等待"与"生成"
      if (result.timing) {
        const t = result.timing as { firstByteMs?: number; generationMs?: number; totalMs?: number };
        if (typeof t.firstByteMs === "number") prof.record("llm_first_byte", t.firstByteMs, { round: currentRound });
        if (typeof t.generationMs === "number") prof.record("llm_generation", t.generationMs, { round: currentRound });
      }

      // 保存原始响应
      this.sessions.setLastRawResponse(sessionId!, result.rawResponse);
      yield this.event("raw_response", { content: result.rawResponse });

      // 累计本次 run 的重试与 token（#16 可观测）
      totalRetries += modelAttempt;
      // 记录 token 用量 + agent 层 prompt-cache 分桶（CLI 只读 snapshot）
      if (result.usage) {
        const tokenUsage = result.usage as unknown as TokenUsage;
        const tt = (result.usage as { total_tokens?: number; totalTokens?: number }).total_tokens
          ?? (result.usage as { totalTokens?: number }).totalTokens ?? 0;
        totalTokens += Number(tt) || 0;
        const mainModel = String(preset.model ?? "");
        const providerId = String(
          (preset as { provider?: string; name?: string }).provider
          ?? (preset as { name?: string }).name
          ?? "",
        );
        this.recordLastOccupancy(sessionId!, result.usage as Record<string, unknown>);
        // Agent 层权威写入：(agentName, sessionId, mainModel) 桶
        const cacheSnap = promptCacheLedger().recordUsage({
          agentName,
          sessionId: sessionId!,
          model: mainModel,
          provider: providerId || undefined,
          role: "main",
          mainAgentName: agentName,
          usage: result.usage as Record<string, unknown>,
        });
        try {
          const tracker = this.createTokenTrackerFn(maouRoot, agentName, preset as unknown as Record<string, unknown>);
          tracker.record(tokenUsage, mainModel);
        } catch (err) {
          this.log("warning", `token tracking failed: ${err}`);
        }
        yield {
          type: "model.usage",
          usage: tokenUsage,
          model: mainModel,
          agentName,
          role: "main",
          sessionId,
          // 分桶快照：CLI 直接镜像，不自建跨会话 history
          cache: cacheSnap ?? undefined,
        } as unknown as StreamEvent;
      }

      // 存储 assistant 消息（不再用空格占位，空串即可；适配器会处理 tool_calls 配对）
      // content = 展示/正文；reasoningContent 按 thinking_context_mode 决定是否进后续 LLM 上下文
      let contentToUse = result.content || "";
      // max_tokens / length 截断：正文末尾打标志，便于模型与用户识别断点
      const outputTruncated =
        !result.aborted &&
        isOutputTruncatedByLength(result.finishReason ?? null);
      if (outputTruncated && contentToUse) {
        contentToUse = appendTruncationMarker(contentToUse);
        yield this.logEvent(
          "warning",
          `模型输出因 length/max_tokens 截断 (finishReason=${result.finishReason ?? "?"})，将尝试续写`,
        );
      }
      // 用户中断：保留 partial，并标注（非自动续写）
      if (result.aborted && contentToUse && !contentToUse.includes("生成被中断")) {
        contentToUse =
          contentToUse + "\n\n【系统】生成被中断，以上为已输出部分。";
      }
      lastAssistantContent = contentToUse;
      const reasoningRaw =
        typeof result.reasoningContent === "string" ? result.reasoningContent.trim() : "";
      // DeepSeek V4 thinking：含 tool_calls 的 assistant 历史必须回传 reasoning_content 字段。
      // - 有真思考：按 mode 或 tool 强制落盘
      // - 无真思考但有 tool_calls：落盘 ""，保证后续回传字段存在
      const hasToolCalls = result.nativeToolCalls.length > 0;
      const storeThinking =
        (reasoningRaw.length > 0 &&
          (shouldStoreThinkingInContext(thinkingContextMode, roundCount) ||
            hasToolCalls)) ||
        (hasToolCalls && reasoningRaw.length === 0);
      // 累计本次 run 所有轮的工具调用（loop_report 用：即使最后一轮空转，也能反映之前干了啥）
      if (result.nativeToolCalls.length > 0) {
        for (const tc of result.nativeToolCalls) {
          const n = (tc as { name?: string }).name ?? "?";
          runToolCounts[n] = (runToolCounts[n] ?? 0) + 1;
        }
      }
      lastRoundToolSummary = Object.entries(runToolCounts).map(([n, c]) => `${n}×${c}`).join("、");
      const artifacts =
        !hasToolCalls && this.fileDiffWatch
          ? this.fileDiffWatch.listSessionArtifacts(sessionId!)
          : [];
      const loopDurationMs = loopDurationSinceLastUser(
        this.sessions,
        sessionId!,
        Date.now(),
      );
      this.sessions.appendMessage(sessionId!, "assistant", contentToUse, {
        kind: "assistant_turn",
        source: "assistant",
        author: authorAgent(runAgentName || agentName || "assistant", runAgentName || agentName || "ai"),
        agentName: runAgentName || agentName,
        round: currentRound,
        retry_count: result.retryIndex,
        raw_response: result.rawResponse,
        validation_error: result.validationError,
        toolCalls: result.nativeToolCalls,
        usage: result.usage,
        raw_request: result.rawRequest,
        finish_reason: result.finishReason ?? undefined,
        output_truncated: outputTruncated || undefined,
        aborted: result.aborted || undefined,
        ...(loopDurationMs != null ? { loopDurationMs } : {}),
        ...(artifacts.length ? { artifacts } : {}),
        // 仅 mode 允许 / tool 强制时写入；UI 仍走 thinking_delta，不把标签塞进 content
        ...(storeThinking ? { reasoningContent: reasoningRaw } : {}),
      });
      // storeThinking 且 reasoningRaw 为空时写入 ""（tool 兜底）

      // 模型调用失败时（content 为空且有 validationError）发送 error 事件
      if (!contentToUse && result.validationError) {
        const parsed =
          result.errorCategory != null
            ? {
                category: result.errorCategory,
                retryable: result.errorRetryable,
                code: result.errorCode,
              }
            : (() => {
                const p =
                  parseLlmErrorFromMessage(result.validationError) ??
                  classifyFromThrown(new Error(result.validationError));
                return {
                  category: p.category,
                  retryable: p.retryable,
                  code: p.code,
                };
              })();
        yield this.event("error", {
          message: result.validationError,
          round: currentRound,
          category: parsed.category,
          retryable: parsed.retryable,
          code: parsed.code,
        });
        this.fireErrorHooks({
          message: result.validationError,
          round: currentRound,
          category: parsed.category,
          retryable: parsed.retryable,
          code: parsed.code,
        });
        const sf = await this.hooks?.stopFailure({
          message: result.validationError,
          round: currentRound,
          category: parsed.category,
          retryable: parsed.retryable,
          code: parsed.code,
        });
        if (isHookContinue(sf)) {
          const inject =
            sf?.blockReason ||
            takeHookMessage(sf?.message, "") ||
            result.validationError;
          for (const ev of this.injectHookContinue(sessionId!, currentRound, "stop_failure", inject)) {
            yield ev;
          }
          this.finishAgentRoundContext(sessionId!);
          await this.hooks?.agentStop(currentRound);
          roundCount++;
          continue;
        }
        break; // 退出 agent 循环
      }

      // ── 空响应/空转容错：监督模式下，主 agent 该干活却没调工具 ──
      // 两种情况都重试：① content 为空 + 无 tool_calls（LLM 偶发空响应）
      //                  ② 监督模式下有文本但无 tool_calls（只说不做，如"我来修复"却不调工具）
      // 仅对监督模式生效（普通对话不强制调工具）。
      // ① 主 agent（getByMain）：该干活却没调工具 → 重试
      // ② supervisor（getBySupervisor）：started 状态该 chat_main/verify/confirm_end 却只输出文本 → 重试
      const supervisorBindingForRetry = SUPERVISOR_MANAGER.getByMain(sessionId!);
      const supervisorSelfBinding = SUPERVISOR_MANAGER.getBySupervisor(sessionId!);
      const isSupervisedMain = !!(supervisorBindingForRetry && supervisorBindingForRetry.state === "started");
      const isSupervisorActive = !!(supervisorSelfBinding && supervisorSelfBinding.state === "started");
      const noTools = result.nativeToolCalls.length === 0;
      // 监督模式下（主 agent 或 supervisor）该干活却没调工具 → 重试
      const shouldRetryOnEmpty = (isSupervisedMain || isSupervisorActive) && noTools;
      if (shouldRetryOnEmpty) {
        emptyResponseRetries += 1;
        if (emptyResponseRetries < MAX_EMPTY_RETRIES) {
          const reason = !contentToUse ? "空响应" : "有文本但未调用工具";
          // 角色区分提示：工具名从当前 Agent 注册表自动取，禁止硬编码 write_file 等
          const registeredToolNames = (() => {
            try {
              return this.tools
                .list()
                .map((d) => d.name)
                .filter(Boolean)
                .slice(0, 16);
            } catch {
              return [] as string[];
            }
          })();
          const toolListHint =
            registeredToolNames.length > 0
              ? registeredToolNames.join("/")
              : "（当前 Agent 已注册工具）";
          const hint = isSupervisorActive
            ? "你是监督 Agent，**禁止只输出文字**，必须立刻调用工具。若要派活给主 Agent，现在就调 supervisor_chat_main(message=\"派活内容\")；若主 Agent 已汇报，调 supervisor_task_control(action=verify, round_report=\"汇报内容\")；若验收合格，调 supervisor_task_control(action=confirm_end)。"
            : `请继续执行任务——直接调用工具（${toolListHint} 等）开始具体操作，不要只思考或只输出文字。若有 todo 清单且当前项已完成，调用 todo_finish；全部完成后回复用户。`;
          // todo 线路空转：额外 nudge（靠后 system_notice）
          try {
            TODO_ORCHESTRATOR.evaluateNudge(sessionId!, sessionId!, false);
            this.flushTodoNotices(sessionId!);
          } catch { /* ignore */ }
          yield this.logEvent("warning", `[RUN] session=${sessionId} 检测到${reason}（${emptyResponseRetries}/${MAX_EMPTY_RETRIES}），注入 <continue> 重试`);
          appendSessionEvent(this.sessions, sessionId!, {
            kind: "runtime_control",
            content: `<continue>你上一轮${reason}。${hint}</continue>`,
            source: "empty_retry",
            author: authorSystem("runtime", "runtime"),
            meta: { round: currentRound },
          });
          yield this.event("session_inject", {
            kind: "runtime_control",
            source: "empty_retry",
            content: `继续：${reason}`,
            round: currentRound,
            author: { type: "system", id: "runtime", displayName: "runtime" },
          });
          this.finishAgentRoundContext(sessionId!);
        await this.hooks?.agentStop(currentRound);
          roundCount++;
          continue;
        }
        // 重试次数耗尽，真正退出（但仍会走到 loop 结束推送 loop_report，让 supervisor 知道主 agent 卡住）
        yield this.logEvent("warning", `[RUN] session=${sessionId} 空转重试 ${MAX_EMPTY_RETRIES} 次仍无工具调用，退出循环`);
        this.fireErrorHooks({
          message: "空转重试耗尽仍无工具调用",
          round: currentRound,
          reason: "empty_retry_exhausted",
        });
        const sfEmpty = await this.hooks?.stopFailure({
          message: "空转重试耗尽仍无工具调用",
          round: currentRound,
          reason: "empty_retry_exhausted",
        });
        if (isHookContinue(sfEmpty)) {
          const inject =
            sfEmpty?.blockReason ||
            takeHookMessage(sfEmpty?.message, "") ||
            "空转后请改用工具继续，不要只回复文本。";
          for (const ev of this.injectHookContinue(sessionId!, currentRound, "stop_failure", inject)) {
            yield ev;
          }
          this.finishAgentRoundContext(sessionId!);
          await this.hooks?.agentStop(currentRound);
          roundCount++;
          continue;
        }
        this.finishAgentRoundContext(sessionId!);
        await this.hooks?.agentStop(currentRound);
        break;
      }
      // 有工具调用 → 重置空转计数
      if (!noTools) emptyResponseRetries = 0;

      yield this.event("assistant", {
        content: contentToUse,
        round: currentRound,
        usage: { ...result.usage, max_context: this.resolveContextLimit(preset) },
        nativeToolCalls: result.nativeToolCalls.length > 0 ? result.nativeToolCalls : undefined,
        timing: result.timing,
        ...(artifacts.length ? { artifacts } : {}),
      });
      await this.hooks?.responseEnd(contentToUse);
      await this.hooks?.postMessage({ role: "assistant", content: contentToUse } as never);
      {
        const expr = detectExpression(contentToUse);
        const prev = this.lastExpression.get(sessionId!) ?? "neutral";
        if (expr !== prev) {
          await this.hooks?.expressionChange(prev, expr);
          this.lastExpression.set(sessionId!, expr);
        }
      }

      // ── 3d/3e. 处理工具调用 ──
      if (result.nativeToolCalls.length > 0 && agentMode) {
        yield this.logEvent("info", `检测到 ${result.nativeToolCalls.length} 个工具调用`);

        const shouldContinue = yield* this.processToolCalls(
          sessionId!,
          currentRound,
          result.nativeToolCalls,
          sandboxMode,
          agentName,
          prof,
          compressionLevel,
          effectiveWorkingDir,
          preset, // 当前轮 preset（供 ToolContext.mainPreset，避免实例字段被嵌套 run 污染）
        );

        // 工具死循环检测（真签名：name+关键参数，非仅次数）
        for (const tc of result.nativeToolCalls) {
          recentToolSignatures.push(toolCallSignature(tc));
          // streak 数"同一次调用"，要求全部参数一致；宽签名会把改内容写同一文件也算进来
          recentStrictSignatures.push(strictToolCallSignature(tc));
          strictSignatureCalls.set(strictToolCallSignature(tc), {
            name: tc.name,
            parameters: tc.parameters,
          });
        }
        if (recentToolSignatures.length > toolLoopWindow * 2) {
          recentToolSignatures.splice(0, recentToolSignatures.length - toolLoopWindow * 2);
        }
        if (recentStrictSignatures.length > toolLoopWindow * 2) {
          recentStrictSignatures.splice(0, recentStrictSignatures.length - toolLoopWindow * 2);
        }
        const streak = consecutiveToolStreak(recentStrictSignatures);
        if (shouldNudgeToolStreak(streak.count)) {
          const call = strictSignatureCalls.get(streak.signature);
          const ctrl = buildToolStreakControl(streak.count, {
            name: call?.name,
            parameters: call?.parameters,
            signature: streak.signature,
          });
          yield this.logEvent("warning", `同一工具连续 ${streak.count} 次`);
          appendSessionEvent(this.sessions, sessionId!, {
            kind: "runtime_control",
            content: ctrl,
            source: "tool_streak",
            author: authorSystem("runtime", "runtime"),
            meta: { round: currentRound, streak: streak.count, signature: streak.signature },
          });
          yield this.event("session_inject", {
            kind: "runtime_control",
            source: "tool_streak",
            content: `同一调用第 ${streak.count} 次`,
            round: currentRound,
            author: { type: "system", id: "runtime", displayName: "runtime" },
          });
        } else {
          const loopHit = detectRepeatedToolLoop(recentToolSignatures, {
            window: toolLoopWindow,
          });
          if (loopHit.looping && toolLoopNudges < MAX_TOOL_LOOP_NUDGES) {
            toolLoopNudges++;
            const ctrl = buildToolLoopControl(loopHit.dominant);
            yield this.logEvent(
              "warning",
              `检测到工具调用死循环倾向（${toolLoopNudges}/${MAX_TOOL_LOOP_NUDGES}）dominant≈${(loopHit.dominant ?? "").slice(0, 80)}`,
            );
            appendSessionEvent(this.sessions, sessionId!, {
              kind: "runtime_control",
              content: ctrl,
              source: "tool_loop",
              author: authorSystem("runtime", "runtime"),
              meta: { round: currentRound, dominant: loopHit.dominant, count: loopHit.count },
            });
            yield this.event("session_inject", {
              kind: "runtime_control",
              source: "tool_loop",
              content: "工具循环警告：请换策略",
              round: currentRound,
              author: { type: "system", id: "runtime", displayName: "runtime" },
            });
          } else if (!loopHit.looping) {
            toolLoopNudges = 0;
          }
        }

        // task_complete phase：本轮若有工具完成（尤其 todo_finish），且全部 todo 已完成，
        // 立即投递 after_task_complete 模式的消息（不必等 loop_end 兜底）。
        if (this.checkAllTasksComplete(sessionId!)) {
          const taskCompleteMessages = this.messageQueue.dequeueIfReady(sessionId!, "task_complete", {
            allTasksComplete: true,
          });
          for (const msg of taskCompleteMessages) {
            const r = this.messageQueue.deliver(sessionId!, msg, this.sessions);
            if (r.delivered) {
              yield this.logEvent("info", `📨 投递队列消息 #${msg.id} (${msg.mode}) 到 session（task_complete）`);
              yield this.event("queued_user", {
                id: msg.id,
                content: msg.message,
                mode: msg.mode,
                source: msg.source,
                phase: "task_complete",
              });
            } else {
              yield this.logEvent("warning", `📨 投递队列消息 #${msg.id} 失败（task_complete）: ${r.reason}`);
            }
          }
        }

        if (shouldContinue) {
          this.finishAgentRoundContext(sessionId!);
        await this.hooks?.agentStop(currentRound);
          roundCount++;
          continue;
        }
      }

      // ── max_tokens 截断续写（无工具收尾 或 endsLoop 后正文仍被截断）──
      if (
        outputTruncated &&
        !result.aborted &&
        !result.validationError &&
        lengthContinuations < MAX_LENGTH_CONTINUATIONS &&
        !effectiveAbortSignal.aborted
      ) {
        lengthContinuations++;
        const ctrl = buildLengthContinuationControl({
          round: currentRound,
          hasToolCalls: result.nativeToolCalls.length > 0,
        });
        yield this.logEvent(
          "warning",
          `length 截断续写 ${lengthContinuations}/${MAX_LENGTH_CONTINUATIONS}`,
        );
        appendSessionEvent(this.sessions, sessionId!, {
          kind: "runtime_control",
          content: ctrl,
          source: "length_continue",
          author: authorSystem("runtime", "runtime"),
          meta: { round: currentRound, finish_reason: result.finishReason },
        });
        yield this.event("session_inject", {
          kind: "runtime_control",
          source: "length_continue",
          content: "续写：输出被截断",
          round: currentRound,
          author: { type: "system", id: "runtime", displayName: "runtime" },
        });
        yield this.event("status", {
          text: `续写截断输出 (${lengthContinuations}/${MAX_LENGTH_CONTINUATIONS})`,
        });
        this.finishAgentRoundContext(sessionId!);
        await this.hooks?.agentStop(currentRound);
        roundCount++;
        continue;
      }

      // ── #9 完成前自动验证（typecheck/test 等）──
      // 模型已无工具调用、准备收尾：若配置了 verify_command 则跑一次，失败就把结果喂回让其自修。
      if (verifyCommand && verifyAttempts < MAX_VERIFY_FIX && !effectiveAbortSignal.aborted) {
        yield this.event("status", { text: "运行完成前验证..." });
        yield this.logEvent("info", `完成前验证: ${verifyCommand}`);
        const v = await prof.async("verify", () => this.runVerify(verifyCommand), { round: currentRound });
        if (!v.ok) {
          verifyAttempts++;
          yield this.logEvent("warning", `验证未通过（exit=${v.code}），注入失败结果让模型修复（${verifyAttempts}/${MAX_VERIFY_FIX}）`);
          const note =
            `<verification-failed>\n命令 \`${verifyCommand}\` 失败（exit=${v.code}）。请修复以下问题后再结束：\n\n${v.output}\n</verification-failed>`;
          appendSessionEvent(this.sessions, sessionId!, {
            kind: "runtime_control",
            content: note,
            source: "verification",
            author: authorSystem("verify", "verify"),
            meta: { round: currentRound },
          });
          yield this.event("session_inject", {
            kind: "runtime_control",
            source: "verification",
            content: note.slice(0, 200),
            round: currentRound,
            author: { type: "system", id: "verify", displayName: "verify" },
          });
          yield this.event("verification", { ok: false, command: verifyCommand, attempt: verifyAttempts });
          this.finishAgentRoundContext(sessionId!);
        await this.hooks?.agentStop(currentRound);
          roundCount++;
          continue;
        }
        yield this.logEvent("info", `✅ 完成前验证通过: ${verifyCommand}`);
        yield this.event("verification", { ok: true, command: verifyCommand });
      }

      // 无工具调用（且验证通过/无验证）→ 检查消息队列再决定退出
      // round_end：投递 after_round_complete 模式的消息，有投递则继续下一轮让 LLM 处理
      const roundEndMessages = this.messageQueue.dequeueIfReady(sessionId!, "round_end", {
        allTasksComplete: this.checkAllTasksComplete(sessionId!),
      });
      if (roundEndMessages.length > 0) {
        for (const msg of roundEndMessages) {
          const r = this.messageQueue.deliver(sessionId!, msg, this.sessions);
          if (r.delivered) {
            yield this.logEvent("info", `📨 投递队列消息 #${msg.id} (${msg.mode}): 已追加到 session`);
            yield this.event("queued_user", {
              id: msg.id,
              content: msg.message,
              mode: msg.mode,
              source: msg.source,
              phase: "round_end",
            });
          } else {
            yield this.logEvent("warning", `📨 投递队列消息 #${msg.id} 失败: ${r.reason}`);
          }
        }
        this.finishAgentRoundContext(sessionId!);
        await this.hooks?.agentStop(currentRound);
        roundCount++;
        continue;
      }

      // 无队列消息 → 宿主编排 /ultragoal 同回合续跑，否则退出
      if (
        goalHarness.isActive(this.sessions.sessionDir, sessionId!) &&
        !effectiveAbortSignal.aborted
      ) {
        const helper =
          this.resolveHelperPresetFn?.(agentName, this.currentPreset ?? initialPreset)
          ?? this.currentPreset
          ?? initialPreset;
        const tokensDelta = Math.max(0, totalTokens - harnessTokensSeen);
        harnessTokensSeen = totalTokens;
        const decision = await decideHarnessRound({
          sessionDir: this.sessions.sessionDir,
          sessionId: sessionId!,
          lastAssistant: lastAssistantContent,
          tokensDelta,
          cwd: effectiveWorkingDir || this.projectRoot,
          aux: this.auxModelCaller,
          preset: helper,
          fallbackPreset: this.currentPreset ?? initialPreset,
          abortSignal: effectiveAbortSignal,
          queuedUser: this.messageQueue.size(sessionId!) > 0,
        });
        if (decision.action === "continue") {
          appendSessionEvent(this.sessions, sessionId!, {
            kind: "runtime_control",
            content: decision.directive,
            source: "goal",
            author: authorSystem("goal", "goal"),
            meta: { round: currentRound },
          });
          yield this.event("session_inject", {
            kind: "runtime_control",
            source: "goal",
            content: "goal continue",
            round: currentRound,
            author: { type: "system", id: "goal", displayName: "goal" },
          });
          this.finishAgentRoundContext(sessionId!);
          await this.hooks?.agentStop(currentRound);
          roundCount++;
          continue;
        }
        if (decision.action === "complete" || decision.action === "pause") {
          const spoken = decision.action === "complete" ? decision.summary : decision.message;
          const loopDurationMs = loopDurationSinceLastUser(
            this.sessions,
            sessionId!,
            Date.now(),
          );
          this.sessions.appendMessage(sessionId!, "assistant", spoken, {
            kind: "assistant_turn",
            source: "assistant",
            author: authorAgent(runAgentName || agentName || "assistant", runAgentName || agentName || "ai"),
            agentName: runAgentName || agentName,
            round: currentRound,
            ...(loopDurationMs != null ? { loopDurationMs } : {}),
          });
          yield this.event("assistant", { content: spoken, round: currentRound });
          this.finishAgentRoundContext(sessionId!);
          await this.hooks?.agentStop(currentRound);
          break;
        }
      }

      const stopGate = await this.evaluateStopHook(sessionId!, currentRound, {
        reason: "completed",
        lastAssistant: lastAssistantContent,
      });
      if (stopGate.prevented) {
        for (const ev of this.injectHookContinue(sessionId!, currentRound, "stop", stopGate.inject)) {
          yield ev;
        }
        this.finishAgentRoundContext(sessionId!);
        await this.hooks?.agentStop(currentRound);
        roundCount++;
        continue;
      }
      this.finishAgentRoundContext(sessionId!);
      await this.hooks?.agentStop(currentRound);
      break;
    }

    // ── 步骤1: 监督模式 —— 主 Agent loop 完成，主动推送本轮摘要给 supervisor ──
    // 仅当当前 session 有「进行中」的监督绑定时推送。supervisor 收到后会自动验收
    // （对照 plan 验收标准）：不合格 → 派新需求（通过 MessageBus 回灌，主 Agent 下一轮 poll 到）；
    // 合格 → 向用户发起最终验收。这把控制权从「supervisor 驱动」反转成「主 Agent 持续干活 + supervisor 持续监督」。
    const supervisorBinding = SUPERVISOR_MANAGER.getByMain(sessionId!);
    if (supervisorBinding && supervisorBinding.state === "started") {
      const lastAssistant = String(lastAssistantContent ?? "").slice(0, 2000);
      const toolLine = lastRoundToolSummary
        ? `本轮工具调用：${lastRoundToolSummary}\n`
        : "本轮无工具调用。\n";
      // 收集本轮文件变更 diff（git diff + 过滤），让 supervisor 验收有真实依据
      let diffLine = "";
      try {
        const diff = collectDiff(effectiveWorkingDir || this.projectRoot);
        diffLine = formatDiffForReport(diff) + "\n";
      } catch (err) {
        this.log("warning", `[SUPERVISOR] 收集 diff 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
      const summary =
        `<loop_report>\n` +
        `主 Agent 一轮 loop 已完成（round=${roundCount}, tokens=${totalTokens}）。\n` +
        toolLine +
        diffLine +
        `本轮最终输出：\n${lastAssistant || "(无文本输出)"}\n` +
        `</loop_report>`;
      const supervisorName = supervisorBinding.supervisorAgentName ?? "supervisor";
      try {
        MessageBus.global().send(supervisorName, summary, runAgentName);
        yield this.logEvent("info", `📨 监督模式：本轮 loop 摘要已推送给 supervisor(${supervisorName})`);
      } catch (err) {
        this.log("warning", `[SUPERVISOR] 推送 loop 摘要失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ── 4. 完成 ──
    if (effectiveRoundLimit > 0 && roundCount >= effectiveRoundLimit) {
      yield this.event("round_limit", {
        message: `已达到最大轮次限制 (${effectiveRoundLimit})`,
      });
    }

    // ── 4a. loop_end：投递剩余队列消息（after_loop_complete / after_task_complete / interrupt 模式） ──
    // 此时 run 已退出，interrupt 模式消息也可投递。投递的消息留在 session 里，由下次 run 处理。
    {
      const loopEndMessages = this.messageQueue.dequeueIfReady(sessionId!, "loop_end", {
        runExited: true,
        allTasksComplete: this.checkAllTasksComplete(sessionId!),
      });
      for (const msg of loopEndMessages) {
        const r = this.messageQueue.deliver(sessionId!, msg, this.sessions);
        if (r.delivered) {
          yield this.logEvent("info", `📨 投递队列消息 #${msg.id} (${msg.mode}) 到 session（loop_end）`);
          yield this.event("queued_user", {
            id: msg.id,
            content: msg.message,
            mode: msg.mode,
            source: msg.source,
            phase: "loop_end",
          });
        } else {
          yield this.logEvent("warning", `📨 投递队列消息 #${msg.id} 失败: ${r.reason}`);
        }
      }
      if (loopEndMessages.length > 0) {
        yield this.event("queue_delivered", {
          count: loopEndMessages.length,
          sessionId: sessionId!,
          phase: "loop_end",
          messages: loopEndMessages.map((m) => ({
            id: m.id,
            content: m.message,
            mode: m.mode,
          })),
        });
      }
    }

    // ── 5. 后处理：提取记忆 + 持久化摘要 ──
    const endPost = prof.start("post_processing");
    try {
      const finalSession = this.sessions.load(sessionId!);
      if (finalSession && finalSession.messages.length > 0) {
        // 提取结构化记忆
        const memories = extractMemories(finalSession.messages);
        if (memories.length > 0) {
          const memStore = this.createMemoryStoreFn(this.maouRoot, agentName);
          for (const mem of memories) {
            memStore.store({ ...mem, sourceSessionId: sessionId! });
          }
          this.log("info", `[RUN] extracted ${memories.length} memories`);
        }
      }

      // 持久化滚动摘要
      this.sessionManager.setActiveSession(agentName, sessionId!);
      this.sessionManager.saveState();
    } catch (e) {
      this.log("warn", `[RUN] post-processing failed: ${e}`);
    } finally {
      endPost();
    }

    // ── 性能报告：emit profile 事件 + 日志汇总（定位慢/异常环节）──
    const report = prof.report();
    this.log("info", `[PROFILE]\n${prof.renderText()}`);
    yield this.event("profile", { report });

    await this.hooks?.loopEnd(sessionId!, {
      rounds: roundCount,
      retries: totalRetries,
      totalTokens,
    });
    await this.hooks?.sessionEnd(sessionId!);

    // ── P1-4 生命周期：run 结束 → idle（arm TTL，TTL 后自动 park）──
    lifecycle.setStatus(sessionId, "idle");
    this.noteLedger(sessionId, "turn/end", {});
    this.sessions.markCold(sessionId);
    this.sessions.flush(sessionId);

    // 封印最后一轮 cache 累计
    const lastModel = String(
      (this.currentPreset ?? initialPreset)?.model ?? "",
    );
    const doneCache = promptCacheLedger().sealRound(agentName, sessionId!, lastModel);
    yield this.event("done", {
      sessionId,
      rounds: roundCount,
      retries: totalRetries,
      totalTokens,
      cache: doneCache,
    });
    this.log("info", `[STATS] rounds=${roundCount} retries=${totalRetries} tokens=${totalTokens}`);
    this.log("info", `[RUN] main loop finished, rounds=${roundCount}`);

    if (
      effectiveAbortSignal.aborted &&
      String(internalController.signal.reason ?? "") !== "interrupt_immediately"
    ) {
      this.pauseActiveHarness(sessionId!);
    }

    // ── 6. 清理内部 AbortController（已退出主循环，不再需要 interrupt 能力）──
    this.abortControllers.delete(sessionId);
    // 清理 currentPreset：标识 run 结束，避免 switchPreset 在无运行 run 时误生效
    this.currentPreset = null;
    // ── P2-1：清理 per-session yield 回调（子 Agent run 结束，回调不再有效）──
    this.clearYieldHandler(sessionId);
  }

  /**
   * 主动中断指定 session 的当前 run（用于 MessageQueue interrupt 模式）。
   *
   * 调用后，当前 run 内部的 AbortController 会被 abort。
   * - interrupt_stop / 默认：loop 下一轮检查到 aborted 后退出 run
   * - interrupt_immediately：loop 下一轮检查到 aborted 后**重置 controller 并继续下一轮**，
   *   让 buildMessages 看到队列消息后正常处理（不退出 run）
   *
   * 不存在运行中的 run 时无副作用。
   */
  abortCurrentRun(sessionId: string, reason: string = "interrupt"): void {
    const controller = this.abortControllers.get(sessionId);
    if (controller && !controller.signal.aborted) {
      controller.abort(reason);
      this.log("info", `[RUN] session=${sessionId} 触发 interrupt: ${reason}`);
    }
  }

  /**
   * 运行时切换 model preset —— 下一次 LLM 调用（下一轮）生效。
   *
   * 典型场景：先用快速模型规划 → 通过工具/外部触发切换到慢模型执行。
   *
   * - 仅对当前 run() 进行中的循环生效；无运行中的 run 时仅缓存无效
   *   （下次 run() 启动会用 options.preset 覆盖）。
   * - 下一轮循环开始时检查 currentPreset 与上一轮是否不同，
   *   不同则 yield `model_switched` 事件让 TUI 更新状态栏。
   * - 向后兼容：不调 switchPreset 时行为不变（整轮 run 用同一 preset）。
   * - 不影响辅助调用管道（压缩/路由等仍用 options.preset 解析 helper preset）。
   */
  switchPreset(preset: APIPreset): void {
    if (!this.currentPreset) {
      // 无运行中的 run：仅记录（下次 run() 用 options.preset，不沿用此处缓存）
      this.log("info", `[RUN] switchPreset 在无运行 run 时调用，将不生效（下次 run 用 options.preset）`);
      return;
    }
    const oldModel = this.currentPreset.model ?? "(unknown)";
    this.currentPreset = preset;
    this.log("info", `[RUN] model 切换: ${oldModel} → ${preset.model ?? "(unknown)"}`);
  }

  /**
   * 查询指定 session 是否有运行中的 run（用于 harness 判断是否需要 enqueue interrupt 模式）。
   */
  isRunning(sessionId: string): boolean {
    return this.abortControllers.has(sessionId);
  }

  /**
   * 注入子 Agent 真并行执行器。
   * harness 提供 runFn 后调用此方法，agent_message 工具即可真并行 fork 子 Agent。
   * 未注入时 agent_message 退回 stub 行为。
   */
  setSubagentExecutor(executor: SubagentExecutorLike): void {
    this.subagentExecutor = executor;
  }

  /**
   * 注入 MCP 连接管理器（host/client）。
   * 注入后 run() 会自动加载 `agents/<name>/connections/` 并注册 mcp__* 工具。
   */
  setMcpManager(manager: import("./mcp/manager.js").McpConnectionManager | undefined): void {
    this.mcpManager = manager;
  }

  getMcpManager(): import("./mcp/manager.js").McpConnectionManager | undefined {
    return this.mcpManager;
  }

  /** 控制 run 时是否自动 loadForAgent（测试可关） */
  setMcpAutoLoad(enabled: boolean): void {
    this.mcpAutoLoad = enabled;
  }

  /**
   * 将当前 MCP descriptors 同步到 SubagentExecutor（parentMcpTools + invoker）。
   */
  private syncMcpToSubagentExecutor(): void {
    const manager = this.mcpManager;
    if (!manager || !this.subagentExecutor) return;
    const exec = this.subagentExecutor as {
      setParentMcpTools?: (tools: import("@little-house-studio/types").McpToolDescriptor[]) => void;
      setMcpInvoker?: (invoker: import("@little-house-studio/types").McpToolInvoker | undefined) => void;
    };
    exec.setParentMcpTools?.(manager.listDescriptors());
    exec.setMcpInvoker?.(manager.sessionCount > 0 ? manager.createInvoker() : undefined);
  }

  /**
   * 供 Runtime 门面 / 冒烟：同步 host 工具名集合 + subagent 继承。
   * 调用方应先 manager.syncToRegistry(this.tools)。
   */
  applyMcpHostToolNames(names: string[]): void {
    this._registeredMcpHostTools = new Set(names);
    this.syncMcpToSubagentExecutor();
  }

  /**
   * 设置/清除 session 路径沙箱（subagent project）。
   * createDefaultSubagentRunFn 在子 run 前后调用。
   */
  setSessionPathGuard(
    sessionId: string,
    guard: {
      mode: "inherit" | "hard" | "audit" | "open";
      roots: string[];
      auditRoots?: string[];
    } | null,
  ): void {
    if (guard && (guard.mode === "open" || guard.roots?.length)) {
      this._sessionPathGuards.set(sessionId, guard);
    } else {
      this._sessionPathGuards.delete(sessionId);
    }
  }

  getSessionPathGuard(
    sessionId: string,
  ): {
    mode: "inherit" | "hard" | "audit" | "open";
    roots: string[];
    auditRoots?: string[];
  } | undefined {
    return this._sessionPathGuards.get(sessionId) ?? this._defaultPathGuard;
  }

  /**
   * 默认 pathGuard（所有 session 共用，可被 setSessionPathGuard 覆盖）。
   * Ops 机器管家设 mode=open。
   */
  private _defaultPathGuard?: {
    mode: "inherit" | "hard" | "audit" | "open";
    roots: string[];
    auditRoots?: string[];
  };

  setDefaultPathGuard(
    guard: {
      mode: "inherit" | "hard" | "audit" | "open";
      roots: string[];
      auditRoots?: string[];
    } | null,
  ): void {
    this._defaultPathGuard = guard ?? undefined;
  }

  /**
   * 注册 per-session yield 结果回调（P2-1）。
   *
   * 由 SubagentExecutor.fork 在运行子 Agent 前调用：把子 sessionId 和回调绑定。
   * processToolCalls 会从该 map 读取并注入到子 Agent 的 ToolContext.yieldResult。
   * 子 Agent 调 yield 工具时触发回调 → fork 检测到 → 结束子 Agent 循环。
   */
  setYieldHandler(sessionId: string, handler: ((result: string, summary?: string) => void) | null): void {
    if (handler) {
      this.yieldHandlers.set(sessionId, handler);
    } else {
      this.yieldHandlers.delete(sessionId);
    }
  }

  /**
   * 取 per-session yield 回调（processToolCalls 用此注入 ToolContext.yieldResult）。
   */
  getYieldHandler(sessionId: string): ((result: string, summary?: string) => void) | undefined {
    return this.yieldHandlers.get(sessionId);
  }

  /** 清理 per-session yield 回调（run 结束时调用）。 */
  clearYieldHandler(sessionId: string): void {
    this.yieldHandlers.delete(sessionId);
  }

  /**
   * 注册 MCP 代理工具（P2-4）。
   *
   * fork 子 Agent 时（inheritMcp !== false），SubagentExecutor 把父 Agent 的 MCP 工具
   * 包装成 proxy Tool 实例，通过 runFn 的 options.mcpProxyTools 传入。runFn 调此方法
   * 把 proxy 工具注册到当前 Runtime 的 ToolRegistry，让子 Agent 能调用它们。
   *
   * 注册的工具会记录到 _registeredMcpProxyTools，下次 run() 开始时在工具初始化阶段
   * 清理（与 _registeredSubagentTools 同样的清理时机），避免跨 session 残留。
   *
   * @param tools MCP proxy Tool 实例数组（由 createMcpProxyTools 生成）
   */
  registerMcpProxyTools(tools: import("@little-house-studio/tools").Tool[]): void {
    for (const tool of tools) {
      this.tools.register(tool);
      this._registeredMcpProxyTools.add(tool.definition.name);
    }
  }

  /** 已注册的 MCP proxy 工具名（P2-4），用于下次 run 前清理，避免跨 session 残留。 */
  private _registeredMcpProxyTools: Set<string> = new Set();

  private tickMicroCompactClock(
    sessionId: string,
    sessionMessages: Array<Record<string, unknown>>,
    isFirstLoopOfRun: boolean,
  ): void {
    if (!this.harnessStore) return;
    const engine = new ContextEngine({
      sessionId,
      harnessStore: this.harnessStore,
      extensions: this.contextExtensions,
      microTurn: this.sessions.getMicroTurn(sessionId),
      microRounds: this.microCompactRounds,
    });
    engine.seedWorkingSet(sessionMessages);
    if (isFirstLoopOfRun && engine.getMicroTurn() > 0) engine.noteUserMicroTurn();
    engine.beginAgentMicroTurn();
    this.sessions.setMicroTurn(sessionId, engine.getMicroTurn());
    if (engine.isFromHarness()) engine.save();
  }

  private applyRoundMicroCompactNow(sessionId: string): void {
    if (!this.harnessStore) return;
    const engine = new ContextEngine({
      sessionId,
      harnessStore: this.harnessStore,
      extensions: this.contextExtensions,
      microTurn: this.sessions.getMicroTurn(sessionId),
      microRounds: this.microCompactRounds,
    });
    const msgs = this.sessions.getLlmHistoryMessages(sessionId) as unknown as Array<Record<string, unknown>>;
    engine.seedWorkingSet(msgs);
    engine.applyRoundMicroCompact();
    this.sessions.setMicroTurn(sessionId, engine.getMicroTurn());
  }

  private finishAgentRoundContext(sessionId: string): void {
    try {
      this.fileDiffWatch?.onAgentRoundEnd(sessionId);
    } catch {
      /* ignore */
    }
    try {
      this.applyRoundMicroCompactNow(sessionId);
    } catch {
      /* ignore */
    }
  }

  // ── 工具调用处理 ──

  /**
   * 执行工具调用，yield 工具相关事件。
   * 返回 true 表示应继续 agent 循环。
   */
  private async *processToolCalls(
    sessionId: string,
    round: number,
    toolCalls: LLMToolCall[],
    sandboxMode: string,
    agentName: string,
    prof?: Profiler,
    compressionLevel: "off" | "normal" | "aggressive" = "normal",
    workingDir?: string,
    currentPreset?: APIPreset,
  ): AsyncGenerator<StreamEvent, boolean> {
    // 工具调用前自动快照
    if (this.checkpointStore.shouldAutoCheckpoint("tool_call")) {
      this.checkpointStore.createCheckpoint(
        sessionId,
        `auto_before_tool_round_${round}`,
        true,
        "tool_call",
      );
    }

    const context = buildToolContext({
      sessionId,
      projectRoot: this.projectRoot,
      promptRoot: this.compiler.promptRoot,
      maouRoot: this.maouRoot,
      sandboxMode,
      permissionPreset: typeof this.sessions.readMeta(sessionId)?.permission_preset === "string"
        ? String(this.sessions.readMeta(sessionId)?.permission_preset)
        : undefined,
      parentSessionId: this.sessions.load(sessionId)?.parentSessionId,
      agentName,
      workingDir: workingDir ?? this.projectRoot,
      pathGuard: this.getSessionPathGuard(sessionId ?? ""),
      compressionLevel,
      terminalBackend: this.agentTerminalBackend,
      computerUseMode: this.agentComputerUseMode,
      skillOptions: this.skillOptions,
      subagentExecutor: this.subagentExecutor as never,
      callMainAgentFn: this.callMainAgentFn,
      auxModelCaller: this.auxModelCaller as never | undefined,
      currentPreset: currentPreset ?? this.currentPreset ?? undefined,
      resolveHelperPresetFn: this.resolveHelperPresetFn
        ? (this.resolveHelperPresetFn as (agentName: string, mainPreset: unknown) => unknown)
        : undefined,
      yieldResult: this.getYieldHandler(sessionId ?? ""),
      sessionLedger: sessionId
        ? bindSessionLedgerPort(this.sessions.sessionDir, sessionId)
        : undefined,
      sessionGoal: sessionId ? this.bindGoalPort(sessionId) : undefined,
      hostVerifiedGoalOpen: sessionId
        ? goalHarness.isOpen(this.sessions.sessionDir, sessionId)
        : false,
      sessionPlan: sessionId
        ? bindSessionPlanPort(this.sessions.sessionDir, sessionId)
        : undefined,
      planFile: sessionId ? sessionPlanFile(this.sessions.sessionDir, sessionId) : undefined,
      agentMode: "execute",
    });

    // ── 同轮资源冲突：多写同一 path / 相同破坏性终端命令 → 后者不执行 ──
    const resourceConflicts = findSameRoundResourceConflicts(toolCalls);
    const blockedByConflict = new Map(
      resourceConflicts.map((c) => [c.index, c] as const),
    );
    if (resourceConflicts.length > 0) {
      yield this.logEvent(
        "warning",
        `同轮资源冲突 ${resourceConflicts.length} 处：${resourceConflicts.map((c) => `#${c.index + 1}:${c.toolName}`).join(", ")}`,
      );
    }

    // ── 按 parallelSafe / blocking 分组执行 ──
    // 连续的 parallelSafe（只读）工具合并为并发组并行执行；其余串行。
    // blocking=false 的工具（后台 fire-and-forget）：立即提交占位 tool_result，
    //   后台异步执行真实工具，loop 不等待直接进下一轮。
    // 执行可并发，但「提交」（落盘 raw + 写 session 消息 + yield 事件）严格按调用顺序，
    // 保证下一轮 LLM 看到的工具结果顺序与调用顺序一致。
    //
    // UX：阻塞工具在**开始执行前**先 yield tool_call，前端立刻出卡片（意图→过程→结果），
    // 不再等工具跑完才把 call+result 一起吐出。
    //
    // 收集本轮所有「真实执行」（非 background）工具的 ok 状态，
    // 用于 endsLoop 判定时考虑执行失败（todo_finish 失败时不应退出 loop）。
    const executedTools: { name: string; ok: boolean }[] = [];

    const emitSkippedResult = (
      tc: LLMToolCall,
      message: string,
      code: string,
    ): StreamEvent[] => {
      const now = () => new Date().toISOString();
      const fail = toolFail("precondition", message, {
        code,
        details: { toolName: tc.name },
      });
      const events: StreamEvent[] = [];
      this.sessions.appendRawEntry(sessionId, {
        type: "tool_call",
        round,
        created_at: now(),
        data: {
          name: tc.name,
          parameters: tc.parameters ?? {},
          id: tc.id,
          provider: tc.provider,
          tool_type: tc.type,
        },
      });
      events.push(
        this.event("tool_call", {
          tool: {
            id: tc.id,
            name: tc.name,
            parameters: tc.parameters ?? {},
            provider: tc.provider,
            type: tc.type,
          },
          round,
        }),
      );
      this.sessions.appendRawEntry(sessionId, {
        type: "tool_result",
        round,
        created_at: now(),
        data: {
          tool_name: tc.name,
          tool_call_id: tc.id,
          content: fail.message,
          ok: false,
          error: fail.error,
        },
      });
      events.push(
        this.event("tool_result", {
          toolCallId: tc.id,
          name: tc.name,
          content: fail.message,
          ok: false,
          round,
          error: fail.error,
          errorCategory: fail.error?.category,
          durationMs: 0,
        }),
      );
      this.persistToolResult(
        sessionId,
        {
          name: tc.name,
          content: fail.message,
          ok: false,
          toolCallId: tc.id,
          error: fail.message,
        },
        {
          round,
          source: "tool",
          meta: {
            tool_error: fail.error,
            tool_error_category: fail.error?.category,
          },
        },
      );
      return events;
    };

    const emitConflictResult = (tc: LLMToolCall, conflictMsg: string): StreamEvent[] =>
      emitSkippedResult(tc, conflictMsg, "resource_conflict");

    const emitCancelledResult = (tc: LLMToolCall): StreamEvent[] =>
      emitSkippedResult(
        tc,
        `工具 ${tc.name} 还没开始执行，已被取消。`,
        CANCELLED_NOT_STARTED,
      );

    let i = 0;
    while (i < toolCalls.length) {
      if (this.abortControllers.get(sessionId)?.signal.aborted) {
        while (i < toolCalls.length) {
          if (!blockedByConflict.has(i)) {
            for (const ev of emitCancelledResult(toolCalls[i]!)) yield ev;
            executedTools.push({ name: toolCalls[i]!.name, ok: false });
          }
          i++;
        }
        break;
      }
      const tc = toolCalls[i];
      const conflict = blockedByConflict.get(i);
      if (conflict) {
        for (const ev of emitConflictResult(tc, conflict.message)) yield ev;
        executedTools.push({ name: tc.name, ok: false });
        i++;
        continue;
      }

      // blocking=false：fire-and-forget 后台执行，立即占位
      if (!this.toolIsBlocking(tc.name)) {
        yield this.logEvent("info", `后台派发非阻塞工具: ${tc.name}`);
        // 立即提交占位 tool_result（让 LLM 知道任务已派发，不阻塞 loop）
        for (const ev of this.commitBackgroundToolCall(tc, round, sessionId)) yield ev;
        // fire-and-forget 后台执行（不 await，错误吞掉避免 unhandledRejection）
        this.execOneToolCall(tc, round, sessionId, context, prof, { background: true })
          .then((commit) => {
            // 后台执行完成后：
            // - raw 日志已写入（commit 内 appendRawEntry）
            // - tool_result 事件已 emit（前端可通过事件流看到）
            // - 占位已配对，真实结果走 appendToolResult → 自动写成 user
            try {
              for (const ev of commit()) {
                // 后台结果通过 log 上报（无法 yield 到主生成器，因为已过提交点）
                if (ev.type === "log") this.log("info", ev.message ?? "");
              }
            } catch { /* ignore */ }
          })
          .catch((err) => this.log("warning", `[BG] 后台工具 ${tc.name} 执行失败: ${err}`));
        i++;
        continue;
      }

      if (this.toolIsParallelSafe(tc.name) && !this.toolIsExclusive(tc.name)) {
        const group: LLMToolCall[] = [];
        while (
          i < toolCalls.length &&
          this.toolIsParallelSafe(toolCalls[i].name) &&
          !this.toolIsExclusive(toolCalls[i].name)
        ) {
          // blocking=false 已在循环开头 continue 跳过，这里不再检查
          group.push(toolCalls[i]);
          i++;
        }
        // 先公告整组 tool_call，再并行执行——前端同时看到多张「进行中」卡
        for (const g of group) {
          for (const ev of this.announceToolCall(g, round, sessionId)) yield ev;
        }
        if (group.length > 1) {
          yield this.logEvent("info", `并行执行 ${group.length} 个只读工具: ${group.map(g => g.name).join(", ")}`);
        }
        const commits = await Promise.all(
          group.map((g) =>
            this.execOneToolCall(g, round, sessionId, context, prof, { announced: true }),
          ),
        );
        for (let k = 0; k < commits.length; k++) {
          const events = commits[k]();
          for (const ev of events) yield ev;
          // 从 tool_result 事件里提取 ok 状态
          const tr = events.find((e) => e.type === "tool_result");
          if (tr && typeof tr.ok === "boolean") {
            executedTools.push({ name: group[k].name, ok: tr.ok });
          } else {
            // 理论上不可能：每次 execOneToolCall 的 commit 必返回 tool_result 事件
            executedTools.push({ name: group[k].name, ok: false });
          }
        }
      } else {
        // 串行：先公告再执行
        for (const ev of this.announceToolCall(toolCalls[i], round, sessionId)) yield ev;
        const commit = await this.execOneToolCall(
          toolCalls[i],
          round,
          sessionId,
          context,
          prof,
          { announced: true },
        );
        const events = commit();
        for (const ev of events) yield ev;
        const tr = events.find((e) => e.type === "tool_result");
        if (tr && typeof tr.ok === "boolean") {
          executedTools.push({ name: toolCalls[i].name, ok: tr.ok });
        } else {
          executedTools.push({ name: toolCalls[i].name, ok: false });
        }
        i++;
      }
    }

    await this.hooks?.postToolBatch({
      sessionId,
      round,
      tools: executedTools,
    });

    // ③ per-tool loop 控制 + task 表接管 loop 条件（#2）：
    // 优先用模板的 loop.ts 脚本（shouldContinueLoop）自定义判定；无脚本则走内联逻辑：
    // 一轮内若所有被调工具都是 endsLoop（收尾型，如 todo_finish），默认结束 loop；
    // 但若当前 session 的 todo 清单还有未完成项，强制继续下一轮——
    // 让 AI 必须把所有规划 todo 做完才能退出（todo 清单接管 loop 条件）。
    //
    // 失败兜底：endsLoop 工具执行失败（ok=false）时，不退出 loop，
    // 让 AI 看到错误信息后继续处理（否则 todo_finish 失败也会退出 loop，用户卡死）。
    const toolCallsCtx = toolCalls.map((tc) => ({ name: tc.name, endsLoop: this.toolEndsLoop(tc.name) }));
    const endsLoopFailed = executedTools.some(
      (t) => this.toolEndsLoop(t.name) && t.ok === false,
    );
    let tasksIncomplete = false;
    try {
      const root = TODO_ORCHESTRATOR.resolveRootSession(sessionId);
      const tasks = TASK_MANAGER.getTasks(root);
      // 仍有 pending/in_progress 则未完成；failed/cancelled/completed 均为终态
      tasksIncomplete =
        tasks.length > 0 &&
        tasks.some((t) => t.status === "pending" || t.status === "in_progress");
    } catch (err) {
      // 读取失败不应中断整个 run：降级为"无未完成任务"，让 endsLoop 正常判定。
      this.log("warn", `[Runtime] TaskManager 读取失败，降级为无未完成任务: ${err}`);
    }

    // 工具结果之后：注入 todo system_notice + 可能的 nudge（在 loop 判定前，保证下一轮可见）
    this.afterTodoTools(sessionId, toolCalls.length > 0);

    // 有未完成 todo 时清掉「收尾轮」标记，确保整单做完后仍能再给一轮收尾
    if (tasksIncomplete) {
      this._todoFinalReplyGranted.delete(sessionId);
    }

    // 优先：模板 loop.ts 脚本自定义判定
    const loopScript = await this._loadLoopScript(agentName);
    if (loopScript) {
      try {
        const cont = loopScript({
          toolCalls: toolCallsCtx,
          endsLoopFailed,
          tasksIncomplete,
          round: round,
        });
        // 脚本返回 false 且全部 todo 完成时，仍给一轮用户可见收尾（脚本不知道此语义）
        if (!cont && !tasksIncomplete && !endsLoopFailed) {
          const allEndsLoop = !toolCallsCtx.some((tc) => !tc.endsLoop);
          if (allEndsLoop && !this._todoFinalReplyGranted.has(sessionId)) {
            this._todoFinalReplyGranted.add(sessionId);
            this.log("info", "[Runtime] todo 已全部完成：再给一轮收尾回复，不强制继续工具 loop");
            return true;
          }
        }
        return Boolean(cont);
      } catch (err) {
        this.log("warn", `[Runtime] loop.ts 脚本执行失败，回退内联判定: ${err}`);
      }
    }

    // 内联判定（默认）
    const allEndsLoop = !toolCallsCtx.some((tc) => !tc.endsLoop);
    if (allEndsLoop) {
      if (endsLoopFailed) {
        this.log("warn", "[Runtime] endsLoop 工具执行失败（ok=false），不退出 loop，让 AI 继续处理");
        return true;
      }
      if (tasksIncomplete) {
        return true; // 还有未完成 todo，强制继续 loop
      }
      // 全部 todo 完成：再给一轮写用户可见收尾（dynamic-context 也提示「可回复用户收尾」）。
      // 不再注入「请继续」类强制工具轮；下一轮若只再调 endsLoop 则真正结束。
      if (!this._todoFinalReplyGranted.has(sessionId)) {
        this._todoFinalReplyGranted.add(sessionId);
        this.log("info", "[Runtime] todo 已全部完成：再给一轮收尾回复");
        return true;
      }
      return false;
    }
    return true;
  }

  /**
   * 加载模板的 loop.ts 脚本（shouldContinueLoop）。
   * 路径：<实例或模板>/loop/loop.ts。动态 import，缓存。
   * 失败/不存在返回 null（走内联判定）。
   */
  private _loopScriptCache = new Map<string, ((ctx: LoopScriptCtx) => boolean) | null>();
  /**
   * todo 全部完成后，允许「再跑一轮」写用户可见收尾。
   * 消费一次后清除；新的未完成 todo 出现时会重置。
   */
  private _todoFinalReplyGranted = new Set<string>();
  private async _loadLoopScript(agentName: string): Promise<((ctx: LoopScriptCtx) => boolean) | null> {
    if (this._loopScriptCache.has(agentName)) return this._loopScriptCache.get(agentName)!;
    let script: ((ctx: LoopScriptCtx) => boolean) | null = null;
    try {
      // global 作用域（如 ops）只查 <maouRoot>/agents，避免误用 projectRoot 下的 .maou/agents
      const registry = new AgentRegistry(
        this.maouRoot,
        this.agentScope === "project" ? this.projectRoot : undefined,
      );
      const dir = registry.resolveAgentDir(agentName);
      // 引用模式：从 .agent.ref 找模板目录的 loop.ts
      const templateDir = getTemplateRef(dir) ?? dir;
      const loopTsPath = join(templateDir, "loop", "loop.ts");
      if (existsSync(loopTsPath)) {
        const mod = await import(loopTsPath);
        const fn = mod.default ?? mod.shouldContinueLoop;
        if (typeof fn === "function") script = fn as (ctx: LoopScriptCtx) => boolean;
      }
    } catch {
      // 加载失败走内联
    }
    this._loopScriptCache.set(agentName, script);
    return script;
  }

  /** 该工具调用后是否终止 loop（收尾型，如 todo_finish）。 */
  private toolEndsLoop(name: string): boolean {
    try {
      return Boolean(this.tools.get(name)?.definition.endsLoop);
    } catch {
      return false;
    }
  }

  /**
   * 检查 toolCall 是否缺必填参数。
   * - 找不到工具定义时返回空数组（不拦截，让 executor 自己报错）
   * - 工具 schema 无 required 时返回空数组（所有参数都可选）
   * - 否则返回缺失的 required 参数名数组
   *
   * 注意：空字符串 / null / undefined 都算「缺失」，但 false / 0 / 空数组 不算。
   */
  private collectMissingRequiredParams(toolCall: LLMToolCall): string[] {
    const tool = this.tools.get(toolCall.name);
    return collectMissingRequiredParams(tool, toolCall.parameters ?? {});
  }

  /**
   * 运行完成前验证命令（如 npm run typecheck）。
   * 在项目根用 shell 执行，限时 120s，截断输出。失败/超时返回 ok:false + 输出。
   */
  private async runVerify(command: string): Promise<{ ok: boolean; code: number; output: string }> {
    const { exec } = await import("node:child_process");
    return await new Promise((resolve) => {
      const child = exec(command, { cwd: this.projectRoot, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const out = `${stdout ?? ""}${stderr ?? ""}`.trim();
          const tail = out.length > 6000 ? "…(已截断)\n" + out.slice(-6000) : out;
          const code = error && typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : (error ? 1 : 0);
          resolve({ ok: !error, code, output: tail || "(无输出)" });
        });
      child.on("error", () => resolve({ ok: false, code: 1, output: `无法执行: ${command}` }));
    });
  }

  /**
   * 工作区改动摘要（① diff 自动注入动态区）：
   * 跑 `git status --porcelain`，解析成 新增/修改/删除 文件名单，注入动态区（不入持久历史）。
   * 让 agent 实时看到「相对 git HEAD 改了哪些文件」。非 git 仓库/无改动 → 空串。
   */
  private async workspaceChanges(): Promise<string> {
    const workingDir = this.effectiveWorkingDir || this.projectRoot;
    try {
      const { exec } = await import("node:child_process");
      const porcelain: string = await new Promise((resolve) => {
        exec("git status --porcelain", { cwd: workingDir, timeout: 5000, maxBuffer: 1024 * 1024 },
          (err, stdout) => resolve(err ? "" : (stdout ?? "")));
      });
      if (!porcelain.trim()) return "";
      const added: string[] = [], modified: string[] = [], deleted: string[] = [];
      for (const line of porcelain.split("\n")) {
        if (!line.trim()) continue;
        const code = line.slice(0, 2);
        const file = line.slice(3).trim();
        if (code.includes("D")) deleted.push(file);
        else if (code.includes("A") || code === "??") added.push(file);
        else modified.push(file);
      }
      const cap = (a: string[]) => a.length > 30 ? `${a.slice(0, 30).join(", ")} …(+${a.length - 30})` : a.join(", ");
      const lines: string[] = [];
      if (added.length) lines.push(`  新增(${added.length}): ${cap(added)}`);
      if (modified.length) lines.push(`  修改(${modified.length}): ${cap(modified)}`);
      if (deleted.length) lines.push(`  删除(${deleted.length}): ${cap(deleted)}`);
      if (!lines.length) return "";
      return `<workspace_changes>\n工作区相对 git HEAD 的改动：\n${lines.join("\n")}\n</workspace_changes>`;
    } catch {
      return "";
    }
  }

  /** 该工具是否标注为单轮可并行（只读、无副作用）。查不到默认串行（安全）。 */
  private toolIsParallelSafe(name: string): boolean {
    try {
      return Boolean(this.tools.get(name)?.definition.parallelSafe);
    } catch {
      return false;
    }
  }

  private toolIsExclusive(name: string): boolean {
    try {
      return toolActsExclusive(this.tools.get(name)?.definition);
    } catch {
      return true;
    }
  }

  /**
   * 该工具是否阻塞 loop 等待真实结果。
   * 缺省 true（阻塞）；显式 blocking=false 的是后台 fire-and-forget 工具。
   */
  private toolIsBlocking(name: string): boolean {
    try {
      const def = this.tools.get(name)?.definition;
      return def?.blocking !== false; // 缺省/true → 阻塞；仅 false 才非阻塞
    } catch {
      return true;
    }
  }

  /**
   * 检查 session 的 task 表是否全部完成（消息队列 task_complete 判定依据）。
   * 没有 task 表时返回 false（不能触发 after_task_complete 投递）。
   */
  private checkAllTasksComplete(sessionId: string): boolean {
    return isTodoPlanSettledHelper(sessionId);
  }

  /**
   * 将 TodoOrchestrator 待投递 notice 追加为靠后 user 消息（保护 prompt cache）。
   * 仅注入 targetSessionId === 当前 session 的条目；其余 requeue。
   */
  private flushTodoNotices(sessionId: string): number {
    return flushTodoNoticesHelper(this.sessions, sessionId);
  }

  /** 工具轮次后：flush notice + 空转催促 */
  private afterTodoTools(sessionId: string, hadToolCalls: boolean): void {
    afterTodoToolsHelper(this.sessions, sessionId, hadToolCalls);
  }

  /** 工具回包唯一写入口：同一 toolCallId 第一次 role=tool，之后自动 role=user。 */
  private persistToolResult(
    sessionId: string,
    input: Parameters<typeof appendToolResult>[2],
    extra: Parameters<typeof appendToolResult>[3] = {},
  ) {
    return appendToolResult(this.sessions, sessionId, input, extra);
  }

  /**
   * 同步提交一个「后台派发」占位 tool_result（用于 blocking=false 的工具）。
   *
   * 不执行真实工具，只写入占位结果让 LLM 知道任务已派发、loop 可立即进下一轮。
   * 真实工具执行由调用方 fire-and-forget 启动。
   */
  private commitBackgroundToolCall(
    toolCall: LLMToolCall,
    round: number,
    sessionId: string,
  ): StreamEvent[] {
    const events: StreamEvent[] = [];
    const now = () => new Date().toISOString();
    const placeholder = `[后台执行] 工具 ${toolCall.name} 已派发，不等待真实结果。`;

    this.sessions.appendRawEntry(sessionId, {
      type: "tool_call",
      round,
      created_at: now(),
      data: { name: toolCall.name, parameters: toolCall.parameters, id: toolCall.id, provider: toolCall.provider, tool_type: toolCall.type, background: true },
    });
    events.push(this.event("tool_call", {
      tool: { id: toolCall.id, name: toolCall.name, parameters: toolCall.parameters, provider: toolCall.provider, type: toolCall.type },
      round,
    }));
    events.push(this.logEvent("info", `后台派发工具: ${toolCall.name}`));

    this.sessions.appendRawEntry(sessionId, {
      type: "tool_result", round, created_at: now(),
      data: { tool_name: toolCall.name, tool_call_id: toolCall.id, content: placeholder, ok: true, background: true },
    });
    events.push(this.event("tool_result", { toolCallId: toolCall.id, name: toolCall.name, content: placeholder, ok: true, round, background: true }));
    this.persistToolResult(
      sessionId,
      {
        name: toolCall.name,
        content: placeholder,
        ok: true,
        toolCallId: toolCall.id,
      },
      {
        round,
        source: "tool",
        meta: {
          tool_provider: toolCall.provider,
          tool_type: toolCall.type,
          tool_parameters: toolCall.parameters,
          background: true,
        },
      },
    );
    return events;
  }

  /**
   * 执行前公告 tool_call（前端立刻出卡），与 execOneToolCall({ announced:true }) 配对。
   * 落 raw + yield tool_call，保证「意图」先于执行可见。
   */
  private announceToolCall(
    toolCall: LLMToolCall,
    round: number,
    sessionId: string,
  ): StreamEvent[] {
    const now = () => new Date().toISOString();
    this.sessions.appendRawEntry(sessionId, {
      type: "tool_call",
      round,
      created_at: now(),
      data: {
        name: toolCall.name,
        parameters: toolCall.parameters ?? {},
        id: toolCall.id,
        provider: toolCall.provider,
        tool_type: toolCall.type,
      },
    });
    return [
      this.event("tool_call", {
        tool: {
          id: toolCall.id,
          name: toolCall.name,
          parameters: toolCall.parameters ?? {},
          provider: toolCall.provider,
          type: toolCall.type,
        },
        round,
      }),
      this.logEvent("info", `执行工具: ${toolCall.name}`),
    ];
  }

  /**
   * 执行单个工具调用（异步部分），返回一个 commit 闭包。
   * commit() 同步执行所有有序副作用（落盘 raw + 写 session 消息）并返回需 yield 的事件数组。
   * 拆分「执行」与「提交」，使并发组可并行执行、按序提交。
   *
   * opts.announced：调用方已用 announceToolCall 推过 tool_call 时置 true，
   * commit 时不再重复写 raw / yield tool_call。
   */
  private async execOneToolCall(
    toolCall: LLMToolCall,
    round: number,
    sessionId: string,
    context: ToolContext,
    prof?: Profiler,
    opts?: { background?: boolean; announced?: boolean },
  ): Promise<() => StreamEvent[]> {
    const tcInfo = { id: toolCall.id, name: toolCall.name, parameters: toolCall.parameters };
    // background=true：占位已由 commitBackgroundToolCall 配对；真实结果仍要落盘，
    // appendToolResult 会自动改写成 role=user。
    const background = opts?.background ?? false;
    const announced = opts?.announced ?? false;

    // ── 前置校验：必填参数缺失时提前拦截，避免浪费一轮执行 ──
    // LLM 有时产生不完整的 tool_call（缺必填参数），此时直接返回引导性错误。
    // 注意：参数为空但工具 schema 没有任何 required 时，不拦截——有些工具所有参数都可选。
    const missingRequired = this.collectMissingRequiredParams(toolCall);
    if (missingRequired.length > 0) {
      const failRes = missingRequiredToolResponse(toolCall.name, missingRequired);
      const emptyMsg = failRes.message;
      const toolError = failRes.error;
      this.log("warn", `[Runtime] 拦截缺参数工具调用: ${toolCall.name} (round=${round}, missing=${missingRequired.join(",")})`);
      await this.hooks?.postToolUseFailure(tcInfo, {
        toolCallId: toolCall.id,
        name: toolCall.name,
        output: emptyMsg,
        success: false,
        error: toolError?.category ?? "invalid_args",
        elapsed: 0,
      } as never);
      return (): StreamEvent[] => {
        const now = () => new Date().toISOString();
        const events: StreamEvent[] = [];
        if (!background && !announced) {
          this.sessions.appendRawEntry(sessionId, { type: "tool_call", round, created_at: now(), data: { name: toolCall.name, parameters: toolCall.parameters ?? {}, id: toolCall.id, provider: toolCall.provider, tool_type: toolCall.type } });
          events.push(this.event("tool_call", { tool: { id: toolCall.id, name: toolCall.name, parameters: toolCall.parameters ?? {}, provider: toolCall.provider, type: toolCall.type }, round }));
        }
        this.sessions.appendRawEntry(sessionId, {
          type: "tool_result", round, created_at: now(),
          data: { tool_name: toolCall.name, tool_call_id: toolCall.id, content: emptyMsg, ok: false, background, error: toolError },
        });
        events.push(this.event("tool_result", {
          toolCallId: toolCall.id, name: toolCall.name, content: emptyMsg, ok: false, round, background,
          error: toolError, errorCategory: toolError?.category,
        }));
        this.persistToolResult(
          sessionId,
          {
            name: toolCall.name,
            content: emptyMsg,
            ok: false,
            toolCallId: toolCall.id,
            error: emptyMsg,
          },
          {
            round,
            source: "tool",
            meta: {
              tool_error: toolError,
              tool_error_category: toolError?.category,
            },
          },
        );
        return events;
      };
    }

    // pre_tool_use / tools/pre-execute（deny / ask）+ fs/*-intent
    let blocked = this.hooks
      ? !(await this.gateToolCall(tcInfo, sessionId, round))
      : false;
    let barrierBlockReason: string | undefined;

    let result: Awaited<ReturnType<ToolExecutor["executeSingle"]>> | null = null;
    let execError: unknown = null;
    // 工具真实耗时：随 tool_result 下发，UI 不必再用「结果到达时刻」倒推
    let toolElapsedMs = 0;
    if (!blocked) {
      this.sessions.flush(sessionId);
      // 落盘屏障：派发意图写不进盘就不动手，否则崩了之后分不清这次到底改了世界没有
      const barrier = this.ledgerBarrier(sessionId, "tool/dispatch", {
        id: toolCall.id,
        name: toolCall.name,
        callId: toolCall.id,
        sideEffect: !/^(read_|list_|search_|grep|glob|ls)/.test(toolCall.name),
      });
      if (!barrier.ok) {
        blocked = true;
        barrierBlockReason = ledgerBarrierHuman("tool/dispatch", barrier.reason);
      }
    }
    if (!blocked) {
      this.sessions.flush(sessionId);
      const endTool = prof?.start(`tool:${toolCall.name}`, { round });
      const toolStartedAt = Date.now();
      try {
        result = await this.toolExecutor.executeSingle(
          { id: toolCall.id, name: toolCall.name, parameters: toolCall.parameters },
          context,
        );
      } catch (err) {
        execError = err;
      } finally {
        // 失败也算耗时（错误同样花了墙钟时间）
        toolElapsedMs = Math.max(0, Date.now() - toolStartedAt);
        endTool?.();
      }
    }

    let toolResultOverride: string | undefined;
    if (execError !== null) {
      const failRes = executeThrownToolResponse(toolCall.name, execError);
      await this.hooks?.toolError(tcInfo, failRes.message);
      const failOut = await this.hooks?.postToolUseFailure(tcInfo, {
        toolCallId: toolCall.id,
        name: toolCall.name,
        output: failRes.message,
        success: false,
        error: failRes.error?.category ?? "thrown",
        elapsed: toolElapsedMs,
      } as never);
      if (failOut?.content !== undefined) {
        toolResultOverride = typeof failOut.content === "string"
          ? failOut.content
          : JSON.stringify(failOut.content);
      }
    } else if (!blocked && result) {
      const normalizedEarly = ensureToolError(result.result);
      let preview = normalizedEarly.message ?? "";
      if (!preview.trim()) {
        const fallback = normalizedEarly.payload;
        preview = fallback
          ? JSON.stringify({ ok: normalizedEarly.ok, payload: fallback })
          : `工具 ${toolCall.name} 执行完成（ok=${normalizedEarly.ok}，无 message）`;
      }
      const failPayload = {
        toolCallId: toolCall.id,
        name: toolCall.name,
        output: preview,
        success: normalizedEarly.ok,
        error: normalizedEarly.ok ? "" : (normalizedEarly.error?.category ?? ""),
        elapsed: toolElapsedMs,
      };
      const hookOut = normalizedEarly.ok
        ? await this.hooks?.postToolUse(tcInfo, failPayload as never)
        : await this.hooks?.postToolUseFailure(tcInfo, failPayload as never);
      if (hookOut?.content !== undefined) {
        toolResultOverride = typeof hookOut.content === "string"
          ? hookOut.content
          : JSON.stringify(hookOut.content);
      }
    }

    // commit：有序副作用 + 事件
    return (): StreamEvent[] => {
      const events: StreamEvent[] = [];
      const now = () => new Date().toISOString();

      // background=true：tool_call 日志由 commitBackgroundToolCall 已写过
      // announced=true：tool_call 已由 announceToolCall 写过
      if (!background && !announced) {
        this.sessions.appendRawEntry(sessionId, {
          type: "tool_call",
          round,
          created_at: now(),
          data: { name: toolCall.name, parameters: toolCall.parameters, id: toolCall.id, provider: toolCall.provider, tool_type: toolCall.type },
        });
        events.push(this.event("tool_call", {
          tool: { id: toolCall.id, name: toolCall.name, parameters: toolCall.parameters, provider: toolCall.provider, type: toolCall.type },
          round,
        }));
        events.push(this.logEvent("info", `执行工具: ${toolCall.name}`));
      }

      if (blocked) {
        const failRes = hookBlockedToolResponse(
          toolCall.name,
          barrierBlockReason ?? this.hooks?.lastBlockReason,
        );
        const blockedMsg = failRes.message;
        const toolError = failRes.error;
        this.sessions.appendRawEntry(sessionId, {
          type: "tool_result", round, created_at: now(),
          data: { tool_name: toolCall.name, tool_call_id: toolCall.id, content: blockedMsg, ok: false, background, error: toolError },
        });
        // 拦截未执行 → 耗时 0（而非「未知」，UI 显示 0ms 而不是空白）
        events.push(this.event("tool_result", {
          toolCallId: toolCall.id, name: toolCall.name, content: blockedMsg, ok: false, round, background, durationMs: 0,
          error: toolError, errorCategory: toolError?.category,
        }));
        this.persistToolResult(
          sessionId,
          {
            name: toolCall.name,
            content: blockedMsg,
            ok: false,
            toolCallId: toolCall.id,
            error: blockedMsg,
          },
          {
            round,
            source: "tool",
            meta: {
              tool_provider: toolCall.provider,
              tool_type: toolCall.type,
              tool_parameters: toolCall.parameters,
              tool_error: toolError,
              tool_error_category: toolError?.category,
            },
          },
        );
        return events;
      }

      if (execError !== null) {
        const failRes = executeThrownToolResponse(toolCall.name, execError);
        const errorMsg = toolResultOverride ?? failRes.message;
        const toolError = failRes.error;
        this.sessions.appendRawEntry(sessionId, {
          type: "tool_result", round, created_at: now(),
          data: { tool_name: toolCall.name, tool_call_id: toolCall.id, content: errorMsg, ok: false, background, error: toolError },
        });
        events.push(this.event("tool_result", {
          toolCallId: toolCall.id, name: toolCall.name, content: errorMsg, ok: false, round, background, durationMs: toolElapsedMs,
          error: toolError, errorCategory: toolError?.category,
        }));
        this.persistToolResult(
          sessionId,
          {
            name: toolCall.name,
            content: errorMsg,
            ok: false,
            toolCallId: toolCall.id,
            error: errorMsg,
            elapsed: toolElapsedMs,
          },
          {
            round,
            source: "tool",
            meta: {
              tool_provider: toolCall.provider,
              tool_type: toolCall.type,
              tool_parameters: toolCall.parameters,
              tool_error: toolError,
              tool_error_category: toolError?.category,
            },
          },
        );
        return events;
      }

      const res = result!;
      const normalized = ensureToolError(res.result);
      // G4: 空字符串 tool_result 会让大部分 LLM API 报 400。
      // ?? 只兜底 null/undefined，空字符串会穿透——所以再判断一次。
      // payload 也要兜底（部分工具只填 payload 不填 message）。
      let toolResultContent = normalized.message ?? "";
      if (!toolResultContent.trim()) {
        const fallback = normalized.payload;
        toolResultContent = fallback
          ? JSON.stringify({ ok: normalized.ok, payload: fallback })
          : `工具 ${toolCall.name} 执行完成（ok=${normalized.ok}，无 message）`;
      }
      if (toolResultOverride !== undefined) {
        toolResultContent = toolResultOverride;
      }
      const toolImages = normalized.images;
      const toolError: ToolErrorInfo | undefined = !normalized.ok
        ? normalized.error
        : undefined;

      this.sessions.appendRawEntry(sessionId, {
        type: "tool_result", round, created_at: now(),
        data: {
          tool_name: toolCall.name,
          tool_call_id: toolCall.id,
          content: toolResultContent,
          ok: normalized.ok,
          background,
          ...(toolError ? { error: toolError } : {}),
        },
      });
      // tool_result 事件带上 displayEvents（supervisor_task_control end 用此机制通知前端切回主 Agent）
      const toolResultEvent: Record<string, unknown> = {
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: toolResultContent,
        ok: normalized.ok,
        round,
        background,
        durationMs: toolElapsedMs,
      };
      if (toolError) {
        toolResultEvent.error = toolError;
        toolResultEvent.errorCategory = toolError.category;
      }
      if (Array.isArray(normalized.displayEvents) && normalized.displayEvents.length > 0) {
        toolResultEvent.displayEvents = normalized.displayEvents;
      }
      events.push(this.event("tool_result", toolResultEvent));
      events.push(this.logEvent(
        "info",
        `工具 ${toolCall.name} 完成: ok=${normalized.ok}` +
          `${!normalized.ok && toolError ? ` category=${toolError.category}` : ""}` +
          `${background ? " [后台]" : ""} ${toolElapsedMs}ms`,
      ));
      // 文件 diff 监听：成功触碰 reader/edit/write 后入名单
      if (normalized.ok && this.fileDiffWatch && sessionId) {
        try {
          this.fileDiffWatch.noteToolTouch(
            sessionId,
            toolCall.name,
            (toolCall.parameters ?? {}) as Record<string, unknown>,
          );
        } catch { /* ignore */ }
      }

      const toolMeta: Record<string, unknown> = {
        tool_provider: toolCall.provider,
        tool_type: toolCall.type,
        tool_parameters: toolCall.parameters,
        background: background || undefined,
      };
      if (toolError) {
        toolMeta.tool_error = toolError;
        toolMeta.tool_error_category = toolError.category;
      }
      this.persistToolResult(
        sessionId,
        {
          name: toolCall.name,
          content: toolResultContent,
          ok: normalized.ok,
          toolCallId: toolCall.id,
          images: toolImages?.length ? toolImages : undefined,
          error: normalized.ok ? undefined : toolResultContent,
          elapsed: toolElapsedMs,
          payload: normalized.payload && typeof normalized.payload === "object"
            ? (normalized.payload as Record<string, unknown>)
            : undefined,
        },
        {
          round,
          source: "tool",
          meta: toolMeta,
        },
      );
      return events;
    };
  }

  // ── 辅助方法 ──

  private event(type: string, data: Record<string, unknown> = {}): StreamEvent {
    return { type, ...data };
  }

  private logEvent(level: string, message: string, detail?: string): StreamEvent {
    return detail
      ? { type: "log", level, message, detail }
      : { type: "log", level, message };
  }

  /** 压缩系统事件：一行摘要 + 可展开详情（阶段 token / 压缩文） */
  private compressLogEvent(report: {
    stage?: string;
    originalTokens?: number;
    compressedTokens?: number;
    droppedSummary?: string;
    taskBlocks?: string[];
  }): StreamEvent {
    const stage = report.stage ?? "?";
    const stageLabel =
      stage === "compactStage"
        ? "微压缩"
        : stage === "summaryStage"
          ? "大压缩"
          : stage === "archiveStage"
            ? "归档"
            : stage === "activeStage"
              ? "未压缩"
              : stage;
    const orig = report.originalTokens;
    const comp = report.compressedTokens;
    const tok =
      orig != null && comp != null
        ? `${orig} → ${comp}`
        : orig != null
          ? `${orig}`
          : "?";
    const save =
      orig != null && comp != null && orig > 0
        ? Math.round(((orig - comp) / orig) * 100)
        : null;
    const oneLine = `上下文已压缩 · ${stageLabel} · token ${tok}${
      save != null ? `（-${save}%）` : ""
    }`;
    const detailParts: string[] = [
      `阶段: ${stageLabel} (${stage})`,
      orig != null || comp != null
        ? `Token: ${orig ?? "?"} → ${comp ?? "?"}${
            save != null ? `  节省 ${save}%` : ""
          }`
        : "Token: （未上报）",
    ];
    if (report.taskBlocks && report.taskBlocks.length > 0) {
      detailParts.push(`任务块: ${report.taskBlocks.join(", ")}`);
    }
    detailParts.push("");
    detailParts.push("── 压缩后摘要（检查是否到位）──");
    const summary = (report.droppedSummary ?? "").trim();
    detailParts.push(summary || "（无摘要正文 · 可能本轮未折叠内容）");
    return this.logEvent("warning", oneLine, detailParts.join("\n"));
  }

  private log(level: string, message: string): void {
    this.logFn(level, message);
  }

  /** 领域事件入统一账本；新功能应 register + 调此，不必再写查询 */
  private noteLedger(
    sessionId: string,
    type: string,
    data: Record<string, unknown>,
  ): void {
    if (isLedgerBarrier(type)) {
      // 屏障事件必须先落盘：写不进去就不能往下走不可逆的一步
      const res = appendLedgerEvent(this.sessions.sessionDir, sessionId, type, data);
      if (res && typeof res === "object" && "error" in res) throw new Error(res.error);
      flushLedger(this.sessions.sessionDir, sessionId);
      return;
    }
    try {
      appendLedgerEvent(this.sessions.sessionDir, sessionId, type, data);
    } catch {
      /* 普通事件不得打断主流程 */
    }
  }

  /**
   * 不可逆动作前的落盘屏障。写不进盘就返回原因，由调用方停手。
   *
   * 模型请求和工具派发都是花钱/改世界的一步：先把"我要做这件事"落到账本上，
   * 崩了之后冷恢复才能判断这一步到底有没有发生。
   */
  private ledgerBarrier(
    sessionId: string,
    type: string,
    data: Record<string, unknown>,
  ): { ok: true } | { ok: false; reason: string } {
    try {
      this.noteLedger(sessionId, type, data);
      return { ok: true };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.log("error", `[ledger-barrier] ${type} 未落盘：${reason}`);
      return { ok: false, reason };
    }
  }

  private writeCompactBracket(
    sessionId: string,
    phase: "start" | "summary" | "end",
    data: Record<string, unknown>,
  ): void {
    if (phase === "start") this.noteLedger(sessionId, "compact/start", data);
    else if (phase === "summary") this.noteLedger(sessionId, "compact/summary", data);
    else this.noteLedger(sessionId, "compact/end", data);
  }

  private recordCompactSurface(
    sessionId: string,
    source: string,
    report: {
      stage: string;
      originalTokens?: number;
      compressedTokens?: number;
      droppedSummary?: string;
      seqFrom?: number;
      seqTo?: number;
    },
  ): void {
    const range = compactSeqRange(report);
    this.writeCompactBracket(sessionId, "summary", {
      stage: report.stage,
      source,
      originalTokens: report.originalTokens,
      compressedTokens: report.compressedTokens,
      summary: report.droppedSummary,
      ...range,
    });
    this.sessions.appendMessage(sessionId, "user", report.droppedSummary || "上下文已压缩", {
      kind: "compact",
      source: "compact",
      ...(range.seqFrom != null
        ? { surfaceOp: { op: "replace" as const, start: range.seqFrom, end: range.seqTo! } }
        : {}),
    });
    this.sessions.bumpReplaceGeneration(sessionId);
    this.writeCompactBracket(sessionId, "end", {
      stage: report.stage,
      source,
      originalTokens: report.originalTokens,
      compressedTokens: report.compressedTokens,
      ...range,
    });
  }

  /**
   * 取回被压缩顶掉的那段原文（seq 闭区间，读压缩前的全量备份）。
   *
   * 摘要里的 seqRange 与 compact/end 账本的 seqFrom/seqTo 都指向这里。
   */
  getCompactedRange(sessionId: string, from: number, to: number): LLMMessage[] | null {
    const msgs = this.harnessStore?.getSeqRange(sessionId, from, to);
    if (!msgs || msgs.length === 0) return null;
    return msgs.map(maouToLLMMessage);
  }

  /**
   * MAOU_CONTEXT_ASSERT=1 时对比本轮与上轮的稳定前缀，漂移就大声报警。
   *
   * 断言关着时 takeContextStructure() 恒为 null，整条路径不花钱。
   */
  private assertContextStructure(sessionId: string): void {
    const built = takeContextStructure();
    if (!built) return;
    const generation = this.sessions.readMeta(sessionId)?.replace_generation ?? 0;
    const next = { ...built, generation };
    const drift = describeContextDrift(this.sessions.readContextAssert(sessionId), next);
    if (drift) this.log("error", `[context-assert] ${drift}`);
    this.sessions.writeContextAssert(sessionId, next);
  }

  private scheduleTitlePolish(sessionId: string): void {
    const caller = this.auxModelCaller;
    const preset = this.currentPreset;
    if (!caller || !preset) return;
    void polishSessionTitle(this.sessions, sessionId, async (draft) => {
      const r = await caller.callText({
        preset,
        systemPrompt: "把会话标题压成不超过 24 个字的短语，不要引号，不要句号。",
        userPrompt: draft,
        context: { tag: "session_title" },
      });
      return r.ok ? r.content : draft;
    }).catch(() => {
      /* 润色失败保留 draft */
    });
  }

  private errorCallResult(error: string): ModelCallResult {
    return ModelCaller.createErrorResult(error);
  }

  /**
   * 超窗 / 出征前：强制把整包 prompt 压到可发送范围。
   *
   * 策略（随 attempt 加码）：
   *  1) ContextEngine force compress（历史目标更矮）
   *  2) 重建 messages 时去掉 memory/动态注入等固定 extras（leanExtras）
   *  3) 仍超 → emergencyTrimMessages 砍中间历史
   *
   * 保证 harness 落盘，下轮 seed 可续聊，避免「只能新话题」。
   */
  private async forceShrinkPromptForOverflow(opts: {
    sessionId: string;
    contextLimit: number;
    attempt: number;
    engineEnabled: boolean;
    runSummarizer?: Summarizer;
    systemPrompt: string;
    toolSchemas: unknown;
    sessionMessages: Array<Record<string, unknown>>;
    effectiveBeforeUser: string;
    currentDynamicInjections: string;
    structuredMemory: string;
    rollingSummary: string;
    platformContext?: unknown;
    projectRoot?: string;
    userName: string;
    roundCount: number;
    currentRound: number;
    activeUserMessage: string;
    finalMessages: Array<Record<string, unknown>>;
    leanExtras: boolean;
  }): Promise<{
    /** 压缩或截断是否改变了发出去的消息 */
    ok: boolean;
    finalMessages: Array<Record<string, unknown>>;
    compressedHistory?: LLMMessage[];
    estimatedTokens: number;
    stage?: string;
    originalTokens?: number;
    droppedSummary?: string;
    taskBlocks?: string[];
    emergencyTrimmed?: boolean;
    dropped?: number;
    /** 工作集或发出去的 messages 是否真变矮（没变且仍超窗则不得原样重试） */
    surfaceChanged?: boolean;
  }> {
    const {
      sessionId,
      contextLimit,
      attempt,
      engineEnabled,
      runSummarizer,
      systemPrompt,
      toolSchemas,
      sessionMessages,
      userName,
      roundCount,
      currentRound,
      activeUserMessage,
      leanExtras,
    } = opts;

    let compressedHistory: LLMMessage[] | undefined;
    let stage: string | undefined;
    let originalTokens: number | undefined;
    let droppedSummary = "";
    let taskBlocks: string[] = [];
    let finalMessages = opts.finalMessages;

    await this.hooks?.preCompact({ sessionId, force: true, reason: "overflow" });
    this.compressRetryAfter.delete(sessionId);
    this.clearLastOccupancy(sessionId);

    if (engineEnabled && this.harnessStore) {
      try {
        const engine = new ContextEngine({
          sessionId,
          harnessStore: this.harnessStore,
          extensions: this.contextExtensions,
          summarizer: runSummarizer,
          microTurn: this.sessions.getMicroTurn(sessionId),
          microRounds: this.microCompactRounds,
        });
        engine.seedWorkingSet(sessionMessages);
        this.writeCompactBracket(sessionId, "start", { source: "overflow" });
        const report = await engine.compress(contextLimit, {
          force: true,
          sourceSessionMessages: sessionMessages,
        });
        compressedHistory = engine.toLLMHistory();
        stage = report.stage;
        originalTokens = report.originalTokens;
        droppedSummary = report.droppedSummary;
        taskBlocks = report.blockIds ?? [];

        if (report.droppedSummary) {
          const existing = this.sessionManager.getRollingSummary(sessionId) ?? "";
          // attempt≥2 可清空 rolling，避免摘要本身把窗口撑爆
          if (attempt >= 2) {
            this.sessionManager.setRollingSummary(
              sessionId,
              report.droppedSummary.slice(0, 2000),
            );
          } else {
            const merged = existing
              ? `${existing}\n\n---\n\n${report.droppedSummary}`
              : report.droppedSummary;
            this.sessionManager.setRollingSummary(sessionId, merged.slice(0, 8000));
          }
          this.sessionManager.saveState();
        }
        if (this.onCompress && report.stage !== "activeStage") {
          try {
            this.onCompress(sessionId, report.stage, report.droppedSummary, taskBlocks);
          } catch { /* ignore */ }
        }
        if (report.stage !== "activeStage") {
          this.recordCompactSurface(sessionId, "overflow", report);
        } else {
          this.writeCompactBracket(sessionId, "end", { error: "no_range", stage: report.stage, source: "overflow" });
        }
        await this.hooks?.postCompact(report.compressedTokens ?? 0);
        await this.afterCompressMaybeRebuild({
          sessionId,
          stage: report.stage,
          source: "overflow",
        });

        finalMessages = buildMessages({
          systemPrompt,
          sessionMessages: sessionMessages as never,
          roundCount,
          currentRound,
          userOpts: {
            beforeUserContent: leanExtras ? "" : opts.effectiveBeforeUser,
            dynamicInjections: leanExtras ? "" : opts.currentDynamicInjections,
            userMessage: roundCount === 0 ? activeUserMessage : "",
            userName,
          },
          platformContext: leanExtras
            ? undefined
            : (opts.platformContext as never),
          rollingSummary: leanExtras
            ? (attempt >= 2
                ? ""
                : (this.sessionManager.getRollingSummary(sessionId) ?? "").slice(0, 1500))
            : (this.sessionManager.getRollingSummary(sessionId) ?? ""),
          structuredMemory: leanExtras ? "" : opts.structuredMemory,
          projectRoot: opts.projectRoot,
          compressedHistory,
        }) as Array<Record<string, unknown>>;
      } catch (e) {
        this.writeCompactBracket(sessionId, "end", { error: String(e), source: "overflow" });
        this.log("warning", `[overflow-shrink] engine failed: ${e}`);
      }
    } else {
      // legacy：直接对 finalMessages force maybeCompress
      const compressResult = maybeCompress(finalMessages as never, contextLimit, {
        force: true,
      });
      finalMessages = compressResult.messages as Array<Record<string, unknown>>;
      stage = compressResult.stage;
      originalTokens = compressResult.originalTokens;
      droppedSummary = compressResult.droppedSummary;
      taskBlocks = compressResult.taskBlocks ?? [];
      if (compressResult.compressed) {
        this.writeCompactBracket(sessionId, "start", { source: "overflow" });
        this.recordCompactSurface(sessionId, "overflow", compressResult);
        await this.hooks?.postCompact(compressResult.compressedTokens ?? 0);
        await this.afterCompressMaybeRebuild({
          sessionId,
          stage: compressResult.stage,
          source: "overflow",
        });
      }
    }

    const trim = emergencyTrimMessages(finalMessages, contextLimit, {
      keepTail: attempt >= 3 ? 4 : 8,
    });
    finalMessages = trim.messages;
    const emergencyTrimmed = trim.trimmed;
    const dropped = trim.dropped;
    const surfaceChanged =
      emergencyTrimmed || (stage != null && stage !== "activeStage");
    return {
      ok: surfaceChanged,
      finalMessages,
      compressedHistory,
      estimatedTokens: 0,
      stage,
      originalTokens,
      droppedSummary,
      taskBlocks,
      emergencyTrimmed,
      dropped,
      surfaceChanged,
    };
  }

  // ── 沙箱快照 ──

  /**
   * 运行前对 sandbox 目录做快照，保留最近 5 个。
   */
  private snapshotBeforeRun(maouRoot: string): void {
    const sandboxDir = join(maouRoot, "sandbox");
    if (!existsSync(sandboxDir)) return;

    const snapshotDir = join(maouRoot, "snapshots");
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 15);
    const target = join(snapshotDir, timestamp);

    try {
      mkdirSync(snapshotDir, { recursive: true });
      cpSync(sandboxDir, target, { recursive: true });
    } catch (err) {
      this.log("warning", `snapshot failed: ${err}`);
    }

    // 清理旧快照，保留最近 5 个
    try {
      const snapshots = readdirSync(snapshotDir)
        .filter((name) => statSync(join(snapshotDir, name)).isDirectory())
        .sort()
        .reverse();
      for (const old of snapshots.slice(5)) {
        rmSync(join(snapshotDir, old), { recursive: true, force: true });
      }
    } catch (err) {
      this.log("warning", `snapshot cleanup failed: ${err}`);
    }
  }
}
