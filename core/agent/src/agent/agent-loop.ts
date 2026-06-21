/**
 * Agent-loop 接口 — 抽象 Agent 循环控制逻辑。
 *
 * 将 harness/runtime.ts 中的循环条件/终止/中断控制抽离为独立接口，
 * 外部可实现自定义循环策略（如 plan 模式、task 模式等）。
 *
 * 设计文档: agent-loop 接口（条件与调用）
 */

import type { StreamEvent } from "@little-house-studio/types";

// ─── 类型 ──────────────────────────────────────────────────────────────────

/** 单次迭代结果 */
export interface LoopIterationResult {
  /** 本轮产出的消息内容 */
  content: string;
  /** 本轮是否有工具调用 */
  hasToolCalls: boolean;
  /** 工具调用数量 */
  toolCallCount: number;
  /** 是否应继续循环 */
  shouldContinue: boolean;
  /** 本轮产出的流式事件 */
  events: StreamEvent[];
}

/** Agent 循环配置 */
export interface LoopConfig {
  /** 最大轮次（0 = 无限） */
  maxRounds: number;
  /** 循环检测阈值 */
  loopThreshold: number;
  /** 中断信号 */
  abortSignal?: AbortSignal;
}

/** 循环状态 */
export interface LoopState {
  /** 当前轮次 */
  roundCount: number;
  /** 本轮轮次 */
  currentRound: number;
  /** 累计工具调用次数 */
  totalToolCalls: number;
  /** 是否已触发压缩 */
  compressed: boolean;
  /** 会话 ID */
  sessionId: string;
}

/** 循环结果 */
export interface LoopResult {
  /** 总轮次 */
  totalRounds: number;
  /** 是否正常结束 */
  completed: boolean;
  /** 结束原因 */
  reason: "max_rounds" | "no_tool_calls" | "aborted" | "completed" | "error";
  /** 所有轮次产出的流式事件 */
  events: StreamEvent[];
  /** 最终内容 */
  finalContent: string;
}

// ─── 接口 ──────────────────────────────────────────────────────────────────

/**
 * Agent 循环控制器接口。
 *
 * 默认实现: DefaultAgentLoop（标准 "调用 LLM → 执行工具 → 继续" 循环）
 * 可扩展: PlanLoop（plan 模式，先问问题再执行）、TaskLoop（task 表接管）
 */
export interface IAgentLoop {
  /** 循环条件：返回 true 继续，false 停止 */
  shouldContinue(state: LoopState, config: LoopConfig): boolean;

  /** 中断检查：返回 true 已中断 */
  isAborted(config: LoopConfig): boolean;

  /** 每次迭代前（可用于注入上下文、更新状态等） */
  beforeIteration(state: LoopState, config: LoopConfig): Promise<void> | void;

  /** 每次迭代后（可用于记录日志、更新次数等） */
  afterIteration(state: LoopState, result: LoopIterationResult, config: LoopConfig): Promise<void> | void;

  /** 确定结束原因 */
  getEndReason(state: LoopState, config: LoopConfig, lastResult?: LoopIterationResult): LoopResult["reason"];
}

// ─── 默认实现 ──────────────────────────────────────────────────────────────

/**
 * 默认 Agent 循环控制器。
 *
 * 规则：
 * - maxRounds=0 表示无限循环，直到无工具调用
 * - maxRounds>0 时达到上限停止
 * - 中断信号检查
 * - 循环检测（重复工具调用模式）
 */
export class DefaultAgentLoop implements IAgentLoop {
  /** 最近 N 轮的工具调用名称管道（用于循环检测） */
  private recentToolNames: string[] = [];

  shouldContinue(state: LoopState, config: LoopConfig): boolean {
    if (state.roundCount >= config.maxRounds && config.maxRounds > 0) {
      return false;
    }
    return true;
  }

  isAborted(config: LoopConfig): boolean {
    return config.abortSignal?.aborted ?? false;
  }

  beforeIteration(_state: LoopState, _config: LoopConfig): void {
    // 默认无操作
  }

  afterIteration(state: LoopState, result: LoopIterationResult, config: LoopConfig): void {
    // 循环检测：记录最近工具调用
    if (result.hasToolCalls) {
      this.recentToolNames.push(`tools_${result.toolCallCount}`);
      if (this.recentToolNames.length > config.loopThreshold) {
        this.recentToolNames.shift();
      }
    }
  }

  getEndReason(state: LoopState, config: LoopConfig, lastResult?: LoopIterationResult): LoopResult["reason"] {
    if (this.isAborted(config)) return "aborted";
    if (lastResult?.hasToolCalls === false) return "no_tool_calls";
    if (state.roundCount >= config.maxRounds && config.maxRounds > 0) return "max_rounds";
    return "completed";
  }

  /** 检测是否陷入循环（相同工具调用模式重复） */
  detectLoop(): boolean {
    if (this.recentToolNames.length < 3) return false;
    const last = this.recentToolNames[this.recentToolNames.length - 1];
    const count = this.recentToolNames.filter((n) => n === last).length;
    return count >= this.recentToolNames.length * 0.7;
  }
}