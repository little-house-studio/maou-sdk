/**
 * MessageBus — 进程内全局消息总线（IRC 式 agent 间通信）。
 *
 * 设计要点（参考 oh-my-pi IrcBus，但简化为纯 mailbox 语义）：
 *   - 进程全局单例（`MessageBus.global()`），所有 agent 共享。
 *   - `send(to, body)` 非阻塞：消息直接入目标 agent 的 mailbox，
 *     若目标 agent 正在 `wait` 则直接交付给等待者。
 *   - `wait(from)` 阻塞直到收到来自 `from`（或任意）的消息，可超时。
 *   - `inbox(agentName)` 排空（或 peek）目标 mailbox。
 *   - `broadcast(body)` 给所有已注册 mailbox 的 agent 广播（不含发送者自己，
 *     发送者通过广播回执感知；若需送达自己可显式 send）。
 *
 * 不照搬 oh-my-pi 的「唤醒 parked agent / 注入 session aside」机制——
 * 那依赖 AgentRegistry + AgentLifecycleManager 的强耦合，本总线只做 mailbox，
 * 上层（runtime/lifecycle）可在收到消息后自行决定是否唤醒 agent。
 *
 * 线程模型：单进程 Node 事件循环，无锁；waiter 通过 Promise.withResolvers 实现。
 */

import { randomUUID } from "node:crypto";

// ─── 类型 ──────────────────────────────────────────────────────────────────

/** 总线消息（不可变记录）。 */
export interface BusMessage {
  /** 消息 id（UUID）。 */
  id: string;
  /** 发送方 agent 名。 */
  from: string;
  /** 接收方 agent 名（broadcast 时为 `"*"`）。 */
  to: string;
  /** 消息体（自然语言 / JSON 字符串）。 */
  body: string;
  /** 时间戳（ms）。 */
  ts: number;
  /** 本消息所回复的消息 id（可选）。 */
  replyTo?: string;
}

/** `send` 的回执：描述消息如何到达目标。 */
export interface DeliveryReceipt {
  to: string;
  /** delivered=直接交付等待者 / buffered=入 mailbox / failed=未知目标。 */
  outcome: "delivered" | "buffered" | "failed";
  error?: string;
}

/** `send` 的可选参数。 */
export interface SendOptions {
  /** 本消息回复的消息 id（填入 BusMessage.replyTo）。 */
  replyTo?: string;
}

/** `wait` 的过滤器。 */
export interface WaitFilter {
  /** 仅接受来自该 agent 的消息；缺省=任意来源。 */
  from?: string;
}

interface Waiter {
  from?: string;
  resolve: (msg: BusMessage) => void;
}

/** 单个 mailbox 的容量上限；超出丢弃最旧消息。 */
const MAILBOX_CAP = 100;

// ─── 内部辅助 ─────────────────────────────────────────────────────────────

/**
 * Promise.withResolvers 的 ES2022 兼容实现（tsconfig lib=ES2022）。
 * 返回 { promise, resolve, reject } 三元组，语义等同 Promise.withResolvers。
 */
function newPromiseWithResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ─── MessageBus ─────────────────────────────────────────────────────────────

/**
 * 进程全局消息总线。
 *
 * 使用 `MessageBus.global()` 获取单例。测试可用 `MessageBus.resetGlobalForTests()`
 * 重置。也可直接 `new MessageBus()` 创建隔离实例（用于测试 / 多实例场景）。
 */
export class MessageBus {
  static #global: MessageBus | undefined;

  /** 获取进程全局单例。 */
  static global(): MessageBus {
    if (!MessageBus.#global) {
      MessageBus.#global = new MessageBus();
    }
    return MessageBus.#global;
  }

  /** 重置全局单例。仅供测试。 */
  static resetGlobalForTests(): void {
    MessageBus.#global = undefined;
  }

