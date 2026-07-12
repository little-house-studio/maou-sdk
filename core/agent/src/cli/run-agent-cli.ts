/**
 * 通用 CLI 驱动 —— 用一条用户消息驱动任意 Runtime 门面，逐事件回调。
 *
 * 这是「把 agent 跑起来给人调试」的最小必要接口，所有 agent 通用，
 * 不含富 TUI —— 真正的调试界面在 @little-house-studio/cli 层复用。
 * done/error 事件后结束。
 *
 * agent 层提供此驱动让所有场景特化 agent（coding / reviewer / ...）
 * 都能直接复用，避免每个 agent 自己写一遍循环 + 事件回调装配。
 */

import type { Runtime } from "../agent/runtime-facade.js";
import type { StreamEvent } from "@little-house-studio/types";

export interface AgentCliOptions {
  /** Runtime 门面实例。 */
  runtime: Runtime;
  /** 会话 ID（不传则由运行时新建）。 */
  sessionId?: string;
  /** LLM preset（provider/model/参数）。 */
  preset: Record<string, unknown>;
  /** 流式事件回调（cli 层据此渲染）。 */
  onEvent: (ev: StreamEvent) => void;
  /** 中断信号。 */
  signal?: AbortSignal;
  /** 来源标识，默认 "cli"。 */
  source?: string;
  /** 初始化 agent 名（如 supervisor 模式用 "supervisor"）。 */
  initAgentName?: string;
  /** 审核/沙箱模式：normal | auto | yolo 等 */
  sandboxMode?: string;
}

/**
 * 用一条用户消息驱动 Runtime，逐事件回调。done/error 后结束。
 */
export async function runAgentCli(
  message: string,
  opts: AgentCliOptions,
): Promise<void> {
  for await (const ev of opts.runtime.run({
    sessionId: opts.sessionId,
    userMessage: message,
    preset: opts.preset,
    stream: true,
    abortSignal: opts.signal,
    source: opts.source ?? "cli",
    ...(opts.initAgentName ? { initAgentName: opts.initAgentName } : {}),
    ...(opts.sandboxMode ? { sandboxMode: opts.sandboxMode } : {}),
  })) {
    opts.onEvent(ev);
    if (ev.type === "done" || ev.type === "error") return;
  }
}
