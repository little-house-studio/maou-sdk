/**
 * 消息队列系统 —— 处理 agent 运行期间到达的用户消息排队与投递。
 *
 * 5 种排队模式（DESIGN.md L42-45）：
 *   - after_task_complete：等整个 task 表完成后再投递（默认最保守）
 *   - after_loop_complete：等当前 agent.run() 返回后投递
 *   - after_round_complete：等当前 round 完成后投递
 *   - interrupt_immediately：立刻打断当前流，新消息下个 round 优先处理
 *   - interrupt_stop：立刻打断并停止本次 run，新消息等下次 run
 *
 * 安全约束：
 *   - 防止消息插入到 tool_call 和 tool_result 之间（OpenAI/Anthropic 硬性约束）。
 *     若 session 末尾是 assistant(tool_calls) 缺对应 tool_result，
 *     须先补占位 tool_result（由 SessionStore.injectPendingToolInterrupts 完成）再插入 user 消息。
 *   - 防止 tool_call 无 tool_result（已在 context 层 repairOrphanedToolCalls 兜底）。
 */

import type { SessionStore } from "@little-house-studio/context";

/** 5 种排队模式 */
export type MessageQueueMode =
  | "after_task_complete"
  | "after_loop_complete"
  | "after_round_complete"
  | "interrupt_immediately"
  | "interrupt_stop";

/** 投递时机点（runtime 在这些点检查队列） */
export type DeliveryPhase =
  | "round_end" // 一轮 LLM+工具调用结束
  | "loop_end" // 整个 agent.run() 退出前
  | "task_complete"; // task 表全部完成

export interface EnqueueOptions {
  /** 该条消息的投递模式（缺省走会话默认模式） */
  mode?: MessageQueueMode;
  /** 消息来源标记（hook / user / plugin / feishu 等） */
  source?: string;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
}

export interface QueuedMessage {
  /** 单调递增 ID，用于追踪 */
  id: number;
  message: string;
  mode: MessageQueueMode;
  source: string;
  metadata: Record<string, unknown>;
  enqueuedAt: number;
}

export interface DeliveryDecision {
  /** 是否立即投递 */
  deliver: boolean;
  /** 不投递的原因（用于日志） */
  reason?: string;
  /** 是否需要打断当前流（interrupt 模式触发） */
  shouldAbort: boolean;
  /** 是否需要补占位 tool_result（防中间插入） */
  needsToolResultPatch: boolean;
  /** 是否需要停止整个 run（interrupt_stop） */
  shouldStopRun: boolean;
}

/** 各模式在 phase 下是否可投递 */
const PHASE_DELIVERY_MAP: Record<MessageQueueMode, DeliveryPhase[]> = {
  after_task_complete: ["task_complete", "loop_end"], // task 完成或 run 自然结束时投递
  after_loop_complete: ["loop_end"],
  after_round_complete: ["round_end", "loop_end"],
  // interrupt 模式不依赖 phase，由 enqueue 当场触发
  interrupt_immediately: [],
  interrupt_stop: [],
};

export interface MessageQueueOptions {
  /** per-session 默认模式 */
  defaultMode?: MessageQueueMode;
  /** 单 session 队列上限（防内存膨胀） */
  maxQueuePerSession?: number;
  /**
   * interrupt 模式触发时的回调（由 runtime 注入为 abortCurrentRun）。
   * - interrupt_immediately：调此回调 abort 当前流，让下个 round 看到新消息
   * - interrupt_stop：调此回调 abort，并要求 run 退出
   * 若未注入，interrupt 模式只返回 shouldAbort=true，由调用方自行 abort。
   */
  onInterrupt?: (sessionId: string, mode: "interrupt_immediately" | "interrupt_stop") => void;
}

const DEFAULT_MAX_QUEUE = 64;

/**
 * MessageQueue —— per-session 用户消息队列。
 *
 * 设计要点：
 * 1. enqueue 同步入队，返回队列 ID。
 * 2. interrupt 模式 enqueue 时立刻返回 shouldAbort=true / shouldStopRun=true，
 *    runtime 立即触发 abortSignal.abort()，下个 round 退出后 dequeueIfReady 取出消息。
 * 3. dequeueIfReady 在 phase 点调用，按 FIFO 顺序投递可发送的消息。
 * 4. canDeliverSafely 检查 tool_call/tool_result 配对，未配对则先补占位再投递。
 */
export class MessageQueue {
  private queues = new Map<string, QueuedMessage[]>();
  private defaultModes = new Map<string, MessageQueueMode>();
  private seq = 0;
  private defaultMode: MessageQueueMode;
  private maxQueuePerSession: number;
  private onInterrupt?: (sessionId: string, mode: "interrupt_immediately" | "interrupt_stop") => void;

