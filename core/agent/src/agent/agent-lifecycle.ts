/**
 * AgentLifecycleManager — Agent 生命周期跟踪（idle → parked → revived）。
 *
 * 职责：
 *   - 进程全局单例，跟踪所有 agent（main + sub）按 sessionId 的运行状态。
 *   - 状态机：running → idle → (TTL 后) parked → (按需) revived → running
 *     aborted 为终态（不再自动流转）。
 *   - `adopt(sessionId, agentName)` 注册一个 agent 进入生命周期管理。
 *   - `setStatus(sessionId, status)` 更新状态；进入 idle 时自动 arm TTL 定时器。
 *   - `park(sessionId)`：标记 parked，外部可挂载 onPark 回调做实际 dispose。
 *   - `revive(sessionId)`：标记回 idle，外部可挂载 onRevive 回调做实际重建。
 *   - TTL 默认 5 分钟（可配）。
 *
 * 与 oh-my-pi 的区别：
 *   - 不直接持有 / dispose AgentSession 对象（maou-sdk 的 AgentRegistry 是
 *     文件级配置注册表，非运行时实例注册表）。park/revive 的实际副作用通过
 *     注入的回调完成，保持与 runtime 解耦。
 *   - 按 sessionId 索引（而非 agent id），因为 maou-sdk 的 fork 子 agent
 *     唯一标识是 subSessionId。
 *
 * 线程模型：单进程 Node 事件循环；TTL 定时器 unref，不阻止进程退出。
 */

// ─── 类型 ──────────────────────────────────────────────────────────────────

/** Agent 运行时状态。 */
export type AgentStatus = "running" | "idle" | "parked" | "aborted";

/** adopt 时的选项。 */
export interface AdoptOptions {
  /** idle → parked 的 TTL（ms）。<=0 表示永不 park（常驻）。 */
  idleTtlMs?: number;
  /** park 时调用的副作用回调（如 dispose session）。可选。 */
  onPark?: (sessionId: string, agentName: string) => void | Promise<void>;
  /** revive 时调用的副作用回调（如重建 session）。可选。 */
  onRevive?: (sessionId: string, agentName: string) => void | Promise<void>;
}

interface AdoptedAgent {
  agentName: string;
  status: AgentStatus;
  idleTtlMs: number;
  onPark?: AdoptOptions["onPark"];
  onRevive?: AdoptOptions["onRevive"];
  /** 当前 armed 的 TTL 定时器（idle 时 armed，running/parked 时 cleared）。 */
  timer?: NodeJS.Timeout;
  /** adopt 时间戳。 */
  adoptedAt: number;
  /** 最后一次状态变更时间戳。 */
  lastChangedAt: number;
}

/** 默认 TTL：5 分钟。 */
const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000;

// ─── AgentLifecycleManager ──────────────────────────────────────────────────

/**
 * 进程全局 Agent 生命周期管理器。
 *
 * 使用 `AgentLifecycleManager.global()` 获取单例。
 * 测试可用 `AgentLifecycleManager.resetGlobalForTests()` 重置。
 */
export class AgentLifecycleManager {
  static #global: AgentLifecycleManager | undefined;

  static global(): AgentLifecycleManager {
    if (!AgentLifecycleManager.#global) {
      AgentLifecycleManager.#global = new AgentLifecycleManager();
    }
    return AgentLifecycleManager.#global;
  }

  /** 重置全局单例（清空所有跟踪 + 定时器）。仅供测试。 */
  static resetGlobalForTests(): void {
    const current = AgentLifecycleManager.#global;
    if (current) {
      for (const adopted of current.#adopted.values()) {
        if (adopted.timer) clearTimeout(adopted.timer);
      }
      current.#adopted.clear();
    }
    AgentLifecycleManager.#global = undefined;
  }

  /** 按 sessionId 索引的已 adopt agent。 */
  readonly #adopted = new Map<string, AdoptedAgent>();

  /**
   * 注册一个 agent 进入生命周期管理。
   * 初始状态为 "running"（调用方刚启动 run）。
   * 已 adopt 的 sessionId 重新 adopt 会更新选项并保持当前状态（除非已 aborted）。
   */
  adopt(sessionId: string, agentName: string, opts: AdoptOptions = {}): void {
    if (!sessionId || !agentName) return;
    const existing = this.#adopted.get(sessionId);
    if (existing) {
      // 已存在：更新回调 / TTL，状态不变（除非 aborted——aborted 不再流转）。
      existing.agentName = agentName;
      existing.idleTtlMs = opts.idleTtlMs ?? existing.idleTtlMs;
      existing.onPark = opts.onPark ?? existing.onPark;
      existing.onRevive = opts.onRevive ?? existing.onRevive;
      return;
    }
    const now = Date.now();
    const adopted: AdoptedAgent = {
      agentName,
      status: "running",
      idleTtlMs: opts.idleTtlMs ?? DEFAULT_IDLE_TTL_MS,
      onPark: opts.onPark,
      onRevive: opts.onRevive,
      adoptedAt: now,
      lastChangedAt: now,
    };
    this.#adopted.set(sessionId, adopted);
    // running 状态不 arm 定时器；等 setStatus("idle") 时再 arm。
  }

