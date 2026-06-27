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
 * @see DESIGN.md 第 25 行「fork与合并与上下文管理」
 * @see subagent-registry.ts（约定目录扫描 + schema 生成）
 */

import type { StreamEvent, SubagentExecutorLike, SubagentResultLike } from "@little-house-studio/types";

/** harness 注入的 run 函数类型 */
export type SubagentRunFn = (
  subSessionId: string,
  taskId: string,
  taskDesc: string,
  options?: {
    parentSessionId?: string;
    agentName?: string;
    abortSignal?: AbortSignal;
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
}

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
  /** 当前 parentSessionId（harness 注入；fork 时若未传 parentSessionId 用此值） */
  parentSessionId: string = "";

  constructor(opts: SubagentExecutorOptions) {
    this._runFn = opts.runFn;
    this._idFactory = opts.subSessionIdFactory ?? defaultSubSessionIdFactory;
    this._maxConcurrency = opts.maxConcurrency ?? 5;
    this._log = opts.log ?? (() => {});
  }

  /**
   * Fork 一个子 Agent 执行单个 task。
   * 实现 SubagentExecutorLike.fork 契约。
   *
   * @param taskId task 标识
   * @param task 任务描述（自然语言，子 Agent 的输入）
   */
  async fork(taskId: string, taskDesc: string): Promise<SubagentResultLike> {
    const parentSessionId = this.parentSessionId;
    const subSessionId = this._idFactory(parentSessionId, taskId);
    const start = Date.now();
    this._log("info", `[FORK] task=${taskId} sub_session=${subSessionId} desc="${taskDesc.slice(0, 60)}"`);

    try {
      const gen = this._runFn(subSessionId, taskId, taskDesc, {
        parentSessionId,
      });
      let finalOutput = "";
      let ok = true;
      let error: string | undefined;

      // 消费流式事件，取最终返回值
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
        // 流式事件可在此上报（harness 决定是否 yield 给前端）
        if (value?.type === "assistant" && typeof value.content === "string") {
          finalOutput = value.content; // 持续更新到最后一条
        }
      }

      return {
        taskId,
        subSessionId,
        output: finalOutput || "(子 Agent 无输出)",
        ok,
        error,
        elapsedMs: Date.now() - start,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._log("warning", `[FORK] task=${taskId} 失败: ${msg}`);
      return {
        taskId,
        subSessionId,
        output: "",
        ok: false,
        error: msg,
        elapsedMs: Date.now() - start,
      };
    }
  }

  /**
   * Fork 一层 task 并发执行（#4 真并行）。
   * 实现 SubagentExecutorLike.forkLayer 契约。
   *
   * @param tasks 同层可并行执行的 task 数组（由 TaskScheduler.selectLayer 给出）
   */
  async forkLayer(tasks: Array<{ id: string; desc: string }>): Promise<SubagentResultLike[]> {
    if (tasks.length === 0) return [];

    this._log("info", `[FORK_LAYER] 并行 fork ${tasks.length} 个子 Agent: ${tasks.map((t) => t.id).join(", ")}`);

    // 分批并发控制
    const results: SubagentResultLike[] = [];
    for (let i = 0; i < tasks.length; i += this._maxConcurrency) {
      const batch = tasks.slice(i, i + this._maxConcurrency);
      const batchResults = await Promise.all(
        batch.map((t) => this.fork(t.id, t.desc)),
      );
      results.push(...batchResults);
    }

    // 按 taskId 排序（保证顺序稳定）
    results.sort((a, b) => a.taskId.localeCompare(b.taskId));
    return results;
  }

  /**
   * 把子 Agent 结果格式化为 tool_result 文本（合并回主 session）。
   */
  static formatResultsAsToolResult(results: SubagentResultLike[]): string {
    if (results.length === 0) return "(无并行子 Agent 结果)";
    const lines: string[] = [`⚡ 并行子 Agent 执行结果（${results.length} 个）:`];
    for (const r of results) {
      const status = r.ok ? "✓" : "✗";
      const output = r.ok ? r.output : `失败: ${r.error}`;
      const snippet = output.length > 500 ? output.slice(0, 500) + "…(截断)" : output;
      lines.push(`\n${status} [${r.taskId}] (${r.elapsedMs}ms, sub=${r.subSessionId})`);
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
