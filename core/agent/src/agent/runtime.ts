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
 * 自动压缩：token 达到 70% 阈值时压缩（保留 25% 近期消息）。
 */

import { execSync } from "node:child_process";
import { PromptCompiler } from "@little-house-studio/prompt";
import { SessionStore, SessionManager, MemoryStore, CheckpointStore, extractMemories } from "@little-house-studio/context";
import {
  buildMessages,
  maybeCompress,
  ContextEngine,
  estimateTokensFromText,
  estimateTokens,
  estimateTokensFromStrings,
  estimateFullPromptTokens,
  parsePromptTokensFromUsage,
  resolveContextUsedTokens,
  MAX_ROUNDS,
  DEFAULT_AGENT_ROUND_LIMIT,
  DEFAULT_LOOP_THRESHOLD,
  CONTEXT_THRESHOLD_PERCENT,
  parseThinkingContextMode,
  shouldStoreThinkingInContext,
} from "@little-house-studio/context";
import type {
  HarnessSessionStore,
  TaskSessionStore,
  Summarizer,
  LLMMessage,
  ThinkingContextMode,
} from "@little-house-studio/context";
import { compileDynamicContext } from "../dynamic-context.js";
import { TokenTracker } from "./token-tracker.js";
import type { TokenUsage } from "./token-tracker.js";
import { promptCacheLedger } from "./prompt-cache-ledger.js";
import { AgentRegistry } from "./registry.js";
import { getTemplateRef } from "./template-ref.js";
import { renderAgentPreview, watchAgentPreview } from "./template.js";
import { runAgentCommand } from "./command-runner.js";
import { CommandRegistry, registerBuiltinCommands, type CommandContext, type CommandResult } from "./command-registry.js";
import { ModelCaller, type ModelCallResult, type CallerStreamEvent } from "@little-house-studio/llm";
import type { LLMToolCall, APIPreset } from "@little-house-studio/llm";
import { AuxModelCaller, resolveHelperPreset } from "@little-house-studio/llm";
import { deriveJsonSettings, StreamJsonAccumulator } from "@little-house-studio/llm";
import { SUPERVISOR_MANAGER } from "./supervisor-manager.js";
import { SubagentRegistry } from "./subagent-registry.js";
import { AgentLifecycleManager } from "./agent-lifecycle.js";
import { MessageBus } from "./message-bus.js";
import type { ToolRegistry, ToolExecutor } from "@little-house-studio/tools";
import type { ToolContext } from "@little-house-studio/tools";
import { collectDiff, formatDiffForReport } from "@little-house-studio/tools";
import {
  cleanupAgentTerminals,
  listTerminals,
  getTerminalLogs,
  setTerminalMode,
  SkillContextManager,
  TASK_MANAGER,
  createSubagentDelegateTool,
  formatTodoNoticeMessage,
  preprocessTodoSlash,
  buildPlanRequiredNotice,
} from "@little-house-studio/tools";
import { TODO_ORCHESTRATOR } from "./todo/index.js";
import { buildToolContext } from "./runtime-tool-context.js";
import {
  isTodoPlanSettled as isTodoPlanSettledHelper,
  flushTodoNotices as flushTodoNoticesHelper,
  afterTodoTools as afterTodoToolsHelper,
} from "./runtime-todo.js";
import {
  appendSessionEvent,
  authorHuman,
  authorAgent,
  authorSystem,
  authorTool,
} from "@little-house-studio/context";
import type { AgentSkillOptions } from "../bootstrap/skills.js";
import { createAgentSkillManager, applyAgentSkillOptions } from "../bootstrap/skills.js";
import type { SubagentExecutorLike } from "@little-house-studio/types";
import type { StreamEvent } from "@little-house-studio/types";
import { Profiler, resolveUserMaouRoot } from "@little-house-studio/types";
import type { Hooks } from "./hooks.js";
import { FileDiffWatch } from "../agent_factory/file-diff-watch.js";

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
  /**
   * ContextEngine 上下文压缩闭环（可选）。
   * 同时注入 harnessStore + taskStore 时启用：每轮 sync→compress→toLLMHistory
   * 替代旧的 maybeCompress（truncate）路径。缺省则回退旧路径。
   */
  harnessStore?: HarnessSessionStore;
  taskStore?: TaskSessionStore;
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
   * mainSessionId，再调此函数 —— 这样多用户同时 /goal 不会串台。
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
    mode: "inherit" | "hard" | "audit";
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
  /** 当前 run() 的实际工作目录（agent.json working_dir 或 projectRoot）—— workspaceChanges/PromptCompiler 用 */
  private effectiveWorkingDir: string = "";
  /** ContextEngine 闭环依赖（可选） */
  private harnessStore?: HarnessSessionStore;
  private taskStore?: TaskSessionStore;
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
    { mode: "inherit" | "hard" | "audit"; roots: string[]; auditRoots?: string[] }
  >();
  /** 已注册的子 Agent delegate 工具名（subagent_<name>），用于下次 run 前清理，
   * 避免上一次 run 注册的 subagent_<name> 在子 Agent 目录变更后残留。 */
  private _registeredSubagentTools: Set<string> = new Set();
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
   * 最近一次主模型 API 回报的 prompt/input token（真 usage）。
   * 压缩与 /context 优先用此值，避免仅估 session 正文导致阈值永不触发。
   */
  private sessionLastApiPromptTokens = new Map<string, number>();
  /** 记录该 usage 时的 history 估算 token，用于工具结果追加后的增量修正 */
  private sessionHistoryTokensAtLastApi = new Map<string, number>();

  // ── 可插拔工厂（缺省使用内部默认实现）──
  private createSessionManagerFn: (sessions: SessionStore, maouRoot: string) => SessionManager;
  private createCheckpointStoreFn: (sessions: SessionStore) => CheckpointStore;
  private createMemoryStoreFn: (maouRoot: string, agentName: string) => MemoryStore;
  private createTokenTrackerFn: (maouRoot: string, agentName: string, preset: Record<string, unknown>) => TokenTracker;
  private createSkillManagerFn: (agentName: string, projectRoot: string, maouRoot: string) => SkillContextManager;
  private skillOptions?: AgentSkillOptions;
  /** 会话级文件 diff 监听（coding 等产品可选启用） */
  private fileDiffWatch: FileDiffWatch | null = null;

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
    this.harnessStore = options.harnessStore;
    this.taskStore = options.taskStore;
    this.summarizer = options.summarizer;
    this.auxModelCaller = options.auxModelCaller;
    this.resolveHelperPresetFn = options.resolveHelperPreset;
    this.hooks = options.hooks;
    this.messageQueue = options.messageQueue ?? MESSAGE_QUEUE;
    this.callMainAgentFn = options.callMainAgent;

    // 工厂：优先使用注入的实现，缺省使用内部默认
    this.createSessionManagerFn = options.createSessionManager ?? ((s, r) => new SessionManager(s, r));
    this.createCheckpointStoreFn = options.createCheckpointStore ?? ((s) => new CheckpointStore(s));
    this.createMemoryStoreFn = options.createMemoryStore ?? ((r, n) => new MemoryStore(r, n));
    this.createTokenTrackerFn = options.createTokenTracker ?? ((r, n, p) => new TokenTracker(r, n, p));
    // skill 选项：先写入 tools 默认，保证 use_skill 与 bake 同口径
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
  }> {
    if (!this.harnessStore || !this.taskStore) {
      return { ok: false, error: "压缩引擎未启用" };
    }
    try {
      const engine = new ContextEngine({
        sessionId,
        harnessStore: this.harnessStore,
        taskStore: this.taskStore,
        summarizer: this.summarizer,
      });
      const session = this.sessions.load(sessionId);
      const msgs = (session?.messages ?? []) as unknown as Array<Record<string, unknown>>;
      engine.initFromSessionMessages(msgs);
      const limit =
        this.currentPreset?.maxContext ??
        this.currentPreset?.maxTokens ??
        65536;
      const known = this.resolveSessionContextTokens(sessionId, engine.getHistory());
      const report = await engine.compress(limit, { knownTokens: known, force: true });
      this.compressRetryAfter.delete(sessionId);
      // 压缩后失效旧 API usage，等下一轮真回报
      this.sessionLastApiPromptTokens.delete(sessionId);
      this.sessionHistoryTokensAtLastApi.delete(sessionId);
      if (report.stage !== "activeStage") {
        const existing = this.sessionManager.getRollingSummary(sessionId) ?? "";
        const merged = existing && report.droppedSummary
          ? `${existing}\n\n---\n\n${report.droppedSummary}`
          : (report.droppedSummary || existing);
        if (merged) {
          this.sessionManager.setRollingSummary(sessionId, merged);
          this.sessionManager.saveState();
        }
        this.onCompress?.(sessionId, report.stage, report.droppedSummary, report.taskBlocks ?? []);
      }
      return {
        ok: true,
        stage: report.stage,
        originalTokens: report.originalTokens,
        compressedTokens: report.compressedTokens,
        droppedSummary: report.droppedSummary,
        taskBlocks: report.taskBlocks,
      };
    } catch (e) {
      this.compressRetryAfter.set(sessionId, Date.now() + AgentRuntime.COMPRESS_RETRY_MS);
      return { ok: false, error: String(e) };
    }
  }

  /**
   * 解析会话上下文占用 token（优先 API prompt usage，再与本地全量估算取 max）。
   * history 可选：传入当前 engine 工作集可避免重复 load。
   */
  private resolveSessionContextTokens(
    sessionId: string,
    history?: Parameters<typeof estimateTokens>[0],
    opts?: {
      systemPrompt?: string;
      toolSchemas?: unknown;
      extras?: string[];
    },
  ): number {
    let api = this.sessionLastApiPromptTokens.get(sessionId) ?? 0;
    if (api <= 0) {
      try {
        const latest = this.sessions.getLatestUsage(sessionId);
        api = parsePromptTokensFromUsage(latest.usage as Record<string, unknown>);
        if (api > 0) {
          this.sessionLastApiPromptTokens.set(sessionId, api);
        }
      } catch { /* ignore */ }
    }

    let historyTokens = 0;
    if (history) {
      historyTokens = estimateTokens(history);
    } else {
      try {
        const session = this.sessions.load(sessionId);
        if (session?.messages?.length) {
          // wire 消息粗算（无 Maou 结构时）
          for (const m of session.messages) {
            historyTokens += 4;
            historyTokens += estimateTokensFromText(String((m as { content?: string }).content ?? ""));
            const tcs = (m as { toolCalls?: unknown[] }).toolCalls;
            if (Array.isArray(tcs)) {
              for (const tc of tcs) {
                historyTokens += 8;
                const rec = tc as { name?: string; arguments?: unknown; parameters?: unknown };
                historyTokens += estimateTokensFromText(String(rec.name ?? ""));
                try {
                  historyTokens += estimateTokensFromText(
                    JSON.stringify(rec.arguments ?? rec.parameters ?? {}),
                  );
                } catch {
                  historyTokens += 16;
                }
              }
            }
          }
        }
      } catch { /* ignore */ }
    }

    // 工具结果追加后：在上次 API prompt 上叠加 history 增量（避免低估）
    let apiAdjusted = api;
    if (api > 0) {
      const atApi = this.sessionHistoryTokensAtLastApi.get(sessionId);
      if (atApi != null && historyTokens > atApi) {
        apiAdjusted = api + (historyTokens - atApi);
      }
    }

    const estimated = estimateFullPromptTokens({
      historyTokens,
      systemPrompt: opts?.systemPrompt,
      toolSchemas: opts?.toolSchemas,
      extras: opts?.extras,
    });

    return resolveContextUsedTokens({
      apiPromptTokens: apiAdjusted,
      estimatedPromptTokens: estimated,
    });
  }

  /** 记录主模型本轮 API prompt tokens + 当时 history 估算 */
  private recordApiPromptTokens(
    sessionId: string,
    usage: Record<string, unknown> | null | undefined,
    historyTokens: number,
  ): void {
    const prompt = parsePromptTokensFromUsage(usage ?? undefined);
    if (prompt <= 0) return;
    this.sessionLastApiPromptTokens.set(sessionId, prompt);
    this.sessionHistoryTokensAtLastApi.set(sessionId, Math.max(0, historyTokens));
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
        const content = String((m as { content?: string }).content ?? "");
        const usage = (m as { usage?: Record<string, number> }).usage;
        if (usage && (usage.input || usage.output || usage.prompt_tokens)) {
          input += Number(usage.input ?? usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
          output += Number(usage.output ?? usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
          cacheRead += Number(usage.cacheRead ?? usage.cache_read_input_tokens ?? 0) || 0;
        } else {
          const t = estimateTokensFromText(content);
          if (role === "user") input += t;
          else if (role === "assistant") output += t;
        }
        if (role === "user") rounds++;
      }
      return { input, output, total: input + output, rounds, cacheRead };
    } catch {
      return null;
    }
  }

  /**
   * Claude Code 风格 /usage 报告：
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

      // code changes: git diff --numstat（对标 Claude Code Total code changes）
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
          `  Used:                 ~${ctx.used.toLocaleString()} / ${ctx.max.toLocaleString()}`,
          `  Remaining:            ~${ctx.remaining.toLocaleString()}`,
          `  Thresholds:           compact ${ctx.compactAt}% · summary ${ctx.summaryAt}% · archive ${ctx.archiveAt}%`,
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
        "Note: figures are local estimates (session history + TokenTracker).",
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
  } | null {
    try {
      const session = this.sessions.load(sessionId);
      if (!session) return null;
      const used = this.resolveSessionContextTokens(sessionId);
      const max =
        this.currentPreset?.maxContext ??
        this.currentPreset?.maxTokens ??
        65536;
      const pct = max > 0 ? (used / max) * 100 : 0;
      return {
        used,
        max,
        pct,
        remaining: Math.max(0, max - used),
        compactAt: CONTEXT_THRESHOLD_PERCENT,
        summaryAt: 80,
        archiveAt: 90,
      };
    } catch {
      return null;
    }
  }

  /**
   * 核心运行循环 —— 异步生成器，yield 流式事件。
   */
  async *run(
    sessionId: string | null | undefined,
    userMessage: string,
    options: RunOptions,
  ): AsyncGenerator<StreamEvent> {
    // task 指令可改写消息；用局部可变变量承接
    let activeUserMessage = userMessage;
    // ── 性能埋点：本次 run 的 profiler（常驻、低开销，定位各阶段耗时）──
    const prof = new Profiler(`run:${(sessionId ?? "new").slice(0, 8)}`);

    // ── 1. 确保 session 存在（新会话首条消息即绑定到 initAgentName，如 coding）──
    const session = prof.sync("ensure_session", () => this.sessions.ensure(sessionId ?? undefined, options.initAgentName));
    sessionId = session.id;
    this.log("info", `[RUN] start session=${sessionId} msg_len=${activeUserMessage.length}`);

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
    const cmdCtx: CommandContext = {
      rawInput: activeUserMessage.trim(),
      args: "",
      sessionId: sessionId!,
      agentName: session.agentName || "main",
      maouRoot: this.maouRoot,
      projectRoot: this.projectRoot,
      runtime: {
        createSession: (initAgentName?: string) => this.sessions.create(undefined, initAgentName),
        clearSession: (sid: string) => {
          this.sessions.clearSession(sid);
          try { this.taskStore?.saveTaskPlan(sid, []); } catch { /* ignore */ }
          try { TASK_MANAGER.manage(sid, "delete", null); } catch { /* ignore */ }
          this.messageQueue.clear(sid);
        },
        setAgentName: (sid: string, name: string) => {
          try { (this.sessions as { setAgentName?: (id: string, n: string) => void }).setAgentName?.(sid, name); } catch { /* ignore */ }
        },
        clearTaskState: (sid: string) => {
          try { this.taskStore?.saveTaskPlan(sid, []); } catch { /* ignore */ }
          try { TASK_MANAGER.manage(sid, "delete", null); } catch { /* ignore */ }
        },
        clearMessageQueue: (sid: string) => { this.messageQueue.clear(sid); },
        forceCompress: async (sid: string) => this.forceCompressSession(sid),
        getUsageStats: (sid: string) => this.getUsageStatsForSession(sid),
        getUsageReport: (sid: string) => this.getUsageReportForSession(sid),
        getContextSnapshot: (sid: string) => this.getContextSnapshotForSession(sid),
        // /goal 指令：创建监督 Agent session + 绑定到主 session
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
    const cmdResult = await this.commandRegistry.tryExecute(activeUserMessage, cmdCtx);
    if (cmdResult) {
      const meta = cmdResult.meta ?? {};
      // task 模式（如 /init）：把指令正文当作用户任务注入，继续走正常 AI 流程
      if (meta.asUserTask && typeof meta.taskPrompt === "string" && meta.taskPrompt.trim()) {
        activeUserMessage = String(meta.taskPrompt);
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
    const registry = new AgentRegistry(maouRoot, effectiveProjectRoot);
    // 确保项目级 agent 已物化（从全局模板复制到 <project>/.maou/agents/<name>/）
    const projectAgentResult = registry.ensureProjectAgent(agentName);
    if (projectAgentResult.created) {
      this.log("info", `[RUN] 项目级 agent '${agentName}' 已物化 → ${projectAgentResult.dir} (${projectAgentResult.reason})`);
    }
    const agentEntry = registry.get(agentName);
    if (!agentEntry) {
      const errMsg = `agent '${agentName}' 不存在（~/.maou/agents/${agentName}/agent.json 缺失）`;
      yield this.logEvent("error", errMsg);
      yield this.event("error", { message: errMsg, round: 0 });
      yield this.event("done", { sessionId, rounds: 0, error: errMsg });
      return;
    }
    if (typeof agentEntry.round_limit === "number" && agentEntry.round_limit > 0) {
      effectiveRoundLimit = agentEntry.round_limit;
      this.log("info", `[RUN] agent=${agentName} round_limit=${effectiveRoundLimit}`);
    }
    // 思考回灌：RunOptions 覆盖 agent.json，缺省 first_round
    const thinkingContextMode: ThinkingContextMode = parseThinkingContextMode(
      options.thinkingContextMode ??
        (agentEntry as { thinking_context_mode?: unknown }).thinking_context_mode,
    );
    this.log("info", `[RUN] agent=${agentName} thinking_context_mode=${thinkingContextMode}`);
    const tc = (agentEntry as { tool_compression?: string }).tool_compression;
    if (tc === "off" || tc === "normal" || tc === "aggressive") compressionLevel = tc;
    const vc = (agentEntry as { verify_command?: string }).verify_command;
    if (typeof vc === "string" && vc.trim()) verifyCommand = vc.trim();
    const tm = (agentEntry as { terminal_mode?: string }).terminal_mode;
    if (tm === "normal" || tm === "auto" || tm === "yolo") {
      try { setTerminalMode(agentName, tm); } catch { /* ignore */ }
    }
    // working_dir：优先 agent.json 配置，否则 projectRoot（process.cwd）
    const agentWorkingDir = (agentEntry as { working_dir?: string }).working_dir;
    if (agentWorkingDir && typeof agentWorkingDir === "string" && agentWorkingDir.trim()) {
      effectiveWorkingDir = agentWorkingDir.trim();
    }
    this.effectiveWorkingDir = effectiveWorkingDir;
    // promptRoot：必须存在 eve 结构，否则抛错
    try {
      agentPromptRoot = registry.getPromptRoot(agentName);
      agentEntrypoint = registry.getPromptEntrypoint(agentName);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      yield this.logEvent("error", errMsg);
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
    this.hooks?.sessionStart(sessionId!);

    // ── 2. 编译 prompt ──
    yield this.event("status", { text: "编译 Prompt..." });
    yield this.logEvent("info", "开始编译 Prompt");

    // eve 结构：每个 agent 必须自带 prompt/system/system.md（getPromptRoot 已校验）。
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
      yield this.event("error", { message: errMsg, round: 0 });
      yield this.event("done", { sessionId, rounds: 0, error: errMsg });
      return;
    } finally {
      endCompile();
    }
    yield this.logEvent("info", `Prompt 编译完成，长度=${systemPrompt.length}`);

    // ── 2a. 编译 before_user（eve 结构 before_user/before_user.md）──
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
    // compile() 首轮产出 bakedContent（全部可用 skill 列表，注入 system 区，可缓存），
    // 后续轮产出 incrementalContent（新增/删除/更新的 skill，注入动态区）。
    let skillManager: SkillContextManager | null = null;
    try {
      skillManager = this.createSkillManagerFn(agentName, this.projectRoot, maouRoot);
      const skillFirst = skillManager.compile();
      if (skillFirst.bakedContent) {
        systemPrompt = `${systemPrompt}\n\n${skillFirst.bakedContent}`;
        yield this.logEvent("info", "已注入可用 skill 列表到系统提示词");
      }
    } catch (err) {
      this.log("warning", `[SKILL] 注入失败: ${err}`);
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
        // eve 结构：OUTPUT.jsonc 只在 agent 根目录下查找
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
          // coding 主 agent 默认 gateway；其它 agent 默认 flat（兼容旧行为）
          agentName === "coding" ? "gateway" : "flat",
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
                "MCP tools are NOT each listed in your tools array. Use the single tool `mcp`:\n" +
                "  list — one shot: full description + parameters for every matching tool\n" +
                "  call — execute mcp__server__tool\n" +
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
    // eve 结构：PERMISSION.jsonc 只在 agent 根目录下
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

    // agent.json tools 白名单（与 PERMISSION 取交集）
    try {
      const registry = new AgentRegistry(maouRoot, effectiveProjectRoot);
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

    // ── 子 Agent kind 工具白名单覆盖（SubagentExecutor → runFn → 此处）──
    // helper 单轮：override=[] → 强制无 tool schemas
    // task/project：override=预设/显式白名单，与既有白名单取交集
    if (options.toolWhitelistOverride !== undefined) {
      const override = options.toolWhitelistOverride;
      if (override.length === 0) {
        toolWhitelist = new Set<string>(); // 空集 = 无工具
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

    // 空白名单 → 传空数组 schemas（无 tool），而非 null（null 表示全量）
    const toolSchemas = stripAllTools
      ? []
      : (this.tools.nativeToolSchemas?.(toolWhitelist) ?? null);
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
    endToolSetup();

    // ── /todo：清洗指令词 + 靠后追加 plan_required notice（不改 system，保 cache）──
    const todoPre = preprocessTodoSlash(activeUserMessage);
    let effectiveUserMessage = todoPre.message;
    if (todoPre.requirePlan) {
      const notice = buildPlanRequiredNotice();
      notice.targetSessionId = sessionId!;
      effectiveUserMessage = `${effectiveUserMessage}\n\n${formatTodoNoticeMessage(notice)}`;
      yield this.logEvent("info", "[todo] /todo 已注入 plan_required system_notice");
    }

    // ── 将用户消息写入 session（kind=human_user, author=human）──
    appendSessionEvent(this.sessions, sessionId!, {
      kind: "human_user",
      content: effectiveUserMessage,
      source: "human",
      author: authorHuman("user", "user"),
      meta: todoPre.requirePlan ? { had_todo_slash: true } : undefined,
    });
    this.hooks?.preMessage({ role: "user", content: effectiveUserMessage } as any);

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
    // 最近一轮的 assistant 文本（loop 结束后供监督模式推送用）
    let lastAssistantContent = "";
    // 空响应重试：LLM 偶尔返回 content="" + 无 tool_calls（如 deepseek 长上下文下 completion_tokens=1）。
    // 注入 <continue> 提示让模型重新生成，最多 MAX_EMPTY_RETRIES 次，仍空才真正退出。
    let emptyResponseRetries = 0;
    const MAX_EMPTY_RETRIES = 5;
    // 本轮工具调用摘要（loop_report 用：累计整个 run 的工具调用，不只最后一轮）
    let lastRoundToolSummary = "";
    // 累计本次 run 所有轮的工具调用次数（loop_report 用：即使最后一轮空转，也能反映之前干了啥）
    const runToolCounts: Record<string, number> = {};

    while (roundCount < maxRounds) {
      // ── P1-3 消息总线：每轮 poll 自己的 mailbox，把队友消息作为 user 消息注入 ──
      // 队友通过 agent_manage message action 走 MessageBus.send 投递（带 from 说话人）。
      // 这里排空 mailbox，content 标注来源 [来自 {from}]，让主 Agent 知道是谁说的。
      // 不替代 callMainAgent（supervisor→main 仍走紧耦合路径）。
      const pendingBus = MessageBus.global().inbox(runAgentName);
      for (const busMsg of pendingBus) {
        const tagged = busMsg.replyTo
          ? `[来自 ${busMsg.from}（回复 ${busMsg.replyTo.slice(0, 8)}）]\n${busMsg.body}`
          : `[来自 ${busMsg.from}]\n${busMsg.body}`;
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
            } else {
              yield this.logEvent("warning", `📨 投递队列消息 #${msg.id} 失败（interrupt_immediately）: ${r.reason}`);
            }
          }
          roundCount++;
          continue;
        }
        this.log("info", `[RUN] session=${sessionId} 收到中断信号（${reason}），停止循环`);
        this.hooks?.abort("用户中断");
        yield this.event("info", { message: "已中断" });
        break;
      }

      this.log("info", `[RUN] round ${roundCount + 1} start`);
      this.hooks?.agentStart(roundCount + 1);

      // ── 3a-pre. 注入后台终端完成/超时通知（工具类消息，非 user）──
      // 落盘 role=tool + source=terminal-notification；CLI 作 ToolCard；
      // LLM 侧 message-builder 会为无配对 tool_call 的通知补合成 assistant.tool_calls，保证 API 合法。
      {
        const bgTerminals = listTerminals(agentName);
        for (const t of bgTerminals) {
          if (notifiedBgCompletions.has(t.id)) continue;
          if (t.state === "running") continue;
          if (t.state === "interrupted") continue;

          notifiedBgCompletions.add(t.id);
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
          // 合成 tool_call_id：异步通知不绑原 tool_call（原 call 可能已用占位 tool_result 回过）
          const notifyCallId = `term_notify_${t.id}_${Date.now().toString(36)}`;
          appendSessionEvent(this.sessions, sessionId!, {
            kind: "tool_async_notify",
            wireRole: "tool",
            content,
            source: "terminal-notification",
            author: authorTool("use_terminal", "use_terminal"),
            meta: {
              terminal_id: t.id,
              tool_name: "use_terminal",
              toolCallId: notifyCallId,
              tool_call_id: notifyCallId,
              tool_ok: ok,
              ok,
              tool_parameters: {
                event: "background_complete",
                terminal_id: t.id,
                description: t.description,
                exit_code: t.exitCode,
                state: t.state,
              },
            },
          });
          // 实时 UI：先 tool_call 再 tool_result，挂到当前 assistant 作工具卡（非 user 气泡）
          yield this.event("tool_call", {
            tool: {
              id: notifyCallId,
              name: "use_terminal",
              parameters: {
                event: "background_complete",
                terminal_id: t.id,
                description: t.description,
              },
            },
            round: roundCount + 1,
          });
          yield this.event("tool_result", {
            toolCallId: notifyCallId,
            name: "use_terminal",
            content,
            ok,
            round: roundCount + 1,
            source: "terminal-notification",
          });
        }
      }

      // 重新加载 session
      const currentSession = this.sessions.load(sessionId!) ?? session;
      const sessionMessages = currentSession.messages;
      const currentRound = roundCount + 1;

      // ── 3a-pre2. 每轮刷新动态注入（board / pending / agent 状态） ──
      // 首轮编译一次后持续复用，后续轮次只刷新动态部分，避免重复编译 BEFORE_USER.md
      const gitBlock = await prof.async("git_changes", () => this.workspaceChanges(), { round: currentRound });
      // 会话文件 diff 监听：仅用户新消息轮（roundCount===0）注入 before_user 区
      let fileDiffNotice = "";
      if (roundCount === 0 && this.fileDiffWatch && sessionId) {
        try {
          fileDiffNotice = this.fileDiffWatch.consumeUserTurnDiffs(sessionId);
        } catch { /* ignore */ }
      }
      // Skill 增量：本轮新增/删除/更新的 skill（首轮已 baked 进 systemPrompt，这里只补增量）
      let skillIncremental = "";
      if (roundCount > 0 && skillManager) {
        try { skillIncremental = skillManager.compile().incrementalContent ?? ""; } catch { /* ignore */ }
      }
      const currentDynamicInjections =
        (roundCount === 0 ? dynamicInjections : compileDynamicContext(maouRoot, agentName, sessionId!))
        + (gitBlock ? `\n\n${gitBlock}` : "")
        + (skillIncremental ? `\n\n${skillIncremental}` : "");
      // before_user 编译内容 + 可选 file_change_notice（用户要求放在 before_user）
      const effectiveBeforeUser =
        roundCount === 0
          ? [beforeUserContent, fileDiffNotice].filter((s) => s && s.trim()).join("\n\n")
          : "";

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
      // 占用 token 优先 API 真 prompt usage，再与 system+tools+history 全量估算取 max。
      const contextLimit = preset.maxContext ?? preset.maxTokens ?? 65536;
      const compressTriggerAt = contextLimit * (CONTEXT_THRESHOLD_PERCENT / 100);

      // ── ContextEngine 闭环路径（注入 stores 时启用）──
      // 每轮从原始 session 重建工作集 → 超阈值则 compress（备份/任务块/zone 落盘）→ toLLMHistory。
      // 仅在真正发生压缩（stage != activeStage）时用压缩历史替代原始历史，
      // 否则保持原始 sessionMessages 路径（保留多模态图片旁路）。
      let compressedHistory: LLMMessage[] | undefined;
      const engineEnabled = Boolean(this.harnessStore && this.taskStore);
      const endCompress = prof.start("context_compress", { round: currentRound, path: engineEnabled ? "engine" : "legacy" });
      if (engineEnabled) {
        const retryAt = this.compressRetryAfter.get(sessionId!) ?? 0;
        const now = Date.now();
        const allowTry = now >= retryAt;
        try {
          if (allowTry) {
            const engine = new ContextEngine({
              sessionId: sessionId!,
              harnessStore: this.harnessStore!,
              taskStore: this.taskStore!,
              summarizer: runSummarizer,
            });
            engine.initFromSessionMessages(sessionMessages as unknown as Array<Record<string, unknown>>);
            const usedTokens = this.resolveSessionContextTokens(sessionId!, engine.getHistory(), {
              systemPrompt,
              toolSchemas,
              extras: [
                effectiveBeforeUser,
                currentDynamicInjections,
                memoryResult.formattedContext ?? "",
                this.sessionManager.getRollingSummary(sessionId!) ?? "",
              ].filter(Boolean),
            });
            if (usedTokens >= compressTriggerAt) {
              this.hooks?.preCompact();
              if (this.checkpointStore.shouldAutoCheckpoint("compression")) {
                this.checkpointStore.createCheckpoint(
                  sessionId!, `auto_before_compression_round_${currentRound}`, true, "compression",
                );
              }
              const report = await engine.compress(contextLimit, {
                knownTokens: usedTokens,
                force: usedTokens >= compressTriggerAt,
              });
              if (report.stage !== "activeStage") {
                compressedHistory = engine.toLLMHistory();
                this.compressRetryAfter.delete(sessionId!);
                this.sessionLastApiPromptTokens.delete(sessionId!);
                this.sessionHistoryTokensAtLastApi.delete(sessionId!);
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
                    this.onCompress(sessionId!, report.stage, report.droppedSummary, report.taskBlocks ?? []);
                  } catch { /* 落盘失败不影响主流程 */ }
                }
                // 仅大压缩 / 归档提醒一次；微压缩（compactStage）永不刷 UI
                if (
                  report.stage === "summaryStage" ||
                  report.stage === "archiveStage"
                ) {
                  yield this.compressLogEvent({
                    stage: report.stage,
                    originalTokens: report.originalTokens,
                    compressedTokens: report.compressedTokens,
                    droppedSummary: report.droppedSummary,
                    taskBlocks: report.taskBlocks,
                  });
                } else {
                  this.log(
                    "info",
                    `[ContextEngine] 微压缩静默 stage=${report.stage} token ${report.originalTokens}→${report.compressedTokens}`,
                  );
                }
                this.hooks?.postCompact(report.compressedTokens ?? 0);
              }
            }
          } else {
            const waitSec = Math.ceil((retryAt - now) / 1000);
            this.log("info", `[ContextEngine] 压缩退避中，${waitSec}s 后再试`);
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
        projectRoot: this.projectRoot,
        compressedHistory,
      }), { round: currentRound });

      // ── 历史段最终化 ──
      let finalMessages: Record<string, unknown>[];
      if (engineEnabled) {
        // ContextEngine 已处理压缩，messages 即最终消息。
        finalMessages = messages;
      } else {
        // 旧路径：maybeCompress（同步 truncate shim）。
        // 压缩前自动快照
        this.hooks?.preCompact();
        if (this.checkpointStore.shouldAutoCheckpoint("compression")) {
          this.checkpointStore.createCheckpoint(
            sessionId!,
            `auto_before_compression_round_${currentRound}`,
            true,
            "compression",
          );
        }

        // legacy：用全量占用触发；maybeCompress 内部仍估消息体，超阈值才 truncate
        const legacyUsed = this.resolveSessionContextTokens(sessionId!, undefined, {
          systemPrompt,
          toolSchemas,
          extras: [
            effectiveBeforeUser,
            currentDynamicInjections,
            memoryResult.formattedContext ?? "",
          ].filter(Boolean),
        });
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
          this.sessionLastApiPromptTokens.delete(sessionId!);
          this.sessionHistoryTokensAtLastApi.delete(sessionId!);
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

          // 仅大压缩 / 归档提醒；微压缩静默
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
          this.hooks?.postCompact(compressResult.compressedTokens ?? 0);
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
      this.hooks?.agentThinking();
      this.hooks?.responseStart();

      // ── 3b. 调用 LLM（流式，带原样重试，不降级）──
      // 模型返回不可用（抛错 / 空内容+校验失败）时，原样重试同一请求最多 MODEL_RETRIES 次。
      // 注意：不修改请求、不去结构化、不换措辞——只是重试（用户要求"重试不自动降级"）。
      let result: ModelCallResult;
      const MODEL_RETRIES = 2;
      let modelAttempt = 0;
      for (;;) {
        const endLlm = prof.start("llm_call", { round: currentRound, model: preset.model, attempt: modelAttempt });
        try {
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
        } catch (err) {
          this.log("warning", `[RUN] model call failed: ${err}`);
          result = this.errorCallResult(String(err));
        } finally {
          endLlm();
        }

        // 重试判定：模型应答但不可用（空内容 + 校验失败 / 错误结果）。
        // 中断信号优先；有原生工具调用即视为可用，不重试。
        const unusable = !result.content && !!result.validationError && result.nativeToolCalls.length === 0;
        if (unusable && modelAttempt < MODEL_RETRIES && !effectiveAbortSignal.aborted) {
          modelAttempt++;
          yield this.logEvent("warning", `模型返回不可用（${result.validationError}），原样重试 ${modelAttempt}/${MODEL_RETRIES}`);
          this.hooks?.agentThinking();
          continue;
        }
        break;
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
        // 压缩门槛：记下本轮真实 prompt tokens（含 system/tools）
        try {
          const histTok = estimateFullPromptTokens({
            historyTokens: estimateTokensFromStrings(
              (finalMessages as Array<{ content?: unknown }>).map((m) => ({
                content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
              })),
            ),
          });
          // 用 session history 粗算作增量基线（下一轮工具结果追加后可叠加）
          let sessionHistTok = 0;
          try {
            const sess = this.sessions.load(sessionId!);
            for (const m of sess?.messages ?? []) {
              sessionHistTok += 4;
              sessionHistTok += estimateTokensFromText(String((m as { content?: string }).content ?? ""));
            }
          } catch { /* ignore */ }
          this.recordApiPromptTokens(
            sessionId!,
            result.usage as Record<string, unknown>,
            sessionHistTok > 0 ? sessionHistTok : histTok,
          );
        } catch { /* ignore */ }
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
        try {
          const tracker = this.createTokenTrackerFn(maouRoot, agentName, preset as unknown as Record<string, unknown>);
          tracker.record(tokenUsage, mainModel);
        } catch (err) {
          this.log("warning", `token tracking failed: ${err}`);
        }
      }

      // 存储 assistant 消息（不再用空格占位，空串即可；适配器会处理 tool_calls 配对）
      // content = 展示/正文；reasoningContent 按 thinking_context_mode 决定是否进后续 LLM 上下文
      const contentToUse = result.content || "";
      lastAssistantContent = contentToUse;
      const reasoningRaw =
        typeof result.reasoningContent === "string" ? result.reasoningContent.trim() : "";
      const storeThinking =
        reasoningRaw.length > 0 &&
        shouldStoreThinkingInContext(thinkingContextMode, roundCount);
      // 累计本次 run 所有轮的工具调用（loop_report 用：即使最后一轮空转，也能反映之前干了啥）
      if (result.nativeToolCalls.length > 0) {
        for (const tc of result.nativeToolCalls) {
          const n = (tc as { name?: string }).name ?? "?";
          runToolCounts[n] = (runToolCounts[n] ?? 0) + 1;
        }
      }
      lastRoundToolSummary = Object.entries(runToolCounts).map(([n, c]) => `${n}×${c}`).join("、");
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
        // 仅 mode 允许时写入；UI 仍走 thinking_delta，不把标签塞进 content
        ...(storeThinking ? { reasoningContent: reasoningRaw } : {}),
      });

      // 模型调用失败时（content 为空且有 validationError）发送 error 事件
      if (!contentToUse && result.validationError) {
        yield this.event("error", {
          message: result.validationError,
          round: currentRound,
        });
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
          // 角色区分提示：supervisor 该调 chat_main/verify；主 agent 该调 write_file 等
          const hint = isSupervisorActive
            ? "你是监督 Agent，**禁止只输出文字**，必须立刻调用工具。若要派活给主 Agent，现在就调 supervisor_chat_main(message=\"派活内容\")；若主 Agent 已汇报，调 supervisor_task_control(action=verify, round_report=\"汇报内容\")；若验收合格，调 supervisor_task_control(action=confirm_end)。"
            : "请继续执行任务——直接调用工具（write_file/edit_file/use_terminal 等）开始具体操作，不要只思考或只输出文字。当前是 yolo 模式，use_terminal 可自由跑 npm install/build/test 等命令，不会被拦截。若有 todo 清单且当前项已完成，调用 todo_finish；全部完成后回复用户。";
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
          try { this.fileDiffWatch?.onAgentRoundEnd(sessionId!); } catch { /* ignore */ }
        this.hooks?.agentStop(currentRound);
          roundCount++;
          continue;
        }
        // 重试次数耗尽，真正退出（但仍会走到 loop 结束推送 loop_report，让 supervisor 知道主 agent 卡住）
        yield this.logEvent("warning", `[RUN] session=${sessionId} 空转重试 ${MAX_EMPTY_RETRIES} 次仍无工具调用，退出循环`);
        try { this.fileDiffWatch?.onAgentRoundEnd(sessionId!); } catch { /* ignore */ }
        this.hooks?.agentStop(currentRound);
        break;
      }
      // 有工具调用 → 重置空转计数
      if (!noTools) emptyResponseRetries = 0;

      yield this.event("assistant", {
        content: contentToUse,
        round: currentRound,
        usage: { ...result.usage, max_context: preset.maxContext ?? preset.maxTokens },
        nativeToolCalls: result.nativeToolCalls.length > 0 ? result.nativeToolCalls : undefined,
        timing: result.timing,
      });
      this.hooks?.responseEnd(contentToUse);
      this.hooks?.postMessage({ role: "assistant", content: contentToUse } as any);

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
            } else {
              yield this.logEvent("warning", `📨 投递队列消息 #${msg.id} 失败（task_complete）: ${r.reason}`);
            }
          }
        }

        if (shouldContinue) {
          try { this.fileDiffWatch?.onAgentRoundEnd(sessionId!); } catch { /* ignore */ }
        this.hooks?.agentStop(currentRound);
          roundCount++;
          continue;
        }
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
          try { this.fileDiffWatch?.onAgentRoundEnd(sessionId!); } catch { /* ignore */ }
        this.hooks?.agentStop(currentRound);
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
          } else {
            yield this.logEvent("warning", `📨 投递队列消息 #${msg.id} 失败: ${r.reason}`);
          }
        }
        try { this.fileDiffWatch?.onAgentRoundEnd(sessionId!); } catch { /* ignore */ }
        this.hooks?.agentStop(currentRound);
        roundCount++;
        continue;
      }

      // 无队列消息 → 退出循环
      try { this.fileDiffWatch?.onAgentRoundEnd(sessionId!); } catch { /* ignore */ }
        this.hooks?.agentStop(currentRound);
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
        } else {
          yield this.logEvent("warning", `📨 投递队列消息 #${msg.id} 失败: ${r.reason}`);
        }
      }
      if (loopEndMessages.length > 0) {
        yield this.event("queue_delivered", {
          count: loopEndMessages.length,
          sessionId: sessionId!,
          phase: "loop_end",
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

    this.hooks?.sessionEnd(sessionId!);

    // ── P1-4 生命周期：run 结束 → idle（arm TTL，TTL 后自动 park）──
    lifecycle.setStatus(sessionId, "idle");

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
    guard: { mode: "inherit" | "hard" | "audit"; roots: string[]; auditRoots?: string[] } | null,
  ): void {
    if (guard && guard.roots?.length) {
      this._sessionPathGuards.set(sessionId, guard);
    } else {
      this._sessionPathGuards.delete(sessionId);
    }
  }

  getSessionPathGuard(
    sessionId: string,
  ): { mode: "inherit" | "hard" | "audit"; roots: string[]; auditRoots?: string[] } | undefined {
    return this._sessionPathGuards.get(sessionId);
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
      agentName,
      workingDir: workingDir ?? this.projectRoot,
      pathGuard: this.getSessionPathGuard(sessionId ?? ""),
      compressionLevel,
      skillOptions: this.skillOptions,
      subagentExecutor: this.subagentExecutor as never,
      callMainAgentFn: this.callMainAgentFn,
      auxModelCaller: this.auxModelCaller as never | undefined,
      currentPreset: currentPreset ?? this.currentPreset ?? undefined,
      resolveHelperPresetFn: this.resolveHelperPresetFn
        ? (this.resolveHelperPresetFn as (agentName: string, mainPreset: unknown) => unknown)
        : undefined,
      yieldResult: this.getYieldHandler(sessionId ?? ""),
    });

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

    let i = 0;
    while (i < toolCalls.length) {
      const tc = toolCalls[i];

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
            // - background=true 跳过 appendMessage（占位已写入，避免重复 tool_call_id）
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

      if (this.toolIsParallelSafe(tc.name)) {
        const group: LLMToolCall[] = [];
        while (i < toolCalls.length && this.toolIsParallelSafe(toolCalls[i].name)) {
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
  private async _loadLoopScript(agentName: string): Promise<((ctx: LoopScriptCtx) => boolean) | null> {
    if (this._loopScriptCache.has(agentName)) return this._loopScriptCache.get(agentName)!;
    let script: ((ctx: LoopScriptCtx) => boolean) | null = null;
    try {
      const registry = new AgentRegistry(this.maouRoot, this.projectRoot);
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
    try {
      const tool = this.tools.get(toolCall.name);
      if (!tool) return [];
      const required = tool.definition.parameters?.required;
      if (!Array.isArray(required) || required.length === 0) return [];
      const params = toolCall.parameters ?? {};
      const missing: string[] = [];
      for (const key of required) {
        const v = params[key];
        if (v === undefined || v === null || v === "") missing.push(key);
      }
      return missing;
    } catch {
      return [];
    }
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
    this.sessions.appendMessage(sessionId, "tool", placeholder, {
      round, toolCallId: toolCall.id, tool_name: toolCall.name,
      tool_provider: toolCall.provider, tool_type: toolCall.type, tool_parameters: toolCall.parameters,
      background: true,
      tool_ok: true, // 占位响应视为成功（真实结果后续异步上报）
    });
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
    // background=true：后台执行（fire-and-forget），commit() 时跳过 appendMessage
    // （占位 tool_result 已由 commitBackgroundToolCall 写入，重复写会破坏 tool_call_id 一一对应）
    const background = opts?.background ?? false;
    const announced = opts?.announced ?? false;

    // ── 前置校验：必填参数缺失时提前拦截，避免浪费一轮执行 ──
    // LLM 有时产生不完整的 tool_call（缺必填参数），此时直接返回引导性错误。
    // 注意：参数为空但工具 schema 没有任何 required 时，不拦截——有些工具所有参数都可选。
    const missingRequired = this.collectMissingRequiredParams(toolCall);
    if (missingRequired.length > 0) {
      const emptyMsg =
        `❌ 工具 ${toolCall.name} 缺少必填参数: ${missingRequired.join(", ")}\n` +
        `请重新调用并填写上述参数。如果你不想调用任何工具，请直接回复文本，不要生成缺参数的工具调用。`;
      this.log("warn", `[Runtime] 拦截缺参数工具调用: ${toolCall.name} (round=${round}, missing=${missingRequired.join(",")})`);
      return (): StreamEvent[] => {
        const now = () => new Date().toISOString();
        const events: StreamEvent[] = [];
        if (!background && !announced) {
          this.sessions.appendRawEntry(sessionId, { type: "tool_call", round, created_at: now(), data: { name: toolCall.name, parameters: toolCall.parameters ?? {}, id: toolCall.id, provider: toolCall.provider, tool_type: toolCall.type } });
          events.push(this.event("tool_call", { tool: { id: toolCall.id, name: toolCall.name, parameters: toolCall.parameters ?? {}, provider: toolCall.provider, type: toolCall.type }, round }));
        }
        this.sessions.appendRawEntry(sessionId, { type: "tool_result", round, created_at: now(), data: { tool_name: toolCall.name, tool_call_id: toolCall.id, content: emptyMsg, ok: false, background } });
        events.push(this.event("tool_result", { toolCallId: toolCall.id, name: toolCall.name, content: emptyMsg, ok: false, round, background }));
        if (!background) {
          this.sessions.appendMessage(sessionId, "tool", emptyMsg, { round, toolCallId: toolCall.id, tool_name: toolCall.name, tool_ok: false });
        }
        return events;
      };
    }

    // pre_tool_use hook（同步）：返回 false 拦截
    const blocked = this.hooks ? !this.hooks.preToolUse(tcInfo) : false;

    let result: Awaited<ReturnType<ToolExecutor["executeSingle"]>> | null = null;
    let execError: unknown = null;
    if (!blocked) {
      const endTool = prof?.start(`tool:${toolCall.name}`, { round });
      try {
        result = await this.toolExecutor.executeSingle(
          { id: toolCall.id, name: toolCall.name, parameters: toolCall.parameters },
          context,
        );
      } catch (err) {
        execError = err;
      } finally {
        endTool?.();
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
        const blockedMsg =
          this.hooks?.lastBlockReason?.trim() ||
          `工具 ${toolCall.name} 被钩子拦截`;
        this.sessions.appendRawEntry(sessionId, {
          type: "tool_result", round, created_at: now(),
          data: { tool_name: toolCall.name, tool_call_id: toolCall.id, content: blockedMsg, ok: false, background },
        });
        events.push(this.event("tool_result", { toolCallId: toolCall.id, name: toolCall.name, content: blockedMsg, ok: false, round, background }));
        if (!background) {
          this.sessions.appendMessage(sessionId, "tool", blockedMsg, {
            round, toolCallId: toolCall.id, tool_name: toolCall.name,
            tool_provider: toolCall.provider, tool_type: toolCall.type, tool_parameters: toolCall.parameters,
            tool_ok: false,
          });
        }
        return events;
      }

      if (execError !== null) {
        const errorMsg = `工具执行失败: ${execError}`;
        this.hooks?.toolError(tcInfo, errorMsg);
        this.sessions.appendRawEntry(sessionId, {
          type: "tool_result", round, created_at: now(),
          data: { tool_name: toolCall.name, tool_call_id: toolCall.id, content: errorMsg, ok: false, background },
        });
        events.push(this.event("tool_result", { toolCallId: toolCall.id, name: toolCall.name, content: errorMsg, ok: false, round, background }));
        if (!background) {
          this.sessions.appendMessage(sessionId, "tool", errorMsg, {
            round, toolCallId: toolCall.id, tool_name: toolCall.name,
            tool_provider: toolCall.provider, tool_type: toolCall.type, tool_parameters: toolCall.parameters,
            tool_ok: false,
          });
        }
        return events;
      }

      const res = result!;
      // G4: 空字符串 tool_result 会让大部分 LLM API 报 400。
      // ?? 只兜底 null/undefined，空字符串会穿透——所以再判断一次。
      // payload 也要兜底（部分工具只填 payload 不填 message）。
      let toolResultContent = res.result.message ?? "";
      if (!toolResultContent.trim()) {
        const fallback = res.result.payload;
        toolResultContent = fallback
          ? JSON.stringify({ ok: res.result.ok, payload: fallback })
          : `工具 ${toolCall.name} 执行完成（ok=${res.result.ok}，无 message）`;
      }
      const toolImages = res.result.images;

      this.sessions.appendRawEntry(sessionId, {
        type: "tool_result", round, created_at: now(),
        data: { tool_name: toolCall.name, tool_call_id: toolCall.id, content: toolResultContent, ok: res.result.ok, background },
      });
      // tool_result 事件带上 displayEvents（supervisor_task_control end 用此机制通知前端切回主 Agent）
      const toolResultEvent: Record<string, unknown> = {
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: toolResultContent,
        ok: res.result.ok,
        round,
        background,
      };
      if (Array.isArray(res.result.displayEvents) && res.result.displayEvents.length > 0) {
        toolResultEvent.displayEvents = res.result.displayEvents;
      }
      events.push(this.event("tool_result", toolResultEvent));
      events.push(this.logEvent("info", `工具 ${toolCall.name} 完成: ok=${res.result.ok}${background ? " [后台]" : ""}`));
      this.hooks?.postToolUse(tcInfo, { toolCallId: toolCall.id, name: toolCall.name, output: toolResultContent, success: res.result.ok, error: "", elapsed: 0 });

      // 文件 diff 监听：成功触碰 reader/edit/write 后入名单
      if (res.result.ok && this.fileDiffWatch && sessionId) {
        try {
          this.fileDiffWatch.noteToolTouch(
            sessionId,
            toolCall.name,
            (toolCall.parameters ?? {}) as Record<string, unknown>,
          );
        } catch { /* ignore */ }
      }

      // background=true：跳过 appendMessage（占位已写入，再写会破坏 tool_call_id 一一对应）
      if (background) {
        return events;
      }

      const toolMeta: Record<string, unknown> = {
        kind: "tool_result",
        source: "tool",
        author: authorTool(toolCall.name, toolCall.name),
        round, toolCallId: toolCall.id, tool_name: toolCall.name,
        tool_provider: toolCall.provider, tool_type: toolCall.type, tool_parameters: toolCall.parameters,
        tool_ok: res.result.ok,
      };
      if (toolImages && toolImages.length > 0) toolMeta.images = toolImages;
      this.sessions.appendMessage(sessionId, "tool", toolResultContent, toolMeta);
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

  private errorCallResult(error: string): ModelCallResult {
    return ModelCaller.createErrorResult(error);
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