  constructor(opts: MessageQueueOptions = {}) {
    this.defaultMode = opts.defaultMode ?? "after_loop_complete";
    this.maxQueuePerSession = opts.maxQueuePerSession ?? DEFAULT_MAX_QUEUE;
    this.onInterrupt = opts.onInterrupt;
  }

  /** 注入 interrupt 回调（runtime 在装配 messageQueue 时调用） */
  setOnInterrupt(cb: (sessionId: string, mode: "interrupt_immediately" | "interrupt_stop") => void): void {
    this.onInterrupt = cb;
  }

  /** 设置某 session 的默认投递模式 */
  setDefaultMode(sessionId: string, mode: MessageQueueMode): void {
    this.defaultModes.set(sessionId, mode);
  }

  getDefaultMode(sessionId: string): MessageQueueMode {
    return this.defaultModes.get(sessionId) ?? this.defaultMode;
  }

  /**
   * 入队一条用户消息。
   *
   * 返回该条消息的决策：
   * - interrupt 模式：shouldAbort=true，runtime 立刻 abort 当前流；
   *   shouldStopRun=true（interrupt_stop）则要求本次 run 整体退出。
   * - 队列模式：deliver=false，shouldAbort=false，等待 phase 点 dequeueIfReady。
   */
  enqueue(
    sessionId: string,
    message: string,
    opts: EnqueueOptions = {},
  ): { id: number; decision: DeliveryDecision } {
    const mode = opts.mode ?? this.getDefaultMode(sessionId);
    const queue = this.queues.get(sessionId) ?? [];

    if (queue.length >= this.maxQueuePerSession) {
      // 队列满：丢弃最旧的一条（保留新消息）
      queue.shift();
    }

    const entry: QueuedMessage = {
      id: ++this.seq,
      message,
      mode,
      source: opts.source ?? "user",
      metadata: opts.metadata ?? {},
      enqueuedAt: Date.now(),
    };
    queue.push(entry);
    this.queues.set(sessionId, queue);

    const decision = this.evaluateDecision(mode);

    // interrupt 模式：立即触发 onInterrupt 回调（runtime 注入的 abortCurrentRun）
    // 这样调用方只需调 messageQueue.enqueue，runtime 自动 abort，无需调用方再判断 decision.shouldAbort
    if (decision.shouldAbort && this.onInterrupt) {
      try {
        this.onInterrupt(
          sessionId,
          decision.shouldStopRun ? "interrupt_stop" : "interrupt_immediately",
        );
      } catch {
        // 回调失败不应影响入队本身
      }
    }

    return { id: entry.id, decision };
  }

  /** 根据模式计算决策（不入队，仅评估） */
  private evaluateDecision(mode: MessageQueueMode): DeliveryDecision {
    switch (mode) {
      case "interrupt_immediately":
        return {
          deliver: false,
          reason: "interrupt_immediately：已入队，等待 runtime abort 后下个 round 取出",
          shouldAbort: true,
          shouldStopRun: false,
          needsToolResultPatch: true,
        };
      case "interrupt_stop":
        return {
          deliver: false,
          reason: "interrupt_stop：已入队，要求本次 run 退出后投递",
          shouldAbort: true,
          shouldStopRun: true,
          needsToolResultPatch: true,
        };
      default:
        // 三种队列模式：等待 phase 点
        return {
          deliver: false,
          reason: `${mode}：等待对应 phase 点投递`,
          shouldAbort: false,
          shouldStopRun: false,
          needsToolResultPatch: false,
        };
    }
  }

  /**
   * 在 phase 点检查队列，返回可投递的消息列表。
   *
   * 投递条件：
   * - 消息模式允许在该 phase 投递
   * - interrupt 模式的消息：只在 abort 已触发 + 当前 run 已退出时投递
   *
   * 投递后从队列移除。
   */
  dequeueIfReady(
    sessionId: string,
    phase: DeliveryPhase,
    options: {
      /** interrupt 模式的消息是否可投递（要求 run 已退出 / abort 已触发） */
      runExited?: boolean;
      /** 当前 run 是否已被 abort（用于 interrupt_immediately：abort 后即可投递，不必等 run 退出） */
      aborted?: boolean;
      /** 是否所有 task 已完成（task_complete phase 的判定依据） */
      allTasksComplete?: boolean;
    } = {},
  ): QueuedMessage[] {
    const queue = this.queues.get(sessionId);
    if (!queue || queue.length === 0) return [];

    const ready: QueuedMessage[] = [];
    const remaining: QueuedMessage[] = [];

    for (const msg of queue) {
      const phases = PHASE_DELIVERY_MAP[msg.mode];

      // interrupt 模式投递条件：
      // - interrupt_immediately：abort 已触发即可（不要求 run 退出，下个 round 立刻处理）
      // - interrupt_stop：必须 runExited（要求 run 整体退出后投递）
      if (msg.mode === "interrupt_immediately") {
        if (options.aborted || options.runExited) {
          ready.push(msg);
        } else {
          remaining.push(msg);
        }
        continue;
      }
      if (msg.mode === "interrupt_stop") {
        if (options.runExited) {
          ready.push(msg);
        } else {
          remaining.push(msg);
        }
        continue;
      }

      // after_task_complete：要求 allTasksComplete 或 loop_end
      if (msg.mode === "after_task_complete") {
        if (phase === "loop_end" || (phase === "task_complete" && options.allTasksComplete)) {
          ready.push(msg);
        } else {
          remaining.push(msg);
        }
        continue;
      }

      // 通用：检查 phase 是否在允许列表
      if (phases.includes(phase)) {
        ready.push(msg);
      } else {
        remaining.push(msg);
      }
    }

    if (ready.length > 0) {
      if (remaining.length === 0) {
        this.queues.delete(sessionId);
      } else {
        this.queues.set(sessionId, remaining);
      }
    }

    return ready;
  }

