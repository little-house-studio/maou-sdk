/**
 * SubagentExecutor — 子 Agent 真并行执行器（#4 task 并行执行）。
 *
 * 职责：
 *   1. 接收一层可并行执行的 task（由 TaskScheduler.selectLayer 给出）
 *   2. 为每个 task fork 一个独立子 Agent（独立 sessionId + 独立上下文）
 *   3. 并发调用 LLM（Promise.all）执行各子 Agent
 *   4. 收集各子 Agent 的最终输出，作为 tool_result 合并回主 session
 *
 * 解耦设计：SubagentExecutor 不直接依赖 AgentRuntime（避免循环依赖 + 让 harness 可注入自定义 run 函数）。
 * harness 注入 `runFn` —— 它接收 (子 sessionId, taskId, 任务描述, options) 并返回流式事件生成器。
 *
 * 实现 SubagentExecutorLike 契约（types 包），让 agent_message 工具可跨包调用。
 *
 * P1-1 递归深度控制：fork 维护 taskDepth，到达 maxRecursionDepth（默认 2）拒绝 fork。
 * P1-2 预算 + wall-clock 超时：softRequestBudget（默认 90）/ maxRuntimeMs（默认 0=禁用），
 *      超 soft budget 注入 wrap-up 提示，超 1.5x abort。
 * P1-6 进度追踪：fork 接收 onProgress 回调 + publish 到 SUBAGENT_EVENT_BUS，
 *      从 runFn 事件流提取 currentTool / recentTools / recentOutput / tokens / requests / cost。
 * P1-7 输出 salvage：cancelled/aborted 子 Agent 也提取最后一条 assistant 文本，
 *      格式化为 `[cancelled after N req, M tok — last activity: "..."]`。
 *
 * @see DESIGN.md 第 25 行「fork与合并与上下文管理」
 * @see subagent-registry.ts（约定目录扫描 + schema 生成）
 */

import type { StreamEvent, SubagentExecutorLike, SubagentResultLike, ForkOptions, AgentProgress, McpToolDescriptor, McpToolInvoker } from "@little-house-studio/types";
import { SUBAGENT_EVENT_BUS } from "./event-bus.js";
import { AgentLifecycleManager } from "./agent-lifecycle.js";
import { MessageBus } from "./message-bus.js";
import type { Tool } from "@little-house-studio/tools";
import { createMcpProxyTools } from "./mcp-proxy.js";
import { IsolationRunner } from "./isolation-runner.js";
import type { WorktreeHandle } from "./isolation-runner.js";
import {
  resolveForkKindPolicy,
  type ForkKindPolicy,
} from "./subagent-kinds.js";
import {
  resolveSubagentRunPlan,
  materializeIfNeeded,
  type SubagentRunPlan,
} from "./subagent-policy.js";
import type { AuxModelCallerLike } from "@little-house-studio/types";

/** harness 注入的 run 函数类型 */
export type SubagentRunFn = (
  subSessionId: string,
  taskId: string,
  taskDesc: string,
  options?: {
    parentSessionId?: string;
    /** 子 Agent 使用的 agent 名（forkMode='context_and_config' 时必填） */
    agentName?: string;
    /** fork 模式：context_only（同配置）/ context_and_config（独立配置） */
    forkMode?: 'context_only' | 'context_and_config';
    /** 临时覆盖 agent.json 字段（harness 创建临时 agent 文件，结束清理） */
    configOverrides?: Record<string, unknown>;
    abortSignal?: AbortSignal;
    /**
     * 注入给子 Agent 运行时的"收尾提示"（P1-2）。
     * 当子 Agent 超 soft budget 时，executor 调此函数让 runFn 向子 Agent 注入
     * 一条 wrap-up system/user 提示（"请尽快收尾，不要再调用工具"）。
     * runFn 实现可选（不实现则降级为仅 abort）。
     */
    injectWrapUpHint?: () => void;
    /**
     * MCP 代理工具实例（P2-4，inheritMcp !== false 时传入）。
     * runFn 应把这些 Tool 实例注册到子 Agent 的 ToolRegistry（并在子 session 结束后清理）。
     * 这些工具调用时转发给父 Agent 的 MCP 连接，子 Agent 不建连。
     */
    mcpProxyTools?: Tool[];
    /**
     * 子 Agent 的 projectRoot（P2-2 isolated worktree 时传入）。
     * 缺省 → runFn 用主 Agent 的 projectRoot。
     * isolated=true 时，executor 调 IsolationRunner.createWorktree() 拿到 worktree 路径，
     * 在此传入；runFn 应把子 Agent 的工作目录设为此路径（覆盖默认 projectRoot）。
     */
    projectRoot?: string;
    /** 完整复制母 session 上下文（fork kind 默认 true） */
    inheritFullContext?: boolean;
    /** multi-round loop；false = 单轮（helper） */
    agentMode?: boolean;
    /**
     * 工具白名单覆盖（kind 解析后）。
     * - undefined：不改母/agent 白名单
     * - []：无工具（helper 单轮强制）
     * - string[]：仅这些工具
     */
    toolWhitelist?: string[];
    /** 子工程驻扎路径（project） */
    scopedPath?: string;
    /** 路径外审核列表（project） */
    auditPaths?: string[];
    /** 解析后的 kind 运行计划（含 pathGuard） */
    kindPolicy?: SubagentRunPlan | ForkKindPolicy;
  },
) => AsyncGenerator<StreamEvent, { finalOutput: string; ok: boolean; error?: string }>;

