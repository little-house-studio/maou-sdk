/**
 * 监督模式通用桥：callMainAgent + 嵌套 run 的 AbortSignal 衔接。
 *
 * 所有 agent 实例（coding / harness / 其它）共用，避免各自实现 yolo 嵌套 run。
 */

import type { StreamEvent } from "@little-house-studio/types";

/** 当前 send 对应的 AbortSignal（CLI 每次 send 前更新，供嵌套 callMainAgent 合并） */
let _currentSupervisorAbort: AbortSignal | undefined;

/** CLI / harness 在每次用户发送前调用，使 Ctrl+C 能中断嵌套主 Agent run */
export function setSupervisorAbortSignal(sig: AbortSignal | undefined): void {
  _currentSupervisorAbort = sig;
}

export function getSupervisorAbortSignal(): AbortSignal | undefined {
  return _currentSupervisorAbort;
}

/** Runtime 门面 run 的最小形状（避免循环依赖具体 Runtime 类） */
export type MainAgentRunner = {
  run: (params: {
    sessionId?: string;
    userMessage: string;
    preset: Record<string, unknown>;
    stream?: boolean;
    abortSignal?: AbortSignal;
    sandboxMode?: string;
    initAgentName?: string;
  }) => AsyncGenerator<StreamEvent>;
};

export interface CreateCallMainAgentOptions {
  /** 延迟取 Runtime（构造期尚未就绪时用 ref 容器） */
  getRuntime: () => MainAgentRunner | null | undefined;
  /** 取主 Agent 用的 API preset */
  getDefaultPreset: () => Record<string, unknown> | undefined | null;
  /**
   * 监督下主 agent 终端模式。默认 yolo（避免「需确认」死循环）。
   * 注意：tools 安全三层下 fatal 仍硬拦。
   */
  sandboxMode?: string;
  /** 额外 abort：优先参数 abortSignal，否则用 setSupervisorAbortSignal 注入的 */
  getAbortSignal?: () => AbortSignal | undefined;
}

/**
 * 构造 Runtime.callMainAgent 实现。
 * supervisor_chat_main 派活给主 session 时使用。
 */
export function createCallMainAgent(
  opts: CreateCallMainAgentOptions,
): (
  mainSessionId: string,
  message: string,
  abortSignal?: AbortSignal,
) => AsyncGenerator<StreamEvent, string> {
  const sandboxMode = opts.sandboxMode ?? "yolo";

  return (mainSessionId, message, abortSignal) => {
    const gen = (async function* () {
      const rt = opts.getRuntime();
      if (!rt) return "❌ Runtime 未初始化。";

      const preset = opts.getDefaultPreset();
      if (!preset) return "❌ 无可用 preset。";

      const signal =
        abortSignal ??
        opts.getAbortSignal?.() ??
        getSupervisorAbortSignal();

      let finalOutput = "";
      try {
        for await (const event of rt.run({
          sessionId: mainSessionId,
          userMessage: message,
          preset,
          stream: true,
          abortSignal: signal,
          sandboxMode,
          initAgentName: "main",
        })) {
          yield event;
          if (
            event.type === "assistant" &&
            typeof (event as { content?: unknown }).content === "string"
          ) {
            finalOutput = (event as { content: string }).content;
          }
        }
      } catch (err) {
        return `❌ 主 Agent 执行失败: ${err instanceof Error ? err.message : String(err)}`;
      }
      return finalOutput || "(主 Agent 无输出)";
    })();
    return gen;
  };
}
