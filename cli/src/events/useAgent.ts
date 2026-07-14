/**
 * useAgent —— runAgentCli 驱动 + abort + error 兜底。
 *
 * 从 AgentCliConfig.createAgent 拿 AgentHandle，runAgentCli 流式 onEvent→store.onStream。
 * error 兜底：runAgentCli 抛错或 reject 时也 finishStream（reducer error 分支已置，
 * 但若 runAgentCli 在 error 事件前就抛，需这里补）。
 */

import { useRef, useEffect } from "react";
import { runAgentCli, setSupervisorAbortSignal } from "@little-house-studio/agent";
import type { AgentHandle } from "@little-house-studio/agent";
import { useStore } from "../state/store.js";
import type { AgentCliConfig } from "../types.js";
import { SoundManager, loadSoundConfig } from "../hooks/useSound.js";
import { repairUtf8Mojibake } from "../input/filtered-stdin.js";
import { userMaouRoot } from "../config/paths.js";
import {
  setSlashCatalogProvider,
  RUNTIME_SLASH_FALLBACK,
  type CompletionItem,
} from "../overlay/Completer.js";

export function useAgent(config: AgentCliConfig) {
  const agentRef = useRef<AgentHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const soundRef = useRef<SoundManager | null>(null);
  const maouRoot = userMaouRoot();

  // 从用户态 config.json ui.sounds 加载初始配置（仅首次构造）
  if (!soundRef.current) soundRef.current = new SoundManager(loadSoundConfig());
  const sound = soundRef.current;

  // 补全目录：runtime commandRegistry + 兜底表（skill 由 Completer 扫描）
  useEffect(() => {
    setSlashCatalogProvider(() => {
      const items: CompletionItem[] = [];
      try {
        const reg = (agentRef.current as { runtime?: { commandRegistry?: { list: () => Array<{ name: string; description?: string }> } } } | null)
          ?.runtime?.commandRegistry;
        if (reg) {
          for (const c of reg.list()) {
            items.push({
              value: `/${c.name}`,
              label: `/${c.name}`,
              description: c.description ?? "",
            });
          }
        }
      } catch {
        /* ignore */
      }
      return items.length > 0 ? items : [...RUNTIME_SLASH_FALLBACK];
    });
    return () => setSlashCatalogProvider(null);
  }, []);

  // agent 切换：监听 agentSwitchNonce，缓存当前会话 + 恢复目标会话（或新建）
  const switchNonce = useStore((s) => s.agentSwitchNonce);
  useEffect(() => {
    const name = useStore.getState().pendingAgentName;
    if (name === null) return;
    // 中断当前生成
    abortRef.current?.abort();
    agentRef.current = null;
    // 缓存当前 agent 的会话（切走前）
    const curName = useStore.getState().agentName;
    if (curName && curName !== name) {
      useStore.getState().saveCurrentSession(curName);
    }
    // 恢复目标 agent 的会话（有缓存）或清空（无缓存=新会话）
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
  }, [switchNonce]);

  async function send(text: string) {
    const store = useStore.getState();
    // 兜底：若输入链仍带入 latin1 乱码，发送前修回 UTF-8
    text = repairUtf8Mojibake(text);
    if (!text.trim()) return;

    // /new · /clear：本地新会话（清屏 + 画廊），不走 runtime、不留下 "/new" 气泡
    const cmd = text.trim().replace(/^\//, "").toLowerCase();
    if (cmd === "new" || cmd === "clear") {
      abortRef.current?.abort();
      agentRef.current = null; // 下次真正发消息再 createAgent + startSession
      store.startNewSession({
        clearScreen: true,
        toast: cmd === "clear" ? "已清空" : "新会话",
      });
      return;
    }

    // 生成中：入队，生成结束自动 drain（不中断当前生成）
    if (store.streaming) {
      store.enqueueMessage(text.trim());
      store.toastMsg("已排队，生成完发送", "info");
      return;
    }

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
    sound.startIdleTimer();
    abortRef.current = new AbortController();
    // 更新 callMainAgent 闭包的 abortSignal 引用，使 Ctrl+C 能中断嵌套的主 Agent run
    setSupervisorAbortSignal(abortRef.current.signal);
    try {
      const preset = config.getPreset(store.provider, store.model);
      const sessionId = store.sessionId ?? handle.startSession();
      if (!store.sessionId) store.setSessionId(sessionId);
      // /goal 监督模式：done event 带 supervisorMode=true 时，主 run 结束后自动启 supervisor run
      // （复用 harness server.ts 的逻辑：用 initialMessage + initAgentName='supervisor' 跑第二个 run）
      let supervisorPending: { sessionId: string; initialMessage: string } | null = null;
      const captureSupervisor = (ev: { type: string; [k: string]: unknown }) => {
        if (ev.type === "done" && ev.supervisorMode === true && typeof ev.sessionId === "string" && typeof ev.initialMessage === "string") {
          supervisorPending = { sessionId: ev.sessionId, initialMessage: ev.initialMessage };
        }
      };
      const sandboxMode = store.approvalMode; // 审核模式 → runtime sandboxMode
      await runAgentCli(text, {
        runtime: handle.runtime,
        sessionId,
        preset,
        sandboxMode,
        onEvent: (ev) => {
          // 音效触发（副作用，不在 reducer）
          if (ev.type === "done") {
            sound.play("done");
            sound.clearIdleTimer();
            const de = ev as { type: string; [k: string]: unknown };
            captureSupervisor(de);
          } else if (ev.type === "error") {
            sound.play("error");
            sound.clearIdleTimer();
          } else if (
            ev.type === "log" &&
            (ev.level === "error" || ev.level === "warning" || ev.level === "warn")
          ) {
            sound.play("warning");
            if (useStore.getState().streaming) sound.resetIdleTimer();
          } else if (
            ev.type === "model.error" ||
            ev.type === "model.loop_detected" ||
            ev.type === "round_limit"
          ) {
            sound.play("warning");
          } else {
            // 其他事件：streaming 中重置空闲计时器（防误报「卡住」）
            if (useStore.getState().streaming) sound.resetIdleTimer();
          }
          useStore.getState().onStream(ev);
        },
        signal: abortRef.current.signal,
        source: "cli",
      });
      // 主 run done 后，若有 supervisorPending，自动启动 supervisor run（事件继续喂 reducer）
      const sp = supervisorPending as { sessionId: string; initialMessage: string } | null;
      if (sp) {
        await runAgentCli(sp.initialMessage, {
          runtime: handle.runtime,
          sessionId: sp.sessionId,
          preset,
          sandboxMode,
          initAgentName: "supervisor",
          onEvent: (ev) => useStore.getState().onStream(ev),
          signal: abortRef.current.signal,
          source: "supervisor",
        });
      }
      // runAgentCli 遇 done/error 即 return，state 已由 reducer 更新
    } catch (e) {
      sound.play("error");
      sound.clearIdleTimer();
      useStore.getState().toastMsg(String(e).slice(0, 60), "err");
      // 兜底：确保 streaming 关闭（reducer 可能没收到 error 事件）
      useStore.getState().setStreaming(false);
      useStore.getState().setAborting(false);
      // 出错时清空队列，避免持续失败
      useStore.getState().clearPendingMessages();
    }
  }

  function abort() {
    const store = useStore.getState();
    if (store.aborting) return;
    store.setAborting(true);
    abortRef.current?.abort();
    // 中断时取消挂起的终端审批，避免 Promise 泄漏、审批条卡住
    void import("../input/terminal-approval.js").then((m) => {
      m.cancelAllTerminalApprovals("aborted");
    }).catch(() => {});
    sound.clearIdleTimer();
    store.toastMsg("已中断", "info");
  }

  return { send, abort, sound };
}