  /** 每个 agent 的 mailbox（按到达顺序）。 */
  readonly #mailboxes = new Map<string, BusMessage[]>();
  /** 每个 agent 的等待者队列（FIFO）。 */
  readonly #waiters = new Map<string, Waiter[]>();
  /** 所有曾经出现过的 agent 名（用于 broadcast 收件人枚举）。 */
  readonly #knownAgents = new Set<string>();

  /**
   * 发送一条消息到目标 agent。非阻塞。
   *
   * - 若目标 agent 正在 `wait`，消息直接交付给最早匹配的等待者（不入 mailbox）。
   * - 否则入目标 mailbox，待目标 agent 之后 `wait` / `inbox` 时取走。
   * - 未知目标（从未出现过的 agent 名）也 buffer——允许向尚未注册的 agent 预投递。
   *   若希望严格拒绝未知目标，调用方可在 send 前自行查询。
   */
  send(to: string, body: string, from: string, opts?: SendOptions): DeliveryReceipt {
    if (!to || !from) {
      return { to, outcome: "failed", error: "send: `to` and `from` are required." };
    }
    const message: BusMessage = {
      id: randomUUID(),
      from,
      to,
      body,
      ts: Date.now(),
      replyTo: opts?.replyTo,
    };

    this.#knownAgents.add(from);
    this.#knownAgents.add(to);

    // 优先交付已等待的接收者。
    const waiter = this.#takeMatchingWaiter(to, from);
    if (waiter) {
      waiter.resolve(message);
      return { to, outcome: "delivered" };
    }

    this.#enqueue(message);
    return { to, outcome: "buffered" };
  }

  /**
   * 阻塞等待一条发给 `agentName` 的消息（可按 `filter.from` 过滤）。
   *
   * - 先消费 mailbox 中已 pending 的匹配消息（除非 `options.drainPending === false`）。
   * - `timeoutMs <= 0`：永远等待（直到收到消息或 `signal` abort）。
   * - `signal` abort 时 reject（reason 透传）。
   * - 收到消息即 resolve（消息从 mailbox / 等待队列中移除）。
   *
   * @returns 收到的消息；超时返回 null。
   */
  async wait(
    agentName: string,
    filter: WaitFilter = {},
    timeoutMs: number = 0,
    signal?: AbortSignal,
    options?: { drainPending?: boolean },
  ): Promise<BusMessage | null> {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("MessageBus.wait aborted");
    }

    this.#knownAgents.add(agentName);

    if (options?.drainPending !== false) {
      const pending = this.#takeFromMailbox(agentName, filter.from);
      if (pending) return pending;
    }

    const { promise, resolve, reject } = newPromiseWithResolvers<BusMessage | null>();
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;

    const waiter: Waiter = {
      from: filter.from,
      resolve: (msg) => {
        cleanup();
        resolve(msg);
      },
    };
    const cleanup = (): void => {
      this.#removeWaiter(agentName, waiter);
      if (timer) clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    };

