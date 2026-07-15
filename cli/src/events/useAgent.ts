/**
 * useAgent —— React 薄封装；真实逻辑在 headless/cli-session（与 Ratatui 共用）。
 */

import { useRef, useEffect, useMemo } from "react";
import { useStore } from "../state/store.js";
import type { AgentCliConfig } from "../types.js";
import { createCliSession, type CliSession } from "../headless/cli-session.js";

export function useAgent(config: AgentCliConfig) {
  const sessionRef = useRef<CliSession | null>(null);

  if (!sessionRef.current) {
    sessionRef.current = createCliSession({
      config,
      restoreLastSession: false, // app.tsx 已负责恢复
    });
  }
  const session = sessionRef.current;

  // agent 切换：监听 agentSwitchNonce
  const switchNonce = useStore((s) => s.agentSwitchNonce);
  useEffect(() => {
    const name = useStore.getState().pendingAgentName;
    if (name === null) return;
    session.resetAgent();
    const curName = useStore.getState().agentName;
    if (curName && curName !== name) {
      useStore.getState().saveCurrentSession(curName);
    }
    const restored = useStore.getState().restoreSession(name);
    if (!restored) {
      useStore.getState().clearMessages();
    }
    useStore.getState().clearPendingMessages();
    useStore.getState().setAgentMeta(name, "", "", 0);
    if (restored) {
      useStore.getState().setSessionId(useStore.getState().sessionId);
    } else {
      useStore.getState().setSessionId(null);
      useStore.getState().toastMsg(`切换到 ${name}（新会话）`, "ok");
    }
    useStore.getState().clearPendingAgentSwitch();
    useStore.getState().setOverlay(null);
  }, [switchNonce, session]);

  useEffect(() => {
    return () => {
      // unmount：静默丢掉 handle，不 toast「已中断」
      session.resetAgent();
    };
  }, [session]);

  return useMemo(
    () => ({
      send: (text: string) => session.send(text),
      abort: () => session.abort(),
      sound: session.sound,
    }),
    [session],
  );
}