  /**
   * 检查是否可安全投递到 session（防 tool_call / tool_result 中间插入）。
   *
   * 规则：若 session 末尾消息是 assistant(role=assistant) 且含 tool_calls，
   * 但后面没有对应的 tool_result 消息，则不能直接插入 user 消息——
   * 必须先补占位 tool_result（调用 sessions.injectPendingToolInterrupts）。
   *
   * @returns true 可直接投递；false 需先补占位
   */
  canDeliverSafely(sessionMessages: Array<Record<string, unknown>>): boolean {
    if (sessionMessages.length === 0) return true;
    const last = sessionMessages[sessionMessages.length - 1];
    if (!last) return true;

    // 末尾不是 assistant 或没有 tool_calls → 安全
    if (last.role !== "assistant") return true;
    const toolCalls = last.toolCalls ?? last.tool_calls;
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return true;

    // 末尾是 assistant(tool_calls)：检查每个 tool_call 是否都有对应 tool_result
    const callIds = new Set(
      (toolCalls as Array<{ id?: string }>)
        .map((tc) => tc.id)
        .filter((id): id is string => Boolean(id)),
    );
    if (callIds.size === 0) return true;

    // 反向扫描：只要 tool_call_id 在 callIds 中即视为已配对
    for (let i = sessionMessages.length - 2; i >= 0; i--) {
      const m = sessionMessages[i];
      if (!m) continue;
      if (m.role === "tool") {
        const tid = String(m.toolCallId ?? m.tool_call_id ?? "");
        if (tid) callIds.delete(tid);
      } else if (m.role === "assistant") {
        // 遇到上一条 assistant(tool_calls)：之后的 tool_result 都属于本批
        break;
      }
    }

    return callIds.size === 0;
  }

  /**
   * 投递一条消息到 session，自动处理 tool_result 补位。
   *
   * 返回实际投递的消息数（0 / 1）。
   */
  deliver(
    sessionId: string,
    msg: QueuedMessage,
    sessions: SessionStore,
  ): { delivered: boolean; patchedToolResults: number; reason?: string } {
    const session = sessions.load(sessionId);
    if (!session) {
      return { delivered: false, patchedToolResults: 0, reason: "session 不存在" };
    }

    const sessionMessages = (session.messages ?? []) as unknown as Array<Record<string, unknown>>;

    // 安全检查：若末尾是孤立 tool_call，先补占位 tool_result
    let patched = 0;
    if (!this.canDeliverSafely(sessionMessages)) {
      try {
        const ok = sessions.injectPendingToolInterrupts(sessionId);
        if (ok) patched = 1;
      } catch {
        // 补位失败：仍尝试投递（让 repairOrphanedToolCalls 兜底）
      }
    }

    // 追加 user 消息
    sessions.appendMessage(sessionId, "user", msg.message, {
      source: msg.source,
      queued: true,
      queue_id: msg.id,
      queue_mode: msg.mode,
      enqueued_at: msg.enqueuedAt,
      delivered_at: Date.now(),
      ...msg.metadata,
    });

    return { delivered: true, patchedToolResults: patched };
  }

  /** 查询队列大小 */
  size(sessionId: string): number {
    return this.queues.get(sessionId)?.length ?? 0;
  }

  /** 窥视队首（不移除） */
  peek(sessionId: string): QueuedMessage | null {
    const queue = this.queues.get(sessionId);
    return queue && queue.length > 0 ? queue[0]! : null;
  }

  /** 清空指定 session 的队列 */
  clear(sessionId: string): void {
    this.queues.delete(sessionId);
  }

  /** 列出所有有待处理消息的 session */
  activeSessions(): string[] {
    return Array.from(this.queues.keys()).filter((sid) => (this.queues.get(sid)?.length ?? 0) > 0);
  }
}

/** 全局单例（harness / runtime 共享） */
export const MESSAGE_QUEUE = new MessageQueue();