  /** 更新 agent 状态。遵循状态机约束（见文件头）。 */
  setStatus(sessionId: string, status: AgentStatus): void {
    const adopted = this.#adopted.get(sessionId);
    if (!adopted) return;
    if (adopted.status === "aborted") return; // 终态
    if (adopted.status === status) return; // 无变化

    adopted.status = status;
    adopted.lastChangedAt = Date.now();

    // 定时器管理
    if (adopted.timer) {
      clearTimeout(adopted.timer);
      adopted.timer = undefined;
    }
    if (status === "idle") {
      this.#armTimer(sessionId, adopted);
    }
    // running / parked / aborted：不 arm 定时器。
  }

  /** 查询状态。未 adopt 返回 undefined。 */
  getStatus(sessionId: string): AgentStatus | undefined {
    return this.#adopted.get(sessionId)?.status;
  }

  /** 查询 agent 名。未 adopt 返回 undefined。 */
  getAgentName(sessionId: string): string | undefined {
    return this.#adopted.get(sessionId)?.agentName;
  }

  /** 是否已 adopt。 */
  has(sessionId: string): boolean {
    return this.#adopted.has(sessionId);
  }

  /** 列出所有已 adopt 的 sessionId（含状态快照）。 */
  list(): Array<{ sessionId: string; agentName: string; status: AgentStatus }> {
    const result: Array<{ sessionId: string; agentName: string; status: AgentStatus }> = [];
    for (const [sessionId, adopted] of this.#adopted) {
      result.push({ sessionId, agentName: adopted.agentName, status: adopted.status });
    }
    return result;
  }

  /**
   * 主动 park 一个 agent（不等 TTL）。
   * 调用 onPark 回调（如有），然后置状态为 parked。
   * 已 parked / aborted 的无副作用。
   */
  async park(sessionId: string): Promise<void> {
    const adopted = this.#adopted.get(sessionId);
    if (!adopted) return;
    if (adopted.status === "parked" || adopted.status === "aborted") return;
    if (adopted.timer) {
      clearTimeout(adopted.timer);
      adopted.timer = undefined;
    }
    if (adopted.onPark) {
      try {
        await adopted.onPark(sessionId, adopted.agentName);
      } catch {
        // park 副作用失败不阻塞状态流转。
      }
    }
    adopted.status = "parked";
    adopted.lastChangedAt = Date.now();
  }

  /**
   * 复活一个 parked 的 agent。
   * 调用 onRevive 回调（如有），然后置状态为 idle（再 arm TTL）。
   * 非 parked 状态的无副作用（已 running/idle 的无需 revive）。
   */
  async revive(sessionId: string): Promise<void> {
    const adopted = this.#adopted.get(sessionId);
    if (!adopted) return;
    if (adopted.status !== "parked") return;
    if (adopted.onRevive) {
      try {
        await adopted.onRevive(sessionId, adopted.agentName);
      } catch {
        // revive 副作用失败不阻塞状态流转（仍标记 idle，让调用方可重试 run）。
      }
    }
    adopted.status = "idle";
    adopted.lastChangedAt = Date.now();
    this.#armTimer(sessionId, adopted);
  }

  /**
   * 释放一个 agent：清定时器 + 从跟踪中移除。
   * 不调用 onPark（释放 ≠ park）。用于 agent 真正结束时清理。
   */
  release(sessionId: string): void {
    const adopted = this.#adopted.get(sessionId);
    if (!adopted) return;
    if (adopted.timer) clearTimeout(adopted.timer);
    this.#adopted.delete(sessionId);
  }

  /** 清空所有跟踪 + 定时器。进程退出 / 测试用。 */
  dispose(): void {
    for (const adopted of this.#adopted.values()) {
      if (adopted.timer) clearTimeout(adopted.timer);
    }
    this.#adopted.clear();
  }

  // ── 内部 ──

  #armTimer(sessionId: string, adopted: AdoptedAgent): void {
    if (adopted.idleTtlMs <= 0) return; // 永不 park
    if (adopted.timer) clearTimeout(adopted.timer);
    const timer = setTimeout(() => {
      adopted.timer = undefined;
      void this.park(sessionId);
    }, adopted.idleTtlMs);
    timer.unref?.();
    adopted.timer = timer;
  }
}