export interface SubagentExecutorOptions {
  /** harness 注入的 run 函数（必需） */
  runFn: SubagentRunFn;
  /** 生成子 sessionId 的工厂（默认用 parent + taskId + 随机） */
  subSessionIdFactory?: (parentSessionId: string, taskId: string) => string;
  /** 最大并发数（默认 5） */
  maxConcurrency?: number;
  /** 日志函数 */
  log?: (level: string, message: string) => void;
  /**
   * 非持久化 helper 走 AuxModelCaller（单轮无 tool）。
   * 未注入时 helper !persist 仍拒绝。
   */
  auxModelCaller?: AuxModelCallerLike;
  /** 解析 helper 用的 preset（Aux 路径） */
  resolveHelperPreset?: () => unknown | undefined;
  /** 物化目录用 maouRoot；缺省不自动 materialize */
  maouRoot?: string;
  /** 母 agent 名（materialize nested 路径） */
  parentAgentName?: string;
  /**
   * 默认最大递归深度（P1-1，默认 2）。
   * ForkOptions.maxRecursionDepth 未显式传时用此值。
   * 子 Agent 再 fork 子 Agent 的层数上限。
   */
  defaultMaxRecursionDepth?: number;
  /**
   * 默认 soft 请求预算（P1-2，默认 90）。
   * 子 Agent LLM 请求轮数（agent_round）到达此值后，注入 wrap-up 提示。
   */
  defaultSoftRequestBudget?: number;
  /**
   * 默认 wall-clock 超时毫秒（P1-2，默认 0 = 禁用）。
   * 子 Agent 运行超过此时长会被 abort。
   */
  defaultMaxRuntimeMs?: number;
  /**
   * 父 Agent 的 MCP 工具列表（P2-4）。
   * fork 时（inheritMcp !== false）把这些 descriptor 包装成 proxy 工具传给子 Agent。
   * harness/AgentRuntime 在装配 executor 时注入（从 ConnectionRegistry + MCP client 提取）。
   * 缺省（空数组/undefined）→ fork 时不传 proxy 工具（子 Agent 无 MCP 能力）。
   */
  parentMcpTools?: McpToolDescriptor[];
  /**
   * MCP 工具调用转发器（P2-4）。
   * proxy 工具 execute 时调此函数把调用转发给父 Agent 的 MCP 连接。
   * harness/AgentRuntime 注入真实实现（调 McpClient.callTool）。
   * 缺省（undefined）→ proxy 工具返回错误提示 MCP 未连接。
   */
  mcpInvoker?: McpToolInvoker;
  /**
   * 主 Agent 的 projectRoot（P2-2 worktree 隔离用）。
   * isolated=true 时，executor 用此路径调 IsolationRunner.createWorktree()。
   * 缺省 → IsolationRunner 在内部用 process.cwd()。
   * harness/AgentRuntime 装配 executor 时注入（用 AgentRuntime.projectRoot）。
   */
  projectRoot?: string;
  /**
   * 自定义 IsolationRunner 实例（P2-2，可选）。
   * 缺省 → executor 在首次 isolated fork 时按 projectRoot new 一个。
   * 注入自定义实例便于测试 mock 或共享 worktree 目录配置。
   */
  isolationRunner?: IsolationRunner;
  /**
   * per-session yield 回调注册函数（P2-1）。
   *
   * 由 AgentRuntime 注入（runtime.setYieldHandler）。
   * fork 运行子 Agent 前调此函数把子 sessionId 与 yield 回调绑定，
   * runtime 的 processToolCalls 会从该绑定读取并注入到子 Agent 的 ToolContext.yieldResult。
   * 子 Agent 调 yield 工具时触发回调 → fork 检测到 → 结束子 Agent 循环。
   *
   * 缺省（undefined）→ yield 工具在子 Agent ctx 里为 undefined → 返回未启用提示。
   * 即纯 SDK 默认 runFn 场景下 yield 不工作（需 runtime 注入此函数才启用）。
   */
  setYieldHandlerFn?: (sessionId: string, handler: ((result: string, summary?: string) => void) | null) => void;
}

/** 进度上报节流间隔（毫秒），避免事件流密集时频繁回调 */
const PROGRESS_THROTTLE_MS = 250;
/** recentTools 最多保留条数 */
const RECENT_TOOLS_MAX = 8;
/** recentOutput 截断长度 */
const RECENT_OUTPUT_MAX = 200;
/** P2-1：yield 校验失败时的最大重试次数（子 Agent 重新 yield 的次数上限）。 */
const MAX_YIELD_RETRIES = 3;

/**
 * SubagentExecutor 实现 SubagentExecutorLike 契约。
 *
 * fork(taskId, taskDesc) → 单个子 Agent 执行
 * forkLayer(tasks: Array<{id, desc}>) → 并发 fork 一层
 */
export class SubagentExecutor implements SubagentExecutorLike {
  private _runFn: SubagentRunFn;
  private _idFactory: (parentSessionId: string, taskId: string) => string;
  private _maxConcurrency: number;
  private _log: (level: string, message: string) => void;
  private _defaultMaxRecursionDepth: number;
  private _defaultSoftRequestBudget: number;
  private _defaultMaxRuntimeMs: number;
  /** 父 Agent 的 MCP 工具列表（P2-4） */
  private _parentMcpTools: McpToolDescriptor[];
  /** MCP 工具调用转发器（P2-4） */
  private _mcpInvoker?: McpToolInvoker;
  /** 主 Agent 的 projectRoot（P2-2 worktree 隔离用） */
  private _projectRoot?: string;
  /** IsolationRunner 实例（P2-2，惰性创建） */
  private _isolationRunner?: IsolationRunner;
  /** per-session yield 回调注册函数（P2-1，由 AgentRuntime 注入） */
  private _setYieldHandlerFn?: (sessionId: string, handler: ((result: string, summary?: string) => void) | null) => void;
  /** 非持久 helper → AuxModelCaller */
  private _auxModelCaller?: AuxModelCallerLike;
  private _resolveHelperPreset?: () => unknown | undefined;
  /** 自动 materialize 目录 */
  private _maouRoot?: string;
  private _parentAgentName?: string;
  /** 当前 parentSessionId（harness 注入；fork 时若未传 parentSessionId 用此值） */
  parentSessionId: string = "";
  /**
   * 当前 fork 的递归深度（P1-1）。
   * runtime 注入 executor 时可设置此值；fork 时若 ForkOptions.taskDepth 未传则用它。
   * 子 Agent 内部再 fork 时，executor 会把 depth+1 传给子 runFn 的上下文
   * （通过 configOverrides 或子 executor 的 taskDepth 字段——由 harness/runFn 协调）。
   */
  taskDepth: number = 0;

  /**
   * 更新父 Agent 的 MCP 工具列表（P2-4）。
   * harness/AgentRuntime 在 MCP 连接建立/断开后调此方法动态更新 executor 持有的列表。
   * 后续 fork（inheritMcp !== false）会使用最新列表生成 proxy 工具。
   */
  setParentMcpTools(tools: McpToolDescriptor[]): void {
    this._parentMcpTools = tools ?? [];
  }

  /**
   * 更新 MCP 工具调用转发器（P2-4）。
   * harness/AgentRuntime 在 MCP 连接建立后调此方法注入真实 invoker。
   */
  setMcpInvoker(invoker: McpToolInvoker | undefined): void {
    this._mcpInvoker = invoker;
  }

  /** 当前父 Agent MCP 工具数量（调试/日志用） */
  get parentMcpToolCount(): number {
    return this._parentMcpTools.length;
  }

  /**
   * 更新主 Agent 的 projectRoot（P2-2）。
   * harness/AgentRuntime 装配 executor 时注入（用 AgentRuntime.projectRoot）。
   * 后续 isolated=true 的 fork 用此路径调 IsolationRunner.createWorktree()。
   */
  setProjectRoot(projectRoot: string | undefined): void {
    this._projectRoot = projectRoot;
    // projectRoot 变更时，重置 IsolationRunner（下次 isolated fork 会按新路径重建）
    this._isolationRunner = undefined;
  }

  /** 获取/惰性创建 IsolationRunner（P2-2） */
  private _getIsolationRunner(): IsolationRunner {
    if (this._isolationRunner) return this._isolationRunner;
    this._isolationRunner = new IsolationRunner({
      projectRoot: this._projectRoot ?? process.cwd(),
      log: this._log,
    });
    return this._isolationRunner;
  }

  /**
   * 注入 per-session yield 回调注册函数（P2-1）。
   * AgentRuntime 装配 executor 后调此方法注入 runtime.setYieldHandler。
   * 注入后，fork 会为每个子 Agent 注册 yield 回调，让子 Agent 的 yield 工具可用。
   */
  setYieldHandlerFn(fn: ((sessionId: string, handler: ((result: string, summary?: string) => void) | null) => void) | undefined): void {
    this._setYieldHandlerFn = fn;
  }

