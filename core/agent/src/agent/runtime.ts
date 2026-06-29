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

import { PromptCompiler } from "@little-house-studio/prompt";
import { SessionStore, SessionManager, MemoryStore, CheckpointStore, extractMemories } from "@little-house-studio/context";
import {
  buildMessages,
  maybeCompress,
  ContextEngine,
  estimateTokens,
  MAX_ROUNDS,
  DEFAULT_AGENT_ROUND_LIMIT,
  DEFAULT_LOOP_THRESHOLD,
  CONTEXT_THRESHOLD_PERCENT,
} from "@little-house-studio/context";
import type { HarnessSessionStore, TaskSessionStore, Summarizer, LLMMessage } from "@little-house-studio/context";
import { compileDynamicContext } from "../dynamic-context.js";
import { TokenTracker } from "./token-tracker.js";
import type { TokenUsage } from "./token-tracker.js";
import { AgentRegistry } from "./registry.js";
import { renderAgentPreview } from "./template.js";
import { runAgentCommand } from "./command-runner.js";
import { CommandRegistry, registerBuiltinCommands, type CommandContext, type CommandResult } from "./command-registry.js";
import { ModelCaller, type ModelCallResult, type CallerStreamEvent } from "@little-house-studio/llm";
import type { LLMToolCall, APIPreset } from "@little-house-studio/llm";
import { AuxModelCaller, resolveHelperPreset } from "@little-house-studio/llm";
import { deriveJsonSettings, StreamJsonAccumulator } from "@little-house-studio/llm";
import { SUPERVISOR_MANAGER } from "./supervisor-manager.js";
import type { ToolRegistry, ToolExecutor } from "@little-house-studio/tools";
import type { ToolContext } from "@little-house-studio/tools";
import type { SubagentExecutorLike } from "@little-house-studio/types";
import { cleanupAgentTerminals, listTerminals, getTerminalLogs, setTerminalMode, SkillContextManager, TASK_MANAGER } from "@little-house-studio/tools";
import type { StreamEvent } from "@little-house-studio/types";
import { Profiler } from "@little-house-studio/types";
import type { Hooks } from "./hooks.js";
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
   * 辅助模型调用器（可选）—— 统一辅助调用管道（压缩/loop判定/路由等）。
   * 注入后：
   *   - judgeLoopEnd 走 auxModelCaller（独立 token 统计，不混入主调用）
   *   - 若同时注入了 summarizer，summarizer 仍用旧路径（向后兼容）
   *   - 若注入了 auxModelCaller 但没注入 summarizer，summarizer 自动用 auxModelCaller 构建
   * 未注入：judgeLoopEnd 回退旧路径（用 callModelFn + 主 preset）。
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
  /** SkillContextManager 工厂（缺省 new SkillContextManager(agentName, projectRoot, maouRoot)） */
  createSkillManager?: (agentName: string, projectRoot: string, maouRoot: string) => SkillContextManager;
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
  /** 调用主 Agent（监督模式专用）—— 由 harness 注入 */
  private callMainAgentFn?: (mainSessionId: string, message: string, abortSignal?: AbortSignal) => AsyncGenerator<StreamEvent, string>;

  // ── 可插拔工厂（缺省使用内部默认实现）──
  private createSessionManagerFn: (sessions: SessionStore, maouRoot: string) => SessionManager;
  private createCheckpointStoreFn: (sessions: SessionStore) => CheckpointStore;
  private createMemoryStoreFn: (maouRoot: string, agentName: string) => MemoryStore;
  private createTokenTrackerFn: (maouRoot: string, agentName: string, preset: Record<string, unknown>) => TokenTracker;
  private createSkillManagerFn: (agentName: string, projectRoot: string, maouRoot: string) => SkillContextManager;

  constructor(options: RuntimeOptions) {
    this.compiler = options.compiler;
    this.sessions = options.sessions;
    this.tools = options.tools;
    this.toolExecutor = options.toolExecutor;
    this.callModelFn = options.callModel;
    this.agentRoundLimit = options.agentRoundLimit ?? DEFAULT_AGENT_ROUND_LIMIT;
    this.loopThreshold = options.loopThreshold ?? DEFAULT_LOOP_THRESHOLD;
    this.logFn = options.log ?? (() => {});
    this.maouRoot = options.maouRoot ?? join(process.env.HOME ?? '', '.maou');
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
    this.createSkillManagerFn = options.createSkillManager ?? ((n, p, r) => new SkillContextManager(n, p, r));

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

  /**
   * 核心运行循环 —— 异步生成器，yield 流式事件。
   */
  async *run(
    sessionId: string | null | undefined,
    userMessage: string,
    options: RunOptions,
  ): AsyncGenerator<StreamEvent> {
    // ── 性能埋点：本次 run 的 profiler（常驻、低开销，定位各阶段耗时）──
    const prof = new Profiler(`run:${(sessionId ?? "new").slice(0, 8)}`);

    // ── 1. 确保 session 存在（新会话首条消息即绑定到 initAgentName，如 coding）──
    const session = prof.sync("ensure_session", () => this.sessions.ensure(sessionId ?? undefined, options.initAgentName));
    sessionId = session.id;
    this.log("info", `[RUN] start session=${sessionId} msg_len=${userMessage.length}`);

    // ── 1. 指令匹配：/xxx 指令直接执行，不走 AI ──
    const cmdCtx: CommandContext = {
      rawInput: userMessage.trim(),
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
        // /goal 指令：创建监督 Agent session + 绑定到主 session
        startSupervisorMode: (mainSessionId: string, agentName: string, chatKey?: string): string => {
          const supervisorSession = this.sessions.create(undefined, agentName);
          SUPERVISOR_MANAGER.bind({
            mainSessionId,
            supervisorSessionId: supervisorSession.id,
            chatKey,
          });
          this.log("info", `[SUPERVISOR] bind main=${mainSessionId} → supervisor=${supervisorSession.id}`);
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
    const cmdResult = await this.commandRegistry.tryExecute(userMessage, cmdCtx);
    if (cmdResult) {
      // 指令匹配成功，直接返回结果
      const meta = cmdResult.meta ?? {};
      // /new 返回新 session ID
      const effectiveSessionId = (meta.sessionId as string) ?? sessionId!;
      yield this.event("session", { sessionId: effectiveSessionId });
      yield this.event("assistant", { content: cmdResult.content, round: 0 });
      yield this.event("done", { sessionId: effectiveSessionId, rounds: 0, ...meta });
      this.log("info", `[RUN] 指令命中 → ${userMessage.trim().split(/\s/)[0]}`);
      return;
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

    // ── eve: 加载 loop/end.md 达标标准（loop 结束后用小判定再检查是否真完成）──
    let loopEndCriteria = "";
    try {
      if (agentPromptRoot) {
        const endPath = join(agentPromptRoot, "..", "loop", "end.md");
        if (existsSync(endPath)) loopEndCriteria = readFileSync(endPath, "utf-8").trim();
      }
    } catch { /* 无则跳过 */ }

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

    const preset = options.preset;
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
      if (agentEntry?.tools && Array.isArray(agentEntry.tools) && !agentEntry.tools.includes("*")) {
        const agentToolSet = new Set(agentEntry.tools as string[]);
        if (toolWhitelist) {
          // 取交集
          const intersection = new Set([...toolWhitelist].filter(x => agentToolSet.has(x)));
          toolWhitelist = intersection.size > 0 ? intersection : undefined;
        } else {
          toolWhitelist = agentToolSet;
        }
      }
    } catch { /* ignore */ }

    const toolSchemas = this.tools.nativeToolSchemas?.(toolWhitelist) ?? null;
    const nativeToolCalling = Boolean(preset.nativeToolCalling ?? true) && Boolean(toolSchemas?.length);

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

    // ── 将用户消息写入 session（供后续请求回溯历史） ──
    this.sessions.appendMessage(sessionId!, "user", userMessage);
    this.hooks?.preMessage({ role: "user", content: userMessage } as any);

    // ── 3. Agent 循环 ──
    let roundCount = 0;
    const maxRounds = effectiveRoundLimit > 0 ? effectiveRoundLimit : MAX_ROUNDS;
    const notifiedBgCompletions = new Set<string>();
    // 完成前自动验证（#9）：失败则注入结果让模型自修，最多 MAX_VERIFY_FIX 次
    let verifyAttempts = 0;
    const MAX_VERIFY_FIX = 2;
    // eve loop/end.md 达标检查：不达标则反馈让 AI 继续，最多 MAX_LOOP_CHECK 次
    let loopCheckAttempts = 0;
    const MAX_LOOP_CHECK = 2;
    // #16 可观测：本次 run 的累计重试次数与 token
    let totalRetries = 0;
    let totalTokens = 0;

    while (roundCount < maxRounds) {
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

      // ── 3a-pre. 注入后台终端完成/超时通知 ──
      {
        const bgTerminals = listTerminals(agentName);
        for (const t of bgTerminals) {
          if (notifiedBgCompletions.has(t.id)) continue;
          if (t.state === "running") continue;
          if (t.state === "interrupted") continue;

          notifiedBgCompletions.add(t.id);
          const output = await getTerminalLogs(t.id, agentName, 2000);
          const status =
            t.state === "killed" ? "已终止" :
            t.exitCode === 0 ? "已完成" :
            t.exitCode != null ? `已失败(退出码${t.exitCode})` : "已结束";
          const content =
            `<terminal-message>\n` +
            `终端「${t.description}」(ID: ${t.id}) ${status}。\n` +
            (output ? `\n输出:\n${output}\n` : "") +
            `</terminal-message>`;
          this.sessions.appendMessage(sessionId!, "user", content, {
            source: "terminal-notification",
            terminal_id: t.id,
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
      // Skill 增量：本轮新增/删除/更新的 skill（首轮已 baked 进 systemPrompt，这里只补增量）
      let skillIncremental = "";
      if (roundCount > 0 && skillManager) {
        try { skillIncremental = skillManager.compile().incrementalContent ?? ""; } catch { /* ignore */ }
      }
      const currentDynamicInjections =
        (roundCount === 0 ? dynamicInjections : compileDynamicContext(maouRoot, agentName, sessionId!))
        + (gitBlock ? `\n\n${gitBlock}` : "")
        + (skillIncremental ? `\n\n${skillIncremental}` : "");

      // ── 3a. 构建消息数组 ──
      const memoryResult = prof.sync("memory_recall", () => {
        const memoryStore = this.createMemoryStoreFn(this.maouRoot, agentName);
        return memoryStore.recall(userMessage, 5);
      }, { round: currentRound });

      // 自动压缩检查
      // 上下文压缩阈值应基于输入上下文上限（maxContext），而非输出上限（maxTokens）。
      // 优先 maxContext，回退 maxTokens（兼容旧 preset），最后 65536 兜底。
      const contextLimit = preset.maxContext ?? preset.maxTokens ?? 65536;

      // ── ContextEngine 闭环路径（注入 stores 时启用）──
      // 每轮从原始 session 重建工作集 → 超阈值则 compress（备份/任务块/zone 落盘）→ toLLMHistory。
      // 仅在真正发生压缩（stage != activeStage）时用压缩历史替代原始历史，
      // 否则保持原始 sessionMessages 路径（保留多模态图片旁路）。
      let compressedHistory: LLMMessage[] | undefined;
      const engineEnabled = Boolean(this.harnessStore && this.taskStore);
      const endCompress = prof.start("context_compress", { round: currentRound, path: engineEnabled ? "engine" : "legacy" });
      if (engineEnabled) {
        try {
          const engine = new ContextEngine({
            sessionId: sessionId!,
            harnessStore: this.harnessStore!,
            taskStore: this.taskStore!,
            summarizer: runSummarizer,
          });
          engine.initFromSessionMessages(sessionMessages as unknown as Array<Record<string, unknown>>);
          const tokens = estimateTokens(engine.getHistory());
          if (tokens >= contextLimit * (CONTEXT_THRESHOLD_PERCENT / 100)) {
            this.hooks?.preCompact();
            if (this.checkpointStore.shouldAutoCheckpoint("compression")) {
              this.checkpointStore.createCheckpoint(
                sessionId!, `auto_before_compression_round_${currentRound}`, true, "compression",
              );
            }
            const report = await engine.compress(contextLimit);
            if (report.stage !== "activeStage") {
              compressedHistory = engine.toLLMHistory();
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
              yield this.logEvent(
                "info",
                `上下文已压缩 (engine, stage=${report.stage}，token: ${report.originalTokens} → ${report.compressedTokens})`,
              );
              this.hooks?.postCompact(report.compressedTokens ?? 0);
            }
          }
        } catch (err) {
          const errMsg = `[ContextEngine] 压缩失败: ${err}`;
          this.log("error", errMsg);
          yield this.event("error", { message: errMsg, round: currentRound });
          yield this.event("done", { sessionId, rounds: currentRound, error: errMsg });
          return;
        }
      }
      endCompress();

      const messages = prof.sync("build_messages", () => buildMessages({
        systemPrompt,
        sessionMessages,
        roundCount,
        currentRound,
        userOpts: {
          beforeUserContent: roundCount === 0 ? beforeUserContent : "",
          dynamicInjections: currentDynamicInjections,
          userMessage: roundCount === 0 ? userMessage : "",
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

        const compressResult = prof.sync("context_compress_legacy", () => maybeCompress(messages, contextLimit), { round: currentRound });
        finalMessages = compressResult.messages;
        const compressed = compressResult.compressed;
        const droppedSummary = compressResult.droppedSummary;
        if (compressed) {
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

          const zoneName = compressResult.stage ?? "unknown";
          const tokenStr =
            compressResult.originalTokens && compressResult.compressedTokens
              ? `，token: ${compressResult.originalTokens} → ${compressResult.compressedTokens}`
              : "";
          yield this.logEvent(
            "info",
            `上下文已压缩 (zone=${zoneName}${tokenStr})，消息数: ${sessionMessages.length}`,
          );
          this.hooks?.postCompact(compressResult.compressedTokens ?? 0);
        }
      }

      yield this.event("agent_round", { round: currentRound, agentMode });
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
      // 记录 token 用量
      if (result.usage) {
        const tokenUsage = result.usage as unknown as TokenUsage;
        const tt = (result.usage as { total_tokens?: number; totalTokens?: number }).total_tokens
          ?? (result.usage as { totalTokens?: number }).totalTokens ?? 0;
        totalTokens += Number(tt) || 0;
        yield { type: "model.usage", usage: tokenUsage } as unknown as StreamEvent;
        try {
          const tracker = this.createTokenTrackerFn(maouRoot, agentName, preset as unknown as Record<string, unknown>);
          tracker.record(tokenUsage, preset.model ?? "");
        } catch (err) {
          this.log("warning", `token tracking failed: ${err}`);
        }
      }

      // 存储 assistant 消息（不再用空格占位，空串即可；适配器会处理 tool_calls 配对）
      const contentToUse = result.content || "";
      this.sessions.appendMessage(sessionId!, "assistant", contentToUse, {
        round: currentRound,
        retry_count: result.retryIndex,
        raw_response: result.rawResponse,
        validation_error: result.validationError,
        toolCalls: result.nativeToolCalls,
        usage: result.usage,
        raw_request: result.rawRequest,
      });

      // 模型调用失败时（content 为空且有 validationError）发送 error 事件
      if (!contentToUse && result.validationError) {
        yield this.event("error", {
          message: result.validationError,
          round: currentRound,
        });
        break; // 退出 agent 循环
      }

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
        );

        // task_complete phase：本轮若有工具完成（尤其 task_finish），且全部 task 已完成，
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
          this.sessions.appendMessage(sessionId!, "user", note, { source: "verification", round: currentRound });
          yield this.event("verification", { ok: false, command: verifyCommand, attempt: verifyAttempts });
          this.hooks?.agentStop(currentRound);
          roundCount++;
          continue;
        }
        yield this.logEvent("info", `✅ 完成前验证通过: ${verifyCommand}`);
        yield this.event("verification", { ok: true, command: verifyCommand });
      }

      // ── eve: loop/end.md 达标检查（小判定）──
      // 模型准备收尾时，按 end.md 标准判断是否真完成；不达标则把反馈喂回，继续 loop。
      if (loopEndCriteria && loopCheckAttempts < MAX_LOOP_CHECK && !effectiveAbortSignal.aborted) {
        yield this.event("status", { text: "loop 达标检查..." });
        const verdict = await prof.async("loop_end_check", () => this.judgeLoopEnd(loopEndCriteria, sessionId!, preset, agentName, options.abortSignal), { round: currentRound });
        if (verdict && verdict.done === false) {
          loopCheckAttempts++;
          yield this.logEvent("warning", `loop 未达标（${loopCheckAttempts}/${MAX_LOOP_CHECK}）：${verdict.feedback?.slice(0, 80)}`);
          this.sessions.appendMessage(sessionId!, "user", `<loop-not-done>\n按完成标准检查，本次任务尚未达标：${verdict.feedback}\n请继续完成后再结束。\n</loop-not-done>`, { source: "loop_end", round: currentRound });
          yield this.event("loop_check", { done: false, attempt: loopCheckAttempts });
          this.hooks?.agentStop(currentRound);
          roundCount++;
          continue;
        }
        if (verdict) yield this.event("loop_check", { done: true });
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
        this.hooks?.agentStop(currentRound);
        roundCount++;
        continue;
      }

      // 无队列消息 → 退出循环
      this.hooks?.agentStop(currentRound);
      break;
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
    yield this.event("done", {
      sessionId,
      rounds: roundCount,
      retries: totalRetries,
      totalTokens,
    });
    this.log("info", `[STATS] rounds=${roundCount} retries=${totalRetries} tokens=${totalTokens}`);
    this.log("info", `[RUN] main loop finished, rounds=${roundCount}`);

    // ── 6. 清理内部 AbortController（已退出主循环，不再需要 interrupt 能力）──
    this.abortControllers.delete(sessionId);
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

    const context = {
      sessionId,
      projectRoot: this.projectRoot,  // 始终用 maou-agent 安装目录（skill/tool 资源发现）
      promptRoot: this.compiler.promptRoot,
      sandboxRoot: join(this.maouRoot, 'sandbox', sessionId),
      sandboxMode,
      agentName,
      agentMode: "execute",
      pluginSettings: {},
      workingDir: workingDir ?? this.projectRoot,  // agent 工作目录（终端、文件读写）
      compressionLevel,
      // 注入 SubagentExecutor（若 harness 配置了 runFn）—— agent_message 工具据此真并行 fork
      // 同时设置 parentSessionId，让 fork 时生成的子 sessionId 关联到当前 session
      subagentExecutor: this.subagentExecutor
        ? (Object.assign(this.subagentExecutor, { parentSessionId: sessionId ?? "" }), this.subagentExecutor)
        : undefined,
      // 监督模式：注入 callMainAgent 函数 + 标记当前 session 是否是监督 Agent
      // supervisor_chat_main / supervisor_task_control 工具据此判断调用上下文
      // callMainAgent 闭包绑定当前 sessionId 对应的 mainSessionId（多用户场景不串台）
      callMainAgent: (() => {
        if (!this.callMainAgentFn) return undefined;
        const currentSessionId = sessionId ?? "";
        const binding = SUPERVISOR_MANAGER.getBySupervisor(currentSessionId);
        if (!binding) return undefined; // 当前 session 不是监督 Agent → 不注入
        return (message: string, abortSignal?: AbortSignal) =>
          this.callMainAgentFn!(binding.mainSessionId, message, abortSignal);
      })(),
      isSupervisorSession: SUPERVISOR_MANAGER.isSupervisorSession(sessionId ?? ""),
      // 注入 SUPERVISOR_MANAGER 单例（supervisor 工具通过它查询/更新绑定）
      supervisorManager: SUPERVISOR_MANAGER,
    };

    // ── 按 parallelSafe / blocking 分组执行 ──
    // 连续的 parallelSafe（只读）工具合并为并发组并行执行；其余串行。
    // blocking=false 的工具（后台 fire-and-forget）：立即提交占位 tool_result，
    //   后台异步执行真实工具，loop 不等待直接进下一轮。
    // 执行可并发，但「提交」（落盘 raw + 写 session 消息 + yield 事件）严格按调用顺序，
    // 保证下一轮 LLM 看到的工具结果顺序与调用顺序一致。
    //
    // 收集本轮所有「真实执行」（非 background）工具的 ok 状态，
    // 用于 endsLoop 判定时考虑执行失败（task_finish 失败时不应退出 loop）。
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
        if (group.length > 1) {
          yield this.logEvent("info", `并行执行 ${group.length} 个只读工具: ${group.map(g => g.name).join(", ")}`);
        }
        const commits = await Promise.all(
          group.map((g) => this.execOneToolCall(g, round, sessionId, context, prof)),
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
        const commit = await this.execOneToolCall(toolCalls[i], round, sessionId, context, prof);
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
    // 一轮内若所有被调工具都是 endsLoop（收尾型，如 task_finish），默认结束 loop；
    // 但若当前 session 的 task 表还有未完成 todo，强制继续下一轮——
    // 让 AI 必须把所有规划任务做完才能退出（task 表接管 loop 条件）。
    //
    // 失败兜底（致命#3）：endsLoop 工具执行失败（ok=false）时，不退出 loop，
    // 让 AI 看到错误信息后继续处理（否则 task_finish 失败也会退出 loop，用户卡死）。
    const allEndsLoop = !toolCalls.some((tc) => !this.toolEndsLoop(tc.name));
    if (allEndsLoop) {
      const endsLoopFailed = executedTools.some(
        (t) => this.toolEndsLoop(t.name) && t.ok === false,
      );
      if (endsLoopFailed) {
        this.log("warn", "[Runtime] endsLoop 工具执行失败（ok=false），不退出 loop，让 AI 继续处理");
        return true;
      }
      try {
        const tasks = TASK_MANAGER.getTasks(sessionId);
        if (tasks.length > 0 && !tasks.every((t) => t.status === "completed")) {
          return true; // 还有未完成 todo，强制继续 loop
        }
      } catch (err) {
        // TaskManager 读取失败属于系统错误，直接抛出让上层处理
        throw new Error(`TaskManager 读取失败，无法判断 loop 是否应结束: ${err}`);
      }
      return false;
    }
    return true;
  }

  /** 该工具调用后是否终止 loop（收尾型，如 task_finish）。 */
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
  /**
   * eve loop/end.md 达标检查：用一次性模型调用判断任务是否真完成。
   * 返回 {done, feedback}；解析失败视为完成（不卡死）；判定异常返回 null（调用方视为通过）。
   *
   * 调用路径优先级：
   *   1. auxModelCaller（统一辅助调用管道，独立 token 统计）—— 用辅助 preset
   *   2. callModelFn（旧路径，混入主调用 token）—— 用主 preset
   */
  private async judgeLoopEnd(
    criteria: string,
    sessionId: string,
    preset: APIPreset,
    agentName: string,
    abortSignal?: AbortSignal,
  ): Promise<{ done: boolean; feedback: string } | null> {
    try {
      const sess = this.sessions.load(sessionId);
      const recent = (sess?.messages ?? []).slice(-8)
        .map((m) => `[${m.role}] ${String(m.content ?? "").slice(0, 800)}`).join("\n").slice(0, 8000);
      const systemPrompt = `你是任务达标检查员。根据「完成标准」判断对话中的任务是否已真正完成。\n\n完成标准：\n${criteria}\n\n只输出一行 JSON：{"done": true/false, "feedback": "若未完成简述还差什么"}`;
      const userPrompt = `近期对话：\n${recent}`;

      // 优先走 auxModelCaller（统一辅助调用管道）
      if (this.auxModelCaller) {
        const helperPreset = this.resolveHelperPresetFn
          ? this.resolveHelperPresetFn(agentName, preset)
          : preset;
        const result = await this.auxModelCaller.callJson(
          {
            preset: helperPreset,
            systemPrompt,
            userPrompt,
            abortSignal,
            context: { sessionId, tag: "loop_judge" },
          },
          preset, // fallback 主 preset
        );
        if (!result.ok) return null;
        if (!result.json) return { done: true, feedback: "" };
        return {
          done: result.json.done !== false,
          feedback: String(result.json.feedback ?? ""),
        };
      }

      // 旧路径：callModelFn（混入主调用 token）
      const messages: Record<string, unknown>[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
      const gen = this.callModelFn({ preset, messages, stream: false, toolSchemas: null, nativeToolCalling: false, autoFormat: false, jsonSettings: null, sessionId, round: 0, abortSignal });
      let r = await gen.next();
      while (!r.done) r = await gen.next();
      const content = String((r.value as ModelCallResult).content ?? "");
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) return { done: true, feedback: "" };
      const parsed = JSON.parse(m[0]) as { done?: boolean; feedback?: string };
      return { done: parsed.done !== false, feedback: String(parsed.feedback ?? "") };
    } catch {
      return null;
    }
  }

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
    try {
      const tasks = TASK_MANAGER.getTasks(sessionId);
      if (tasks.length === 0) return false;
      return tasks.every((t) => t.status === "completed");
    } catch {
      return false;
    }
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
   * 执行单个工具调用（异步部分），返回一个 commit 闭包。
   * commit() 同步执行所有有序副作用（落盘 raw + 写 session 消息）并返回需 yield 的事件数组。
   * 拆分「执行」与「提交」，使并发组可并行执行、按序提交。
   */
  private async execOneToolCall(
    toolCall: LLMToolCall,
    round: number,
    sessionId: string,
    context: ToolContext,
    prof?: Profiler,
    opts?: { background?: boolean },
  ): Promise<() => StreamEvent[]> {
    const tcInfo = { id: toolCall.id, name: toolCall.name, parameters: toolCall.parameters };
    // background=true：后台执行（fire-and-forget），commit() 时跳过 appendMessage
    // （占位 tool_result 已由 commitBackgroundToolCall 写入，重复写会破坏 tool_call_id 一一对应）
    const background = opts?.background ?? false;

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
        this.sessions.appendRawEntry(sessionId, { type: "tool_call", round, created_at: now(), data: { name: toolCall.name, parameters: toolCall.parameters ?? {}, id: toolCall.id, provider: toolCall.provider, tool_type: toolCall.type } });
        this.sessions.appendRawEntry(sessionId, { type: "tool_result", round, created_at: now(), data: { tool_name: toolCall.name, tool_call_id: toolCall.id, content: emptyMsg, ok: false, background } });
        const events: StreamEvent[] = [
          this.event("tool_call", { tool: { id: toolCall.id, name: toolCall.name, parameters: toolCall.parameters ?? {}, provider: toolCall.provider, type: toolCall.type }, round }),
          this.event("tool_result", { toolCallId: toolCall.id, name: toolCall.name, content: emptyMsg, ok: false, round, background }),
        ];
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

      // background=true：tool_call 日志由 commitBackgroundToolCall 已写过，这里不重复
      if (!background) {
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
        const blockedMsg = `工具 ${toolCall.name} 被钩子拦截`;
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

      // background=true：跳过 appendMessage（占位已写入，再写会破坏 tool_call_id 一一对应）
      if (background) {
        return events;
      }

      const toolMeta: Record<string, unknown> = {
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

  private logEvent(level: string, message: string): StreamEvent {
    return { type: "log", level, message };
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
