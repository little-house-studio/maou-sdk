/** useAgent — agent 驱动（createAgent + runAgentCli + onStream） */
import { useRef } from "react";
import { runAgentCli } from "@little-house-studio/agent";
import { useStore } from "../state/store.js";
import type { AgentCliConfig } from "../types.js";
import { join } from "node:path";

export function useAgent(config: AgentCliConfig) {
  const agentRef = useRef<ReturnType<AgentCliConfig["createAgent"]> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const maouRoot = join(process.env.HOME ?? "", ".maou");

  async function send(text: string) {
    const store = useStore.getState();
    if (!text.trim() || store.streaming) return;

    if (!agentRef.current) {
      // cli-config.ts 已传 log:()=>{} + enablePostLogger:false，
      // Runtime 和 pino 日志在创建时就静默了，不需要事后改。
      try { agentRef.current = config.createAgent(process.cwd(), maouRoot); }
      catch (e) { store.toastMsg(`agent 创建失败: ${String(e).slice(0, 50)}`, "err"); store.finishStream(); return; }
    }

    store.send(text);
    abortRef.current = new AbortController();
    try {
      const preset = config.getPreset(store.provider, store.model);
      const sessionId = store.sessionId ?? agentRef.current.startSession();
      if (!store.sessionId) store.setSessionId(sessionId);
      await runAgentCli(text, {
        runtime: agentRef.current.runtime, sessionId, preset,
        onEvent: (ev) => useStore.getState().onStream(ev),
        signal: abortRef.current.signal, source: "cli",
      });
    } catch (e) {
      store.toastMsg(String(e).slice(0, 60), "err");
      store.finishStream();
    }
  }

  function abort() {
    abortRef.current?.abort();
    useStore.getState().toastMsg("已中断", "info");
  }

  return { send, abort };
}