  constructor(opts: SubagentExecutorOptions) {
    this._runFn = opts.runFn;
    this._idFactory = opts.subSessionIdFactory ?? defaultSubSessionIdFactory;
    this._maxConcurrency = opts.maxConcurrency ?? 5;
    this._log = opts.log ?? (() => {});
    this._defaultMaxRecursionDepth = opts.defaultMaxRecursionDepth ?? 2;
    this._defaultSoftRequestBudget = opts.defaultSoftRequestBudget ?? 90;
    this._defaultMaxRuntimeMs = opts.defaultMaxRuntimeMs ?? 0;
    this._parentMcpTools = opts.parentMcpTools ?? [];
    this._mcpInvoker = opts.mcpInvoker;
    this._projectRoot = opts.projectRoot;
    this._isolationRunner = opts.isolationRunner;
    this._setYieldHandlerFn = opts.setYieldHandlerFn;
    this._auxModelCaller = opts.auxModelCaller;
    this._resolveHelperPreset = opts.resolveHelperPreset;
    this._maouRoot = opts.maouRoot;
    this._parentAgentName = opts.parentAgentName;
  }

  /** 动态注入 AuxModelCaller（runtime-facade 装配后可补） */
  setAuxModelCaller(
    caller: AuxModelCallerLike | undefined,
    resolvePreset?: () => unknown | undefined,
  ): void {
    this._auxModelCaller = caller;
    if (resolvePreset) this._resolveHelperPreset = resolvePreset;
  }

  setMaterializeRoots(maouRoot?: string, parentAgentName?: string): void {
    if (maouRoot !== undefined) this._maouRoot = maouRoot;
    if (parentAgentName !== undefined) this._parentAgentName = parentAgentName;
  }

  /**
   * 非持久 helper：单轮无 tool，走 AuxModelCaller（不进管理列表）。
   */
  private async _runHelperAux(
    taskId: string,
    taskDesc: string,
    subSessionId: string,
    start: number,
    plan: SubagentRunPlan,
    options?: ForkOptions,
  ): Promise<SubagentResultLike> {
    if (!this._auxModelCaller) {
      this._log(
        "warning",
        `[FORK] task=${taskId} helper aux：未注入 AuxModelCaller，拒绝`,
      );
      return {
        taskId,
        subSessionId,
        output: "",
        ok: false,
        error:
          "非持久化 helper 需 AuxModelCaller。请在 SubagentExecutor 注入 auxModelCaller，或设置 persistContext=true。",
        elapsedMs: Date.now() - start,
        requests: 0,
        tokens: 0,
      };
    }
    const preset = this._resolveHelperPreset?.();
    if (!preset) {
      return {
        taskId,
        subSessionId,
        output: "",
        ok: false,
        error: "helper aux：无可用 preset",
        elapsedMs: Date.now() - start,
      };
    }
    const systemPrompt =
      typeof options?.configOverrides?.system_prompt === "string"
        ? String(options.configOverrides.system_prompt)
        : "你是辅助 agent：单轮、快速、无工具。直接给出结果，不要调用工具，不要展开多轮计划。";
    this._log("info", `[FORK] task=${taskId} helper → AuxModelCaller（单轮无 tool）`);
    try {
      const result = await this._auxModelCaller.callText(
        {
          preset,
          systemPrompt,
          userPrompt: taskDesc,
          abortSignal: options?.abortSignal,
          context: { sessionId: subSessionId, tag: "helper_subagent" },
        },
      );
      return {
        taskId,
        subSessionId,
        output: result.content || "",
        ok: result.ok,
        error: result.error,
        elapsedMs: Date.now() - start,
        requests: 1,
        tokens: 0,
      };
    } catch (err) {
      return {
        taskId,
        subSessionId,
        output: "",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - start,
      };
    }
  }

