/**
 * coding-agent CLI 特化接口
 *
 * 薄包装：接受 createCodingAgent() 句柄，委托给 agent 层的通用 runAgentCli。
 * 通用驱动逻辑已上移到 @little-house-studio/agent；这里只做编程特化：
 *   - 缺省会话时自动 startSession()，把会话绑定到 coding agent（保证编程 prompt+白名单生效）。
 * 真正的调试界面在 @little-house-studio/cli 层复用。
 */

import { runAgentCli } from "@little-house-studio/agent";
import type { CodingAgent } from "../index.js";
import type { StreamEvent } from "@little-house-studio/types";

export interface CodingCliOptions {
  /** createCodingAgent() 返回的句柄。 */
  agent: CodingAgent;
  /** 会话 ID（不传则自动 startSession() 绑定到 coding agent）。 */
  sessionId?: string;
  /** LLM preset（provider/model/参数）。 */
  preset: Record<string, unknown>;
  /** 流式事件回调（cli 层据此渲染）。 */
  onEvent: (ev: StreamEvent) => void;
  /** 中断信号。 */
  signal?: AbortSignal;
  /** 来源标识，默认 "cli"。 */
  source?: string;
}

/**
 * 用一条用户消息驱动编程 Agent，逐事件回调。done/error 后结束。
 * 返回实际使用的 sessionId（自动创建时为新会话 ID）。
 */
export async function runCodingAgentCli(
  message: string,
  opts: CodingCliOptions,
): Promise<string> {
  // 缺省会话 → 自动创建并绑定到 coding agent，确保编程 prompt + 白名单生效。
  const sessionId = opts.sessionId ?? opts.agent.startSession();

  await runAgentCli(message, {
    runtime: opts.agent.runtime,
    sessionId,
    preset: opts.preset,
    onEvent: opts.onEvent,
    signal: opts.signal,
    source: opts.source ?? "cli",
  });

  return sessionId;
}
