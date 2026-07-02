/**
 * useAgent —— runAgentCli 驱动 + abort + error 兜底。
 *
 * 从 AgentCliConfig.createAgent 拿 AgentHandle，runAgentCli 流式 onEvent→store.onStream。
 * error 兜底：runAgentCli 抛错或 reject 时也 finishStream（reducer error 分支已置，
 * 但若 runAgentCli 在 error 事件前就抛，需这里补）。
 */

import { useRef } from "react";
import { runAgentCli } from "@little-house-studio/agent";
import type { AgentHandle } from "@little-house-studio/agent";
import { useStore } from "../state/store.js";
import type { AgentCliConfig } from "../types.js";
import { join } from "node:path";

export function useAgent(config: AgentCliConfig) {
  const agentRef = useRef<AgentHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const maouRoot = join(process.env.HOME ?? "", ".maou");

  async function send(text: string) {
    const store = useStore.getState();
    if (!text.trim() || store.streaming) return;

    if (!agentRef.current) {
      try {
        agentRef.current = config.createAgent(process.cwd(), maouRoot);
      } catch (e) {
        store.toastMsg(`agent 创建失败: ${String(e).slice(0, 50)}`, "err");
        store.setStreaming(false);
        return;
      }
    }
    const handle = agentRef.current;

    store.pushUserMessage(text);
    abortRef.current = new AbortController();
    try {
      const preset = config.getPreset(store.provider, store.model);
      const sessionId = store.sessionId ?? handle.startSession();
      if (!store.sessionId) store.setSessionId(sessionId);
      await runAgentCli(text, {
        runtime: handle.runtime,
        sessionId,
        preset,
        onEvent: (ev) => useStore.getState().onStream(ev),
        signal: abortRef.current.signal,
        source: "cli",
      });
      // runAgentCli 遇 done/error 即 return，state 已由 reducer 更新
    } catch (e) {
      useStore.getState().toastMsg(String(e).slice(0, 60), "err");
      // 兜底：确保 streaming 关闭（reducer 可能没收到 error 事件）
      useStore.getState().setStreaming(false);
      useStore.getState().setAborting(false);
    }
  }

  function abort() {
    const store = useStore.getState();
    if (store.aborting) return;
    store.setAborting(true);
    abortRef.current?.abort();
    store.toastMsg("已中断", "info");
  }

  return { send, abort };
}