  /**
   * Fork 一个子 Agent 执行单个 task。
   * 实现 SubagentExecutorLike.fork 契约。
   *
   * @param taskId task 标识
   * @param taskDesc 任务描述（自然语言，子 Agent 的输入）
   * @param options fork 选项（forkMode/agentName/configOverrides/递归深度/预算/超时/进度回调）
   */
  async fork(taskId: string, taskDesc: string, options?: ForkOptions): Promise<SubagentResultLike> {
    const parentSessionId = this.parentSessionId;
    const subSessionId = this._idFactory(parentSessionId, taskId);
    const start = Date.now();

    // ── kind 策略解析（多态 SubagentPolicy → RunPlan）──
    // helper 未持久化 → aux 通道（有 AuxModelCaller 则自动跑，否则拒绝）
    // helper 单轮 → tools=[]、strip MCP、softBudget=1、agentMode=false
    // fork → inheritFullContext 默认 true
    // task/project → 预设白名单 + wrap-up；project 带 pathGuard
    const kindInput = {
      kind: options?.kind,
      enableLoop: options?.enableLoop,
      persistContext: options?.persistContext,
      inheritFullContext: options?.inheritFullContext,
      stripToolsIfSingleRound: options?.stripToolsIfSingleRound,
      tools: options?.tools,
      toolPreset: options?.toolPreset as import("./subagent-kinds.js").TaskToolPresetName | undefined,
      permission: options?.permission as import("./subagent-kinds.js").SubagentPermission | undefined,
      roundLimit: options?.roundLimit,
      path: options?.path,
      auditPaths: options?.auditPaths,
      softRequestBudget: options?.softRequestBudget,
      configOverrides: options?.configOverrides,
      ephemeral: (options as { ephemeral?: boolean } | undefined)?.ephemeral,
    };
    const kindPolicy: SubagentRunPlan | null =
      resolveSubagentRunPlan(kindInput) ??
      (options?.kind
        ? null
        : null);

    // 兼容：无 kind 时仍可用旧 resolveForkKindPolicy 路径（null）
    const legacyPolicy = !kindPolicy && options?.kind
      ? resolveForkKindPolicy(kindInput)
      : null;
    const policy: SubagentRunPlan | ForkKindPolicy | null = kindPolicy ?? legacyPolicy;

    // 非持久 helper → Aux 单轮（不进 Executor 管理列表 / 不 materialize）
    if (policy && "runChannel" in policy && policy.runChannel === "aux") {
      return this._runHelperAux(taskId, taskDesc, subSessionId, start, policy as SubagentRunPlan, options);
    }
    if (policy && !("runChannel" in policy) && !policy.useExecutor) {
      return this._runHelperAux(
        taskId,
        taskDesc,
        subSessionId,
        start,
        { ...(policy as ForkKindPolicy), runChannel: "aux", shouldMaterialize: false } as SubagentRunPlan,
        options,
      );
    }

    // 持久化 kind：自动物化目录模板（可回档 / 进管理列表）
    if (
      policy &&
      this._maouRoot &&
      (("shouldMaterialize" in policy && policy.shouldMaterialize) ||
        (policy.persistContext && policy.listInManager))
    ) {
      try {
        const plan =
          "shouldMaterialize" in policy
            ? (policy as SubagentRunPlan)
            : ({
                ...(policy as ForkKindPolicy),
                runChannel: "executor" as const,
                shouldMaterialize: true,
              } as SubagentRunPlan);
        const mat = materializeIfNeeded(plan, {
          maouRoot: this._maouRoot,
          name: options?.agentName || taskId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48),
          parentAgentName: this._parentAgentName,
          systemPrompt:
            typeof options?.configOverrides?.system_prompt === "string"
              ? String(options.configOverrides.system_prompt)
              : undefined,
        });
        if (mat?.created) {
          this._log("info", `[FORK] materialize ${plan.kind} → ${mat.dir}`);
        }
      } catch (err) {
        this._log(
          "warning",
          `[FORK] materialize 失败（继续执行）: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // kind 驱动 forkMode 默认：有独立 tools/path/permission 时倾向 context_and_config
    let forkMode = options?.forkMode;
    if (!forkMode && policy) {
      const needsOwnConfig =
        policy.kind === "task" ||
        policy.kind === "project" ||
        policy.stripTools ||
        (policy.tools.length > 0 && policy.kind !== "fork");
      forkMode = needsOwnConfig && options?.agentName
        ? "context_and_config"
        : "context_only";
    }
    forkMode = forkMode ?? "context_only";

    // ── P1-1 递归深度控制 ──
    const currentDepth = options?.taskDepth ?? this.taskDepth;
    const maxDepth = options?.maxRecursionDepth ?? this._defaultMaxRecursionDepth;
    if (currentDepth >= maxDepth) {
      this._log("warning", `[FORK] task=${taskId} 递归深度上限到达: depth=${currentDepth} max=${maxDepth}，拒绝 fork`);
      SUBAGENT_EVENT_BUS.publishLifecycle({
        kind: "depth_limit",
        taskId,
        currentDepth,
        maxDepth,
      });
      return {
        taskId,
        subSessionId,
        output: `(递归深度上限 ${maxDepth} 已到达，拒绝 fork。当前深度 ${currentDepth})`,
        ok: false,
        error: `递归深度上限到达: depth=${currentDepth} >= max=${maxDepth}`,
        elapsedMs: 0,
        requests: 0,
        tokens: 0,
      };
    }

    this._log(
      "info",
      `[FORK] task=${taskId} kind=${policy?.kind ?? "-"} mode=${forkMode} depth=${currentDepth}/${maxDepth} agent=${options?.agentName ?? "(inherit)"} inherit_ctx=${policy?.inheritFullContext ?? options?.inheritFullContext ?? false} sub_session=${subSessionId} desc="${taskDesc.slice(0, 60)}"`,
    );

    // forkMode='context_and_config' 必须传 agentName
    if (forkMode === 'context_and_config' && !options?.agentName) {
      return {
        taskId,
        subSessionId,
        output: "",
        ok: false,
        error: "forkMode='context_and_config' 必须传 agentName",
        elapsedMs: 0,
      };
    }

    // ── P1-2 预算 + 超时配置（kind.roundLimit → softBudget；超限 wrap-up）──
    const softBudget =
      options?.softRequestBudget ??
      policy?.softRequestBudget ??
      this._defaultSoftRequestBudget;
    const maxRuntimeMs = options?.maxRuntimeMs ?? this._defaultMaxRuntimeMs;
    // agentName：context_and_config 用 options.agentName；context_only 继承父 agent（用 subSessionId 派生名）。
    const subAgentName = options?.agentName ?? `sub:${taskId}`;

    // 合并 configOverrides
    const mergedConfigOverrides: Record<string, unknown> = {
      ...(policy?.configOverrides ?? {}),
      ...(options?.configOverrides ?? {}),
    };
    if (policy?.stripTools) {
      mergedConfigOverrides.tools = [];
      mergedConfigOverrides.enable_loop = false;
    }

    // helper 单轮 / stripTools：不继承 MCP
    const inheritMcpResolved =
      policy?.stripTools ? false : options?.inheritMcp !== false;

    // inheritFullContext：fork 默认 true
    const inheritFullContext =
      options?.inheritFullContext ??
      policy?.inheritFullContext ??
      false;

    // agentMode：helper 单轮 false
    const agentMode = policy ? policy.enableLoop : true;

    // toolWhitelist：stripTools → []；有 kind tools 时传入
    let toolWhitelist: string[] | undefined;
    if (policy?.stripTools) {
      toolWhitelist = [];
    } else if (policy && Array.isArray(policy.tools) && policy.kind !== "fork") {
      toolWhitelist = policy.tools.includes("*") ? undefined : policy.tools;
    }

    // pathGuard：project/task 多态策略
    const pathGuard =
      (policy && "pathGuard" in policy ? (policy as SubagentRunPlan).pathGuard : undefined) ??
      undefined;
    const scopedPath = policy?.path;
    const auditPaths = policy?.auditPaths;

    // ── P2-2 worktree 隔离：isolated=true 时创建独立 worktree ──
    // worktree 路径作为子 Agent 的 projectRoot 传给 runFn（见下方 projectRoot: worktreeHandle?.path）
    // 子 Agent 结束后（finally 块）按 mergeBack/patchBack 选项回收改动 + removeWorktree
    let worktreeHandle: WorktreeHandle | undefined;
    if (options?.isolated) {
      try {
        const runner = this._getIsolationRunner();
        const baseBranch = options.isolationBaseBranch ?? "HEAD";
        worktreeHandle = await runner.createWorktree(baseBranch, subAgentName);
        this._log("info", `[FORK] task=${taskId} worktree 隔离已创建: ${worktreeHandle.path} (branch=${worktreeHandle.branch})`);
      } catch (err) {
        // worktree 创建失败（非 git 仓库 / 路径冲突等）→ 降级为非隔离
        this._log("warning", `[FORK] task=${taskId} worktree 创建失败，降级为非隔离: ${err instanceof Error ? err.message : String(err)}`);
        worktreeHandle = undefined;
      }
    }

    // ── P2-3 detached 后台运行：detached=true 时立即返回占位结果 ──
    // 子 Agent 在后台运行（不 await），结果通过 SUBAGENT_EVENT_BUS 异步上报（lifecycle: fork_end）
    // 父 Agent 可通过 agent_manage list 或 EventBus 订阅 progress/lifecycle channel 查进度
    //
    // 注意：detached 分支在 fork_start/adopt 之前返回，避免外层 fork adopt 一个不会执行的 subSessionId
    // （留下 running 状态的孤儿）。后台 _runForkBackground 调 this.fork(detached:false) 会走完整生命周期。
    if (options?.detached) {
      this._log("info", `[FORK] task=${taskId} detached=true，后台启动，立即返回 taskId`);
      // 后台触发执行（不 await —— fire-and-forget）
      void this._runForkBackground({
        taskId,
        taskDesc,
        options,
        parentSessionId,
        subSessionId,
        forkMode,
        start,
        currentDepth,
        maxDepth,
        softBudget,
        maxRuntimeMs,
        subAgentName,
        worktreeHandle,
      }).catch((err) => {
        this._log("warning", `[FORK] task=${taskId} 后台执行异常: ${err instanceof Error ? err.message : String(err)}`);
      });
      return {
        taskId,
        subSessionId,
        output: `(子 Agent 已后台启动，taskId=${taskId}。通过 agent_manage list 或 EventBus 订阅查看进度与结果。)`,
        ok: true,
        elapsedMs: Date.now() - start,
      };
    }

    SUBAGENT_EVENT_BUS.publishLifecycle({
      kind: "fork_start",
      taskId,
      subSessionId,
      taskDepth: currentDepth,
      desc: taskDesc.slice(0, 120),
    });

    // ── P1-4 子 Agent 生命周期：adopt + running（用 subSessionId 索引）──
    const lifecycle = AgentLifecycleManager.global();
    lifecycle.adopt(subSessionId, subAgentName);
    lifecycle.setStatus(subSessionId, "running");
    // P1-3 消息总线：注册子 agent mailbox（让其他 agent 能向子 agent 投递）
    MessageBus.global().register(subAgentName);

    // ── P1-2 wall-clock 超时定时器 ──
    let timeoutAborted = false;
    let budgetAborted = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    // abortController 在 yield 重试时会被重建（P2-1），故用 let。
    // timeout / 外部 abortSignal 链接到「当前活动 controller」——通过 linkAbort() 在每次
    // 重建后重新链接（外部 abortSignal 只触发一次，timeout 持续生效到整个 fork 结束）。
    let abortController = new AbortController();
    const linkExternalAbort = (controller: AbortController) => {
      if (options?.abortSignal) {
        const external = options.abortSignal;
        if (external.aborted) {
          controller.abort();
        } else {
          external.addEventListener("abort", () => controller.abort(), { once: true });
        }
      }
    };
    linkExternalAbort(abortController);
    if (maxRuntimeMs > 0) {
      timeoutTimer = setTimeout(() => {
        timeoutAborted = true;
        abortController.abort();
        this._log("warning", `[FORK] task=${taskId} wall-clock 超时 ${maxRuntimeMs}ms，abort`);
        SUBAGENT_EVENT_BUS.publishLifecycle({
          kind: "timeout",
          taskId,
          elapsedMs: Date.now() - start,
          maxRuntimeMs,
        });
      }, maxRuntimeMs);
    }

    // ── 进度追踪状态（P1-6）──
    const onProgress = options?.onProgress;
    let lastProgressMs = 0;
    let requests = 0;
    let tokens = 0;
    let cost = 0;
    let currentTool: string | undefined;
    const recentTools: Array<{ name: string; ok: boolean }> = [];
    let lastAssistantText = ""; // 用于 P1-7 salvage

    const buildProgress = (): AgentProgress => ({
      taskId,
      subSessionId,
      currentTool,
      recentTools: [...recentTools],
      recentOutput: lastAssistantText.slice(-RECENT_OUTPUT_MAX) || undefined,
      tokens,
      requests,
      cost,
      elapsedMs: Date.now() - start,
    });

    const emitProgress = (force = false) => {
      if (!onProgress && SUBAGENT_EVENT_BUS.subscriberCount("progress") === 0) return;
      const now = Date.now();
      if (!force && now - lastProgressMs < PROGRESS_THROTTLE_MS) return;
      lastProgressMs = now;
      const prog = buildProgress();
      if (onProgress) {
        try { onProgress(prog); } catch { /* 回调异常不影响主流程 */ }
      }
      SUBAGENT_EVENT_BUS.publishProgress(prog);
    };

    // ── P2-1 yield 结果提交：注册 per-session 回调 ──
    // 子 Agent 调 yield 工具 → 触发此回调 → 捕获 result/summary + 标记 yielded +
    // abortController.abort() 结束子 Agent 循环。fork 在循环退出后检查 yielded 标志，
    // 若有 outputSchema 则校验 result，校验失败让子 Agent 重试（见下方重试循环）。
    const outputSchema = options?.outputSchema;
    let yieldedResult: string | undefined;
    let yieldedSummary: string | undefined;
    let yielded = false;
    const yieldHandler = (result: string, summary?: string) => {
      // 重试场景下可能再次 yield：覆盖前一次的结果
      yieldedResult = result;
      yieldedSummary = summary;
      yielded = true;
      this._log("info", `[FORK] task=${taskId} 子 Agent yield 提交结果（${result.length} 字符${summary ? `, summary=${summary.slice(0, 60)}` : ""}）`);
      // abort 子 Agent 循环（yield 即结束，子 Agent 不应继续跑）
      // 仅在未被外部 abort 时触发，避免覆盖 timeoutAborted 标记
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    };
    if (this._setYieldHandlerFn) {
      this._setYieldHandlerFn(subSessionId, yieldHandler);
    }

    try {
      // ── P1-2 wrap-up 提示注入钩子 ──
      let wrapUpInjected = false;
      const injectWrapUpHint = () => {
        if (wrapUpInjected) return;
        wrapUpInjected = true;
        this._log("info", `[FORK] task=${taskId} 到达 soft budget ${softBudget}，注入 wrap-up 提示`);
        SUBAGENT_EVENT_BUS.publishLifecycle({
          kind: "budget_exceeded",
          taskId,
          requests,
          budget: softBudget,
        });
      };

      // ── P2-4 MCP 代理工具：inheritMcp !== false 且非 stripTools 时继承
      //    helper 单轮强制不继承 MCP（等同无 tool）
      const inheritMcp = inheritMcpResolved;
      let mcpProxyTools: Tool[] | undefined;
      if (inheritMcp && this._parentMcpTools.length > 0) {
        try {
          mcpProxyTools = createMcpProxyTools(
            this._parentMcpTools.map((descriptor) => ({
              descriptor,
              invoker: this._mcpInvoker,
            })),
          );
          this._log("info", `[FORK] task=${taskId} 继承 ${mcpProxyTools.length} 个 MCP proxy 工具`);
        } catch (err) {
          this._log("warning", `[FORK] task=${taskId} MCP proxy 工具构建失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // ── P2-1 yield + outputSchema 校验重试循环 ──
      // 子 Agent 调 yield 后，若有 outputSchema 则校验 result；失败则把错误反馈追加到
      // taskDesc 重新跑子 Agent（最多 MAX_YIELD_RETRIES 次）。无 outputSchema 时 yield 即接受。
      let finalOutput = "";
      let ok = true;
      let error: string | undefined;
      let currentTaskDesc = taskDesc;
      let yieldRetry = 0;
      let yieldValidationError: string | undefined;
      // 每次 yield 重试需要新的 generator + 新的 abortController（旧 controller 已被 yield abort）
      // generator 在循环内创建；abortController 在循环顶部按需重建。
      for (let attempt = 0; ; attempt++) {
        // 重建 abortController（首次除外）+ 重新注册 yield 回调（指向新的 controller）
        if (attempt > 0) {
          abortController = new AbortController();
          linkExternalAbort(abortController);
          // 重置 yielded 状态（本次重试的 yield 会重新填充）
          yielded = false;
          yieldedResult = undefined;
          yieldedSummary = undefined;
          // 重新注册 yield 回调（捕获最新的 controller 引用）
          if (this._setYieldHandlerFn) {
            this._setYieldHandlerFn(subSessionId, yieldHandler);
          }
        }

        const gen = this._runFn(subSessionId, taskId, currentTaskDesc, {
          parentSessionId,
          agentName: options?.agentName,
          forkMode,
          configOverrides: mergedConfigOverrides,
          abortSignal: abortController.signal,
          injectWrapUpHint,
          mcpProxyTools,
          // P2-2: isolated worktree 时把 worktree 路径作为子 Agent 的 projectRoot
          // project kind：scopedPath 优先于 worktree（除非 isolated 明确要求隔离）
          projectRoot: worktreeHandle?.path ?? scopedPath,
          inheritFullContext,
          agentMode,
          toolWhitelist,
          scopedPath,
          auditPaths,
          kindPolicy: policy
            ? ({
                ...policy,
                pathGuard:
                  pathGuard ??
                  ("pathGuard" in policy
                    ? (policy as SubagentRunPlan).pathGuard
                    : undefined),
              } as SubagentRunPlan)
            : undefined,
        });

        // 消费流式事件，提取进度 + 取最终返回值
        while (true) {
          const { value, done } = await gen.next();
          if (done) {
            if (value) {
              finalOutput = value.finalOutput;
              ok = value.ok;
              error = value.error;
            }
            break;
          }
          if (!value) continue;

          // 透传原始事件到 event channel（不阻塞）
          SUBAGENT_EVENT_BUS.publishEvent(taskId, value);

          // ── P1-6 从事件流提取进度信息 ──
          const evType = value.type as string;
          const ev = value as Record<string, unknown>;

          // LLM 请求轮数（agent_round 事件每轮一次）
          if (evType === "agent_round" || evType === "round") {
            requests++;
            // 超 soft budget 注入 wrap-up（runFn 实现了 injectWrapUpHint 才生效）
            if (requests >= softBudget) {
              injectWrapUpHint();
            }
            // 超 1.5x soft budget 强制 abort
            if (requests >= Math.ceil(softBudget * 1.5)) {
              this._log("warning", `[FORK] task=${taskId} 请求轮数 ${requests} 超 1.5x soft budget ${softBudget}，abort`);
              budgetAborted = true;
              abortController.abort();
            }
            emitProgress(true);
          }

          // token 用量（model.usage 事件）
          if (evType === "model.usage" || evType === "usage") {
            const usage = ev.usage as Record<string, unknown> | undefined;
            if (usage) {
              const tt = (usage.total_tokens as number) ?? (usage.totalTokens as number) ?? 0;
              tokens += Number(tt) || 0;
              // cost 估算（若 usage 携带 cost 字段则累加，否则留 0——精确 cost 由 harness 侧 TokenTracker 算）
              const c = (usage.cost as number) ?? 0;
              cost += Number(c) || 0;
            }
            emitProgress(true);
          }

          // assistant 文本（持续更新，用于 recentOutput + salvage）
          if (evType === "assistant" && typeof ev.content === "string") {
            lastAssistantText = ev.content;
            finalOutput = ev.content; // 持续更新到最后一条
          }

          // 工具调用（tool_call → currentTool）
          if (evType === "tool_call") {
            const tool = ev.tool as { name?: string } | undefined;
            if (tool?.name) {
              currentTool = tool.name;
            }
          }

          // 工具结果（tool_result → recentTools + currentTool 清空）
          if (evType === "tool_result") {
            const name = (ev.name as string) ?? currentTool ?? "(unknown)";
            const tok = typeof ev.ok === "boolean" ? ev.ok : false;
            recentTools.push({ name, ok: tok });
            if (recentTools.length > RECENT_TOOLS_MAX) recentTools.shift();
            currentTool = undefined;
            emitProgress(true);
          }

          emitProgress();
        }

        // ── P2-1 yield 校验 ──
        // timeout/budget abort 不做 yield 校验（子 Agent 被强制中断，非正常 yield）
        if (timeoutAborted || budgetAborted) break;

        // 未 yield：子 Agent 正常结束（无 yield 工具调用）→ 不重试
        if (!yielded) break;

        // yield 了但没设 outputSchema → 接受，结束
        if (!outputSchema) break;

        // 有 outputSchema → 校验
        const validationResult = validateYieldResult(yieldedResult!, outputSchema);
        if (validationResult.ok) {
          yieldValidationError = undefined;
          break; // 校验通过，结束
        }

        // 校验失败 → 重试（若未到上限）
        yieldRetry++;
        if (yieldRetry > MAX_YIELD_RETRIES) {
          yieldValidationError = validationResult.error;
          this._log("warning", `[FORK] task=${taskId} yield 校验失败且重试 ${MAX_YIELD_RETRIES} 次耗尽，接受最后结果（标记 yieldStatus=failed）`);
          break;
        }

        this._log("info", `[FORK] task=${taskId} yield 校验失败（第 ${yieldRetry} 次重试）: ${validationResult.error.slice(0, 200)}`);
        // 追加校验错误反馈到 taskDesc，让子 Agent 知道哪里错了、重新产出符合 schema 的结果
        currentTaskDesc =
          `${taskDesc}\n\n` +
          `── yield 校验反馈（第 ${yieldRetry} 次）──\n` +
          `你上一次调 yield 提交的结果不符合要求的 outputSchema：\n` +
          `${validationResult.error}\n\n` +
          `请根据上述错误重新产出符合 schema 的结果，并再次调用 yield 工具提交。\n` +
          `outputSchema 要求：\n${JSON.stringify(outputSchema, null, 2).slice(0, 1500)}`;
        // 继续下一轮循环重新跑子 Agent
      }

      // 最终强制发一次进度
      emitProgress(true);

      const aborted = abortController.signal.aborted;
      const abortReason = timeoutAborted ? "timeout"
        : (budgetAborted ? "budget" : undefined);

      // ── P2-1 yield 结果处理 ──
      // 子 Agent 调过 yield：优先用 yieldedResult 作为 output（结构化产出），
      // 不走 salvage 前缀（yield 是正常结束，非 cancelled/failed）。
      let yieldStatus: 'passed' | 'failed' | 'no_yield' | 'no_schema' = 'no_yield';
      if (yielded) {
        if (!outputSchema) {
          yieldStatus = 'no_schema';
        } else if (yieldValidationError) {
          yieldStatus = 'failed';
        } else {
          yieldStatus = 'passed';
        }
      }

      // ── P1-7 输出 salvage ──
      // cancelled/aborted 子 Agent 也提取最后一条 assistant 文本，避免父 Agent 重做
      let salvageOutput = finalOutput;
      let salvagePrefix = "";
      if (yielded) {
        // yield 了 → 用 yieldedResult 作为 output（不 salvage）
        salvageOutput = yieldedResult ?? finalOutput;
      } else if (aborted && lastAssistantText) {
        salvagePrefix = `[cancelled after ${requests} req, ${tokens} tok — last activity: "${lastAssistantText.slice(0, 120)}"]\n`;
        salvageOutput = salvagePrefix + (finalOutput || "");
        this._log("info", `[FORK] task=${taskId} 被 abort，salvage 最后输出（${lastAssistantText.length} 字符）`);
      } else if (!ok && lastAssistantText && !finalOutput) {
        // 失败但有部分输出——也 salvage
        salvagePrefix = `[failed after ${requests} req, ${tokens} tok — last activity: "${lastAssistantText.slice(0, 120)}"]\n`;
        salvageOutput = salvagePrefix + lastAssistantText;
      }

      // yield 校验失败 → 在 output 前加校验错误提示（让父 Agent 知道结果可能不符 schema）
      if (yieldStatus === 'failed' && yieldValidationError) {
        salvageOutput = `[yield 校验失败（重试 ${MAX_YIELD_RETRIES} 次耗尽）: ${yieldValidationError.slice(0, 300)}]\n${salvageOutput}`;
      }

      const result: SubagentResultLike = {
        taskId,
        subSessionId,
        output: salvageOutput || "(子 Agent 无输出)",
        ok,
        error,
        elapsedMs: Date.now() - start,
        tokens,
        requests,
        aborted: aborted || undefined,
        abortReason,
        // P2-1：yield 提交的结构化结果（父 Agent 可据此拿结构化产出）
        yieldedResult: yielded ? yieldedResult : undefined,
        yieldedSummary: yielded ? yieldedSummary : undefined,
        yieldStatus,
      };

      SUBAGENT_EVENT_BUS.publishLifecycle({
        kind: "fork_end",
        taskId,
        subSessionId,
        ok,
        elapsedMs: result.elapsedMs,
        requests,
        tokens,
      });

      // ── P1-4 子 Agent 生命周期：fork 结束 → idle（arm TTL，TTL 后自动 park）──
      // aborted 的子 agent 标记为 aborted（终态，不再 park）。
      lifecycle.setStatus(subSessionId, aborted ? "aborted" : "idle");

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._log("warning", `[FORK] task=${taskId} 失败: ${msg}`);
      const aborted = abortController.signal.aborted;

      // ── P1-7 输出 salvage（catch 分支）──
      // cancelled/aborted 子 Agent 也提取最后一条 assistant 文本
      let salvageOutput = "";
      if (lastAssistantText) {
        salvageOutput = `[cancelled after ${requests} req, ${tokens} tok — last activity: "${lastAssistantText.slice(0, 120)}"]\n${lastAssistantText}`;
        this._log("info", `[FORK] task=${taskId} 失败但 salvage 最后输出（${lastAssistantText.length} 字符）`);
      }

      if (aborted) {
        SUBAGENT_EVENT_BUS.publishLifecycle({
          kind: "abort",
          taskId,
          subSessionId,
          reason: timeoutAborted ? "timeout" : "abort_signal",
          elapsedMs: Date.now() - start,
        });
      }

      return {
        taskId,
        subSessionId,
        output: salvageOutput,
        ok: false,
        error: msg,
        elapsedMs: Date.now() - start,
        tokens,
        requests,
        aborted: aborted || undefined,
        abortReason: timeoutAborted ? "timeout" : (aborted ? "abort_signal" : undefined),
      };
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      // ── P2-1：清理 per-session yield 回调（fork 结束，回调不再有效）──
      if (this._setYieldHandlerFn) {
        try { this._setYieldHandlerFn(subSessionId, null); } catch { /* ignore */ }
      }
      // ── P1-4 兜底：异常退出也确保生命周期状态收敛（aborted / idle）──
      // 已在 try 末尾设置过的不会重复（setStatus 幂等）；此处覆盖 catch 路径未设置的情况。
      if (lifecycle.getStatus(subSessionId) === "running") {
        lifecycle.setStatus(subSessionId, abortController.signal.aborted ? "aborted" : "idle");
      }
      // ── P2-2 worktree 隔离回收：mergeBack / patchBack / removeWorktree ──
      if (worktreeHandle) {
        try {
          await this._reclaimWorktree(worktreeHandle, options);
        } catch (err) {
          this._log("warning", `[FORK] task=${taskId} worktree 回收失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  /**
   * P2-3 detached 后台执行包装。
   *
   * 与 fork 主流程的区别：不返回结果给调用方（fork 已返回占位），
   * 而是把最终结果通过 SUBAGENT_EVENT_BUS 的 lifecycle channel 异步上报（fork_end）。
   * 进度/事件在执行期间正常 publish（父 Agent 可订阅 progress/event channel 实时观察）。
   *
   * 实现方式：直接调 this.fork（不带 detached，避免递归），fork 内部正常走同步执行路径，
   * 结果到达后在此处 publish lifecycle: fork_end 把最终结果上报。
   * worktree 回收由 fork 内部 finally 块自动处理（options.isolated 仍生效）。
   *
   * 注意：此处 fork 会重新生成 subSessionId（同一 taskId 会得到不同 subSessionId），
   * 为了让父 Agent 能用 taskId 关联，我们把原 subSessionId 通过 options 透传
   * （SubagentExecutorOptions.subSessionIdFactory 可定制，但 detached 场景我们
   * 让 fork 用默认工厂生成新 id——后台子 Agent 的 subSessionId 与占位返回的不同。
   * 父 Agent 用 taskId 关联即可，subSessionId 仅作内部追踪）。
   */
  private async _runForkBackground(params: {
    taskId: string;
    taskDesc: string;
    options?: ForkOptions;
    parentSessionId: string;
    subSessionId: string;
    forkMode: 'context_only' | 'context_and_config';
    start: number;
    currentDepth: number;
    maxDepth: number;
    softBudget: number;
    maxRuntimeMs: number;
    subAgentName: string;
    worktreeHandle?: WorktreeHandle;
  }): Promise<void> {
    const { taskId, taskDesc, options } = params;
    // 去掉 detached 标志（避免递归），保留 isolated + 其他选项
    const forkOpts: ForkOptions = {
      ...(options ?? {}),
      detached: false,
    };

    let result: SubagentResultLike | undefined;
    try {
      result = await this.fork(taskId, taskDesc, forkOpts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._log("warning", `[FORK] task=${taskId} 后台执行异常: ${msg}`);
      SUBAGENT_EVENT_BUS.publishLifecycle({
        kind: "fork_end",
        taskId,
        subSessionId: params.subSessionId,
        ok: false,
        elapsedMs: Date.now() - params.start,
      });
      return;
    }

    // 把最终结果异步上报到 lifecycle channel
    // （fork_end 事件携带 ok + elapsedMs + requests + tokens；完整 output 通过 event channel 已透传）
    if (result) {
      SUBAGENT_EVENT_BUS.publishLifecycle({
        kind: "fork_end",
        taskId,
        subSessionId: result.subSessionId,
        ok: result.ok,
        elapsedMs: result.elapsedMs,
        requests: result.requests,
        tokens: result.tokens,
      });
      this._log("info", `[FORK] task=${taskId} 后台执行完成: ok=${result.ok} elapsed=${result.elapsedMs}ms`);
    }
  }

  /**
   * P2-2 worktree 回收：按 options.mergeBack / patchBack 决定如何处理 worktree 改动。
   *   - mergeBack=true → merge 回主分支后 removeWorktree
   *   - patchBack=true（且 mergeBack 未设）→ 生成 patch 文件后 removeWorktree
   *   - 两者都未设 → removeWorktree（改动丢弃）
   */
  private async _reclaimWorktree(
    handle: WorktreeHandle,
    options?: ForkOptions,
  ): Promise<void> {
    const runner = this._getIsolationRunner();
    const path = handle.path;

    if (options?.mergeBack) {
      const r = await runner.mergeBack(path, undefined, `isolated agent ${handle.agentName} changes`);
      this._log("info", `[ISOLATION] mergeBack: ok=${r.ok} ${r.message}`);
      // merge 后清理 worktree（分支已合并，worktree 目录可删）
      await runner.removeWorktree(path, true);
    } else if (options?.patchBack) {
      const r = await runner.patchBack(path);
      this._log("info", `[ISOLATION] patchBack: ok=${r.ok} ${r.message}${r.patchFile ? ` → ${r.patchFile}` : ""}`);
      // patch 生成后清理 worktree
      await runner.removeWorktree(path, true);
    } else {
      // 默认：直接丢弃 worktree（改动不回收）
      await runner.removeWorktree(path, true);
    }
  }

  /**
   * Fork 一层 task 并发执行（#4 真并行）。
   * 实现 SubagentExecutorLike.forkLayer 契约。
   *
   * @param tasks 同层可并行执行的 task 数组（由 TaskScheduler.selectLayer 给出）
   * @param options fork 选项（应用到本层所有 task）
   */
  async forkLayer(tasks: Array<{ id: string; desc: string }>, options?: ForkOptions): Promise<SubagentResultLike[]> {
    if (tasks.length === 0) return [];

    this._log("info", `[FORK_LAYER] 并行 fork ${tasks.length} 个子 Agent: ${tasks.map((t) => t.id).join(", ")}`);

    // 分批并发控制
    const results: SubagentResultLike[] = [];
    for (let i = 0; i < tasks.length; i += this._maxConcurrency) {
      const batch = tasks.slice(i, i + this._maxConcurrency);
      const batchResults = await Promise.all(
        batch.map((t) => this.fork(t.id, t.desc, options)),
      );
      results.push(...batchResults);
    }

    // 按 taskId 排序（保证顺序稳定）
    results.sort((a, b) => a.taskId.localeCompare(b.taskId));
    return results;
  }

  /**
   * 把子 Agent 结果格式化为 tool_result 文本（合并回主 session）。
   * 含 P1-2/P1-7 的 aborted/salvage 信息。
   */
  static formatResultsAsToolResult(results: SubagentResultLike[]): string {
    if (results.length === 0) return "(无并行子 Agent 结果)";
    const lines: string[] = [`⚡ 并行子 Agent 执行结果（${results.length} 个）:`];
    for (const r of results) {
      const status = r.ok ? "✓" : (r.aborted ? "⊘" : "✗");
      const output = r.ok ? r.output : (r.aborted && r.output ? r.output : `失败: ${r.error}`);
      const snippet = output.length > 500 ? output.slice(0, 500) + "…(截断)" : output;
      const meta = [
        `${r.elapsedMs}ms`,
        r.requests != null ? `${r.requests} req` : null,
        r.tokens != null ? `${r.tokens} tok` : null,
        r.aborted ? `aborted(${r.abortReason ?? "?"})` : null,
      ].filter(Boolean).join(", ");
      lines.push(`\n${status} [${r.taskId}] (${meta}, sub=${r.subSessionId})`);
      lines.push(snippet);
    }
    return lines.join("\n");
  }
}

/** 默认子 sessionId 工厂：parent + taskId + 时间戳后 6 位 */
function defaultSubSessionIdFactory(parentSessionId: string, taskId: string): string {
  const ts = Date.now().toString(36).slice(-6);
  const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${parentSessionId}::fork::${safeTaskId}::${ts}`;
}

/**
 * 校验子 Agent yield 提交的 result 是否符合 outputSchema（P2-1）。
 *
 * 轻量级 JSON Schema 校验器——不引入 ajv 依赖，只覆盖常用子集：
 *   - type（object/string/number/boolean/array/null）
 *   - required
 *   - properties（递归校验每个属性）
 *   - additionalProperties（false 时拒绝未声明的属性）
 *   - items（数组元素 schema）
 *   - enum
 *
 * 校验流程：
 *   1. result 是字符串 → 尝试 JSON.parse；解析失败 → 校验失败（要求重新产出合法 JSON）
 *   2. result 已是对象（理论上不会，yield 工具收的是字符串）→ 直接校验
 *   3. 用 schema 校验解析后的值
 *
 * @returns { ok: true } 或 { ok: false, error: string }
 */
function validateYieldResult(
  result: string,
  schema: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  // 1. 尝试解析 JSON
  let value: unknown;
  try {
    value = JSON.parse(result);
  } catch (e) {
    const parseErr = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: `结果不是合法 JSON（无法解析：${parseErr.slice(0, 150)}）。outputSchema 要求 JSON 输出，请产出合法 JSON 字符串后再次 yield。`,
    };
  }

  // 2. 用 schema 校验
  const errors: string[] = [];
  validateValue(value, schema, "$", errors);
  if (errors.length > 0) {
    return { ok: false, error: errors.join("; ") };
  }
  return { ok: true };
}

/**
 * 递归校验单个值是否符合 schema（validateYieldResult 的内部实现）。
 * 覆盖 JSON Schema 子集：type / required / properties / additionalProperties / items / enum。
 */
function validateValue(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  const type = schema["type"] as string | undefined;
  if (type) {
    if (!matchesType(value, type)) {
      errors.push(`${path}: 期望 type=${type}，实际 ${actualType(value)}`);
      return; // 类型不符，后续校验无意义
    }
  }

  // enum
  const enumValues = schema["enum"];
  if (Array.isArray(enumValues)) {
    if (!enumValues.some((v) => deepEqual(v, value))) {
      errors.push(`${path}: 值不在 enum [${enumValues.map((v) => JSON.stringify(v)).join(", ")}] 中`);
    }
  }

  // object: properties / required / additionalProperties
  if (type === "object" && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const properties = schema["properties"] as Record<string, Record<string, unknown>> | undefined;
    const required = schema["required"] as string[] | undefined;

    // required
    if (Array.isArray(required)) {
      for (const key of required) {
        if (!(key in obj)) {
          errors.push(`${path}: 缺少必填属性 "${key}"`);
        }
      }
    }

    // properties（递归）
    if (properties) {
      for (const [key, subSchema] of Object.entries(properties)) {
        if (key in obj) {
          validateValue(obj[key], subSchema, `${path}.${key}`, errors);
        }
      }
    }

    // additionalProperties: false → 拒绝未声明属性
    const additional = schema["additionalProperties"];
    if (additional === false && properties) {
      for (const key of Object.keys(obj)) {
        if (!(key in properties)) {
          errors.push(`${path}: 存在未声明的属性 "${key}"（additionalProperties=false）`);
        }
      }
    }
  }

  // array: items
  if (type === "array" && Array.isArray(value)) {
    const items = schema["items"] as Record<string, unknown> | undefined;
    if (items) {
      for (let i = 0; i < value.length; i++) {
        validateValue(value[i], items, `${path}[${i}]`, errors);
      }
    }
  }
}

/** 判断值是否匹配 JSON Schema type */
function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && !Number.isNaN(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "object": return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "null": return value === null;
    default: return true; // 未知 type 不校验
  }
}

/** 返回值的实际类型名（错误信息用） */
function actualType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** 深度相等（enum 校验用，处理基本类型 + 数组/对象） */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}
