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

import { PromptCompiler } from "./prompt-compiler.js";
import { SessionStore, SessionManager, MemoryStore, CheckpointStore, extractMemories } from "@little-house-studio/context";
import {
  buildMessages,
  maybeCompress,
  MAX_ROUNDS,
  DEFAULT_AGENT_ROUND_LIMIT,
  DEFAULT_LOOP_THRESHOLD,
} from "@little-house-studio/context";
import { compileDynamicContext } from "../dynamic-context.js";
import { TokenTracker } from "./token-tracker.js";
import type { TokenUsage } from "./token-tracker.js";
import { AgentRegistry, initMainAgent } from "./registry.js";
import { ModelCaller, type ModelCallResult, type CallerStreamEvent } from "@little-house-studio/llm";
import type { LLMToolCall, APIPreset } from "@little-house-studio/llm";
import { ToolExecutor } from "@little-house-studio/tools";
import type { ToolRegistry } from "@little-house-studio/tools";
import { TERMINAL_REGISTRY } from "@little-house-studio/tools";
import type { StreamEvent } from "@little-house-studio/types";
import { deriveJsonSettings } from "@little-house-studio/llm";
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
  /** 压缩回调（由外部注入，用于压缩区落盘） */
  onCompress?: (sessionId: string, stage: string, summary: string, taskBlocks: string[]) => void;

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

    // 初始化上下文管理层
    this.sessionManager = new SessionManager(this.sessions, this.maouRoot);
    this.sessionManager.loadState();
    this.checkpointStore = new CheckpointStore(this.sessions);
  }

  /**
   * 核心运行循环 —— 异步生成器，yield 流式事件。
   */
  async *run(
    sessionId: string | null | undefined,
    userMessage: string,
    options: RunOptions,
  ): AsyncGenerator<StreamEvent> {
    // ── 1. 确保 session 存在 ──
    const session = this.sessions.ensure(sessionId ?? undefined);
    sessionId = session.id;
    this.log("info", `[RUN] start session=${sessionId} msg_len=${userMessage.length}`);

    const agentName = session.agentName || "main";
    const maouRoot = this.maouRoot;
    initMainAgent(maouRoot);

    // ── 从 agent.json 读取 round_limit ──
    let effectiveRoundLimit = this.agentRoundLimit;
    try {
      const registry = new AgentRegistry(maouRoot, this.projectRoot);
      const agentEntry = registry.get(agentName);
      if (agentEntry && typeof agentEntry.round_limit === "number" && agentEntry.round_limit > 0) {
        effectiveRoundLimit = agentEntry.round_limit;
        this.log("info", `[RUN] agent=${agentName} round_limit=${effectiveRoundLimit}`);
      }
    } catch {
      // 读取失败使用默认值
    }

    // ── 1a. 清理 session-scoped 条目 ──
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
      const termCleaned = TERMINAL_REGISTRY.cleanupAgent(agentName);
      if (termCleaned > 0) {
        this.log("info", `[CLEANUP] ${termCleaned} 个常驻终端已终止并释放`);
      }
    } catch (err) {
      this.log("warning", `[CLEANUP] 终端清理失败: ${err}`);
    }

    // ── 1b. 沙箱快照 ──
    this.snapshotBeforeRun(maouRoot);

    // yield session 事件
    yield this.event("session", { sessionId });

    // ── 2. 编译 prompt ──
    yield this.event("status", { text: "编译 Prompt..." });
    yield this.logEvent("info", "开始编译 Prompt");

    let systemPrompt: string;
    try {
      systemPrompt = this.compiler.compile();
    } catch (err) {
      systemPrompt = `[Prompt 编译失败: ${err}]`;
      this.log("warning", `Prompt 编译失败: ${err}`);
    }
    yield this.logEvent("info", `Prompt 编译完成，长度=${systemPrompt.length}`);

    // ── 2a. 编译 BEFORE_USER.md ──
    let beforeUserContent = "";
    try {
      beforeUserContent = this.compiler.compile("BEFORE_USER.md");
      yield this.logEvent("info", `BEFORE_USER 编译完成，长度=${beforeUserContent.length}`);
    } catch {
      // BEFORE_USER.md 可能不存在，静默跳过
    }

    // ── 2b. 编译动态注入内容（board / pending / agents 状态） ──
    const dynamicInjections = compileDynamicContext(maouRoot, agentName);

    // ── 2c. 加载 OUTPUT.jsonc 派生 jsonSettings（用于 response_format 强制 JSON 输出） ──
    let outputJsonSettings: Record<string, unknown> | null = null;
    try {
      const outputFile = join(this.compiler.promptRoot, "OUTPUT.jsonc");
      if (existsSync(outputFile)) {
        const outputText = readFileSync(outputFile, "utf-8");
        outputJsonSettings = deriveJsonSettings(outputText) as unknown as Record<string, unknown>;
        yield this.logEvent("info", "OUTPUT.jsonc 已加载，启用 JSON 结构化输出");
      }
    } catch (err) {
      yield this.logEvent("warning", `OUTPUT.jsonc 加载失败: ${err}`);
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
    // 合并白名单：PERMISSION.jsonc ∩ agent.json tools
    let toolWhitelist: Set<string> | undefined;
    try {
      const permFile = join(this.compiler.promptRoot, "PERMISSION.jsonc");
      if (existsSync(permFile)) {
        const perm = JSON.parse(readFileSync(permFile, "utf-8"));
        if (Array.isArray(perm.tool_whitelist)) {
          toolWhitelist = new Set(perm.tool_whitelist);
        }
      }
    } catch { /* ignore */ }

    // agent.json tools 白名单（与 PERMISSION 取交集）
    try {
      const registry = new AgentRegistry(maouRoot, this.projectRoot);
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

    // ── 将用户消息写入 session（供后续请求回溯历史） ──
    this.sessions.appendMessage(sessionId!, "user", userMessage);

    // ── 3. Agent 循环 ──
    let roundCount = 0;
    const maxRounds = effectiveRoundLimit > 0 ? effectiveRoundLimit : MAX_ROUNDS;
    const notifiedBgCompletions = new Set<string>();

    while (roundCount < maxRounds) {
      // 检查中断信号
      if (options.abortSignal?.aborted) {
        this.log("info", `[RUN] session=${sessionId} 收到中断信号，停止循环`);
        yield this.event("info", { message: "已中断" });
        break;
      }

      this.log("info", `[RUN] round ${roundCount + 1} start`);

      // ── 3a-pre. 注入后台终端完成/超时通知 ──
      {
        const bgTerminals = TERMINAL_REGISTRY.list(agentName);
        for (const t of bgTerminals) {
          if (notifiedBgCompletions.has(t.id)) continue;
          if (t.state === "running" && !t.timedOut) continue;
          if (t.state === "interrupted") continue;

          notifiedBgCompletions.add(t.id);
          const output = t.tailChars(2000);
          const status =
            t.timedOut ? "超时" :
            t.exitCode === 0 ? "已完成" :
            `已失败(退出码${t.exitCode})`;
          const content =
            `<terminal-message>\n` +
            `终端「${t.description}」(ID: ${t.id}) ${status}。\n` +
            (output ? `\n输出:\n${output}\n` : "") +
            `</terminal-message>`;
          this.sessions.appendMessage(sessionId!, "user", content, {
            source: "terminal-notification",
            terminal_id: t.id,
          });
          TERMINAL_REGISTRY.persist();
        }
      }

      // 重新加载 session
      const currentSession = this.sessions.load(sessionId!) ?? session;
      const sessionMessages = currentSession.messages;
      const currentRound = roundCount + 1;

      // ── 3a-pre2. 每轮刷新动态注入（board / pending / agent 状态） ──
      // 首轮编译一次后持续复用，后续轮次只刷新动态部分，避免重复编译 BEFORE_USER.md
      const currentDynamicInjections =
        roundCount === 0 ? dynamicInjections : compileDynamicContext(maouRoot, agentName);

      // ── 3a. 构建消息数组 ──
      const memoryStore = new MemoryStore(this.maouRoot, agentName);
      const memoryResult = memoryStore.recall(userMessage, 5);

      const messages = buildMessages({
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
      });

      // 自动压缩检查
      // 上下文压缩阈值应基于输入上下文上限（maxContext），而非输出上限（maxTokens）。
      // 优先 maxContext，回退 maxTokens（兼容旧 preset），最后 65536 兜底。
      const contextLimit = preset.maxContext ?? preset.maxTokens ?? 65536;

      // 压缩前自动快照
      if (this.checkpointStore.shouldAutoCheckpoint("compression")) {
        this.checkpointStore.createCheckpoint(
          sessionId!,
          `auto_before_compression_round_${currentRound}`,
          true,
          "compression",
        );
      }

      const compressResult = maybeCompress(messages, contextLimit);
      const finalMessages = compressResult.messages;
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
      }

      yield this.event("agent_round", { round: currentRound, agentMode });
      yield this.logEvent("info", `开始第 ${currentRound} 轮`);
      yield this.event("status", { text: "调用模型..." });
      yield this.logEvent("info", `调用模型: ${preset.model}`);

      // ── 3b. 调用 LLM（流式） ──
      let result: ModelCallResult;
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
          abortSignal: options.abortSignal,
        });

        let iterResult = await callGen.next();
        while (!iterResult.done) {
          // yield 每个流式事件（assistant_delta 等）
          const streamEvent = iterResult.value as CallerStreamEvent;
          yield {
            type: streamEvent.type,
            ...streamEvent.data,
          };
          iterResult = await callGen.next();
        }
        result = iterResult.value;
      } catch (err) {
        this.log("warning", `[RUN] model call failed: ${err}`);
        result = this.errorCallResult(String(err));
      }

      // 保存原始响应
      this.sessions.setLastRawResponse(sessionId!, result.rawResponse);
      yield this.event("raw_response", { content: result.rawResponse });

      // 记录 token 用量
      if (result.usage) {
        const tokenUsage = result.usage as unknown as TokenUsage;
        yield { type: "model.usage", usage: tokenUsage } as unknown as StreamEvent;
        try {
          const tracker = new TokenTracker(maouRoot, agentName, preset as unknown as Record<string, unknown>);
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
        usage: result.usage,
        nativeToolCalls: result.nativeToolCalls.length > 0 ? result.nativeToolCalls : undefined,
        timing: result.timing,
      });

      // ── 3d/3e. 处理工具调用 ──
      if (result.nativeToolCalls.length > 0 && agentMode) {
        yield this.logEvent("info", `检测到 ${result.nativeToolCalls.length} 个工具调用`);

        const shouldContinue = yield* this.processToolCalls(
          sessionId!,
          currentRound,
          result.nativeToolCalls,
          sandboxMode,
          agentName,
        );

        if (shouldContinue) {
          roundCount++;
          continue;
        }
      }

      // 无工具调用 → 退出循环
      break;
    }

    // ── 4. 完成 ──
    if (effectiveRoundLimit > 0 && roundCount >= effectiveRoundLimit) {
      yield this.event("round_limit", {
        message: `已达到最大轮次限制 (${effectiveRoundLimit})`,
      });
    }

    // ── 5. 后处理：提取记忆 + 持久化摘要 ──
    try {
      const finalSession = this.sessions.load(sessionId!);
      if (finalSession && finalSession.messages.length > 0) {
        // 提取结构化记忆
        const memories = extractMemories(finalSession.messages);
        if (memories.length > 0) {
          const memStore = new MemoryStore(this.maouRoot, agentName);
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
    }

    yield this.event("done", {
      sessionId,
      rounds: roundCount,
    });
    this.log("info", `[RUN] main loop finished, rounds=${roundCount}`);
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
      projectRoot: this.projectRoot,
      promptRoot: this.compiler.promptRoot,
      sandboxRoot: join(this.maouRoot, 'sandbox', sessionId),
      sandboxMode,
      agentName,
      agentMode: "execute",
      pluginSettings: {},
      workingDir: this.projectRoot,
    };

    for (const toolCall of toolCalls) {
      // 落盘 tool_call 原始条目（供前端 /rawdata/:round 调试面板按 type:'tool_call' 过滤）
      this.sessions.appendRawEntry(sessionId, {
        type: "tool_call",
        round,
        created_at: new Date().toISOString(),
        data: {
          name: toolCall.name,
          parameters: toolCall.parameters,
          id: toolCall.id,
          provider: toolCall.provider,
          tool_type: toolCall.type,
        },
      });

      yield this.event("tool_call", {
        tool: { id: toolCall.id, name: toolCall.name, parameters: toolCall.parameters, provider: toolCall.provider, type: toolCall.type },
        round,
      });
      yield this.logEvent("info", `执行工具: ${toolCall.name}`);

      try {
        const result = await this.toolExecutor.executeSingle(
          {
            id: toolCall.id,
            name: toolCall.name,
            parameters: toolCall.parameters,
          },
          context,
        );

        const toolResultContent = result.result.message ?? JSON.stringify(result.result);
        const toolImages = result.result.images;

        // 落盘 tool_result 原始条目（供前端按 type:'tool_result' 过滤；字段名 tool_name 对齐前端 ChatApp.jsx:53）
        this.sessions.appendRawEntry(sessionId, {
          type: "tool_result",
          round,
          created_at: new Date().toISOString(),
          data: {
            tool_name: toolCall.name,
            tool_call_id: toolCall.id,
            content: toolResultContent,
            ok: result.result.ok,
          },
        });

        yield this.event("tool_result", {
          toolCallId: toolCall.id,
          name: toolCall.name,
          content: toolResultContent,
          ok: result.result.ok,
          round,
        });
        yield this.logEvent("info", `工具 ${toolCall.name} 完成: ok=${result.result.ok}`);

        // 追加 tool 结果到 session（含图片数据供多模态 LLM 使用）
        const toolMeta: Record<string, unknown> = {
          round,
          toolCallId: toolCall.id,
          tool_name: toolCall.name,
          tool_provider: toolCall.provider,
          tool_type: toolCall.type,
          tool_parameters: toolCall.parameters,
        };
        if (toolImages && toolImages.length > 0) {
          toolMeta.images = toolImages;
        }
        this.sessions.appendMessage(sessionId, "tool", toolResultContent, toolMeta);
      } catch (err) {
        const errorMsg = `工具执行失败: ${err}`;

        // 失败也落盘 tool_result
        this.sessions.appendRawEntry(sessionId, {
          type: "tool_result",
          round,
          created_at: new Date().toISOString(),
          data: {
            tool_name: toolCall.name,
            tool_call_id: toolCall.id,
            content: errorMsg,
            ok: false,
          },
        });

        yield this.event("tool_result", {
          toolCallId: toolCall.id,
          name: toolCall.name,
          content: errorMsg,
          ok: false,
          round,
        });
        this.sessions.appendMessage(sessionId, "tool", errorMsg, {
          round,
          toolCallId: toolCall.id,
          tool_name: toolCall.name,
          tool_provider: toolCall.provider,
          tool_type: toolCall.type,
          tool_parameters: toolCall.parameters,
        });
      }
    }

    return true; // 有工具调用，继续循环
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