    if (signal) {
      onAbort = () => {
        cleanup();
        reject(signal.reason instanceof Error ? signal.reason : new Error("MessageBus.wait aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);
      timer.unref?.();
    }

    let waiters = this.#waiters.get(agentName);
    if (!waiters) {
      waiters = [];
      this.#waiters.set(agentName, waiters);
    }
    waiters.push(waiter);
    return promise;
  }

  /**
   * 排空（或 peek）目标 agent 的 mailbox。
   *
   * @param agentName 目标 agent
   * @param opts.peek true=仅查看不清空
   * @returns 消息数组（可能为空）
   */
  inbox(agentName: string, opts?: { peek?: boolean }): BusMessage[] {
    const mailbox = this.#mailboxes.get(agentName);
    if (!mailbox || mailbox.length === 0) return [];
    if (opts?.peek) return [...mailbox];
    this.#mailboxes.delete(agentName);
    return mailbox;
  }

  /** 未读消息数。 */
  unreadCount(agentName: string): number {
    return this.#mailboxes.get(agentName)?.length ?? 0;
  }

  /**
   * 向所有已知 agent 广播一条消息（不含 `from` 自己）。
   *
   * 每个收件人独立 `send`——某收件人失败不影响其他。返回每条送达回执。
   * 广播消息的 `to` 字段为 `"*"`，便于接收方识别为广播。
   */
  broadcast(body: string, from: string, opts?: SendOptions): DeliveryReceipt[] {
    if (!from) {
      return [{ to: "*", outcome: "failed", error: "broadcast: `from` is required." }];
    }
    this.#knownAgents.add(from);
    const recipients = [...this.#knownAgents].filter((name) => name !== from);
    if (recipients.length === 0) return [];

    const results: DeliveryReceipt[] = [];
    for (const to of recipients) {
      const message: BusMessage = {
        id: randomUUID(),
        from,
        to: "*",
        body,
        ts: Date.now(),
        replyTo: opts?.replyTo,
      };
      // 广播不交付给 wait（避免一个广播占用等待者的单消息槽位）；
      // 一律入 mailbox，让接收方主动 inbox / wait 取走。
      this.#enqueue(message);
      results.push({ to, outcome: "buffered" });
    }
    return results;
  }

  /** 注册一个 agent 名（使其被 broadcast 纳入收件人）。幂等。 */
  register(agentName: string): void {
    if (agentName) this.#knownAgents.add(agentName);
  }

  /** 注销一个 agent 名（从 broadcast 收件人中移除，并清空其 mailbox）。 */
  unregister(agentName: string): void {
    this.#knownAgents.delete(agentName);
    this.#mailboxes.delete(agentName);
    // 唤醒该 agent 的等待者（resolve null 让其退出）——避免悬挂 promise。
    const waiters = this.#waiters.get(agentName);
    if (waiters) {
      this.#waiters.delete(agentName);
      for (const w of waiters) w.resolve(null as unknown as BusMessage);
    }
  }

  /** 清空所有状态（mailbox + waiter + 已知 agent）。测试用。 */
  clear(): void {
    this.#mailboxes.clear();
    const allWaiters = [...this.#waiters.values()].flat();
    this.#waiters.clear();
    for (const w of allWaiters) w.resolve(null as unknown as BusMessage);
    this.#knownAgents.clear();
  }

  // ── 内部 ──

  #enqueue(message: BusMessage): void {
    let mailbox = this.#mailboxes.get(message.to);
    if (!mailbox) {
      mailbox = [];
      this.#mailboxes.set(message.to, mailbox);
    }
    mailbox.push(message);
    if (mailbox.length > MAILBOX_CAP) {
      mailbox.shift();
    }
  }

  /** 取走最早一个匹配 `from` 的等待者（无 from 过滤则取最早一个）。 */
  #takeMatchingWaiter(agentName: string, from: string): Waiter | undefined {
    const waiters = this.#waiters.get(agentName);
    if (!waiters || waiters.length === 0) return undefined;
    const index = waiters.findIndex((w) => !w.from || w.from === from);
    if (index === -1) return undefined;
    const [waiter] = waiters.splice(index, 1);
    if (waiters.length === 0) this.#waiters.delete(agentName);
    return waiter;
  }

  #removeWaiter(agentName: string, waiter: Waiter): void {
    const waiters = this.#waiters.get(agentName);
    if (!waiters) return;
    const index = waiters.indexOf(waiter);
    if (index !== -1) waiters.splice(index, 1);
    if (waiters.length === 0) this.#waiters.delete(agentName);
  }

  #takeFromMailbox(agentName: string, from?: string): BusMessage | undefined {
    const mailbox = this.#mailboxes.get(agentName);
    if (!mailbox || mailbox.length === 0) return undefined;
    const index = from ? mailbox.findIndex((m) => m.from === from) : 0;
    if (index === -1) return undefined;
    const [message] = mailbox.splice(index, 1);
    if (mailbox.length === 0) this.#mailboxes.delete(agentName);
    return message;
  }
}
