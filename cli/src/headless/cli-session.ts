/**
 * Headless CLI session —— Ink 与 Ratatui 共用的 agent / stream / session 内核。
 *
 * 状态真相源：zustand `useStore` + `reducer`（与 Ink 完全同一路径）。
 * 视图层只订阅 UIState 或通过协议推送快照，禁止自建第二套 stream 逻辑。
 */

import { runAgentCli, setSupervisorAbortSignal } from "@little-house-studio/agent";
import type { AgentHandle } from "@little-house-studio/agent";
import type { AgentCliConfig } from "../types.js";
import { useStore } from "../state/store.js";
import { loadLastSession } from "../state/store.js";
import { loadSessionMessages } from "../state/session-loader.js";
import { SoundManager, loadSoundConfig } from "../hooks/useSound.js";
import { repairUtf8Mojibake } from "../input/filtered-stdin.js";
import { userMaouRoot } from "../config/paths.js";
import {
  setSlashCatalogProvider,
  getSlashCommands,
  RUNTIME_SLASH_FALLBACK,
  type CompletionItem,
} from "../overlay/Completer.js";
import {
  dispatchSlash,
  syncRuntimeCommands,
  syncSkillCommands,
  registerBuiltinCliCommands,
} from "../slash/index.js";
import type { UIState } from "../state/types.js";
import {
  analyzeSessionFile,
  formatAnalyzeSummaryLine,
  resolveLatestSessionId,
  writeAnalyzeReport,
} from "../lib/session-analyze.js";

export interface CliSessionOpts {
  config: AgentCliConfig;
  cwd?: string;
  maouRoot?: string;
  /** 是否启用音效（Ratatui / headless 默认真） */
  sound?: boolean;
  /** 启动时恢复 last-session（与 Ink app.tsx 对齐） */
  restoreLastSession?: boolean;
}

export interface CliSession {
  /** 发送用户消息（含 /new /clear 本地处理与排队） */
  send: (text: string) => Promise<void>;
  abort: () => void;
  /** 丢弃 agent handle（切 agent / 新会话后下次 send 重建） */
  resetAgent: () => void;
  /** 本地 slash（model/sessions/…）或透传 runtime */
  runCommand: (id: string, args?: string) => void;
  /** 订阅 UIState 变化；返回 unsubscribe */
  subscribe: (fn: (state: UIState) => void) => () => void;
  getState: () => UIState;
  sound: SoundManager;
  /** 初始化 agent meta + 可选恢复会话 */
  boot: () => Promise<void>;
  dispose: () => void;
}

export function createCliSession(opts: CliSessionOpts): CliSession {
  const config = opts.config;
  const cwd = opts.cwd ?? process.cwd();
  const maouRoot = opts.maouRoot ?? userMaouRoot();
  const enableSound = opts.sound !== false;

  let agent: AgentHandle | null = null;
  let abortCtrl: AbortController | null = null;
  const sound = new SoundManager(enableSound ? loadSoundConfig() : { enabled: false });

  registerBuiltinCliCommands();
  syncSkillCommands();

  // 补全目录：与 useAgent 一致；同时把 runtime 指令动态写入 CliCommandRegistry
  setSlashCatalogProvider(() => {
    const items: CompletionItem[] = [];
    try {
      const reg = (
        agent as {
          runtime?: {
            commandRegistry?: {
              list: () => Array<{
                name: string;
                description?: string;
                usage?: string;
              }>;
            };
          };
        } | null
      )?.runtime?.commandRegistry;
      if (reg) {
        const list = reg.list();
        syncRuntimeCommands(list);
        for (const c of list) {
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

  async function ensureAgentMeta() {
    const store = useStore.getState();
    try {
      const { getRolePresetFromMaouConfig } = await import("@little-house-studio/agent");
      const main = getRolePresetFromMaouConfig("main") as {
        name?: string;
        model?: string;
        maxContext?: number;
        maxTokens?: number;
      } | undefined;
      if (main?.name && main?.model) {
        const maxContext = main.maxContext ?? main.maxTokens ?? 0;
        store.setAgentMeta(config.name, main.name, main.model, maxContext);
        return;
      }
    } catch {
      /* fall through */
    }
    const ps = config.getProviders?.() ?? [];
    if (ps.length > 0) {
      const ms = config.getModels?.(ps[0]!.id) ?? [];
      if (ms.length > 0) {
        const preset = config.getPreset(ps[0]!.id, ms[0]!.id) as {
          maxContext?: number;
          maxTokens?: number;
        };
        const maxContext = preset.maxContext ?? preset.maxTokens ?? 0;
        store.setAgentMeta(config.name, ps[0]!.id, ms[0]!.id, maxContext);
      } else {
        store.setAgentMeta(config.name, ps[0]!.id, "", 0);
      }
    } else {
      store.setAgentMeta(config.name, "", "", 0);
    }
  }

  function restoreSessionIfAny() {
    if (opts.restoreLastSession === false) return;
    const agentName = config.name || "coding";
    const last = loadLastSession(cwd, agentName);
    if (!last?.sessionId) return;
    useStore.getState().setSessionId(last.sessionId);
    const loaded = loadSessionMessages(last.sessionId, cwd);
    if (!loaded || loaded.messages.length === 0) {
      useStore.getState().setMessages([]);
      return;
    }
    useStore.getState().setMessages(loaded.messages);
    useStore.getState().setAutoFollow(true);
    useStore.getState().toastMsg(
      `已恢复本项目会话 ${last.sessionId.slice(0, 8)}（${loaded.messages.length} 条）`,
      "info",
    );
  }

  async function boot() {
    await ensureAgentMeta();
    restoreSessionIfAny();
  }

  function applyProviderModel(provider: string, model: string): boolean {
    const store = useStore.getState();
    try {
      const providers = config.getProviders?.() ?? [];
      if (providers.length > 0) {
        const pOk = providers.some((p) => p.id === provider);
        if (!pOk) {
          store.toastMsg(
            `未知 provider「${provider}」· /model 打开列表`,
            "warn",
          );
          return false;
        }
        const models = config.getModels?.(provider) ?? [];
        if (models.length > 0 && !models.some((m) => m.id === model)) {
          store.toastMsg(
            `未知模型「${model}」· provider=${provider} · /model 打开列表`,
            "warn",
          );
          return false;
        }
      }
      const preset = config.getPreset(provider, model) as {
        maxContext?: number;
        maxTokens?: number;
      } | null;
      store.setProviderModel(provider, model);
      store.setAgentMeta(
        store.agentName || config.name,
        provider,
        model,
        preset?.maxContext ?? preset?.maxTokens ?? 0,
      );
      store.toastMsg(`已切换 ${provider}/${model}`, "ok");
      return true;
    } catch (e) {
      store.toastMsg(
        `切换模型失败: ${e instanceof Error ? e.message : String(e)}`.slice(0, 80),
        "err",
      );
      return false;
    }
  }

  /**
   * 斜杠系统指令：依据 CliCommandSpec 注册表自动识别。
   * true = 已本地处理（绝不进 LLM）；false = 普通消息或 runtime 透传。
   */
  function tryHandleSystemSlash(text: string): boolean {
    const store = useStore.getState();
    // 补全/识别前尽量同步 skills + runtime
    try {
      syncSkillCommands();
      getSlashCommands(); // 触发 provider → syncRuntimeCommands
    } catch {
      /* ignore */
    }

    const d = dispatchSlash(text);
    switch (d.type) {
      case "not_slash":
        return false;
      case "runtime":
        // 交给 agent commandRegistry（作为用户消息）
        return false;
      case "unknown":
        store.toastMsg(d.hint, "warn");
        return true;
      case "local": {
        const a = d.action;
        switch (a.kind) {
          case "new_session": {
            abortCtrl?.abort();
            agent = null;
            store.startNewSession({
              clearScreen: true,
              toast: a.clear ? "已清空" : "新会话",
            });
            return true;
          }
          case "switch_model":
            applyProviderModel(a.provider, a.model);
            return true;
          case "open_model":
            store.setOverlay("model");
            return true;
          case "overlay":
            store.setOverlay(a.overlay as never);
            return true;
          case "thinking_cycle":
            store.runCommand("thinking");
            return true;
          case "screenshot":
            store.runCommand("screenshot");
            return true;
          case "quit":
            store.runCommand("quit");
            return true;
          case "stop":
            abort();
            return true;
          case "store_command":
            store.runCommand(a.id);
            return true;
          case "usage_hint":
            store.toastMsg(a.hint, "warn");
            return true;
          case "analyze_session": {
            try {
              const id =
                store.sessionId ?? resolveLatestSessionId(cwd) ?? null;
              if (!id) {
                store.toastMsg("无会话可诊断", "warn");
                return true;
              }
              const report = analyzeSessionFile(id, cwd);
              const path = writeAnalyzeReport(report, cwd);
              store.toastMsg(
                `${formatAnalyzeSummaryLine(report)} → ${path}`,
                "info",
              );
            } catch (e) {
              store.toastMsg(`诊断失败: ${String(e).slice(0, 80)}`, "err");
            }
            return true;
          }
          default:
            return true;
        }
      }
      default:
        return false;
    }
  }

  async function send(text: string) {
    const store = useStore.getState();
    text = repairUtf8Mojibake(text);
    if (!text.trim()) return;

    // 系统斜杠指令：/model /select /sessions … 本地执行，绝不发给 AI
    if (tryHandleSystemSlash(text)) return;

    if (store.streaming) {
      store.enqueueMessage(text.trim());
      store.toastMsg("已排队，生成完发送", "info");
      return;
    }

    if (!agent) {
      try {
        agent = config.createAgent(cwd, maouRoot);
      } catch (e) {
        store.toastMsg(`agent 创建失败: ${String(e).slice(0, 50)}`, "err");
        store.setStreaming(false);
        return;
      }
    }
    const handle = agent;

    store.pushUserMessage(text);
    sound.startIdleTimer();
    abortCtrl = new AbortController();
    setSupervisorAbortSignal(abortCtrl.signal);

    try {
      const preset = config.getPreset(store.provider, store.model);
      const sessionId = store.sessionId ?? handle.startSession();
      if (!store.sessionId) store.setSessionId(sessionId);

      // 用对象盒子避免 TS 对闭包赋值的 never 收窄
      const supervisorBox: {
        pending: { sessionId: string; initialMessage: string } | null;
      } = { pending: null };

      const sandboxMode = store.approvalMode;
      await runAgentCli(text, {
        runtime: handle.runtime,
        sessionId,
        preset,
        sandboxMode,
        onEvent: (ev) => {
          if (ev.type === "done") {
            sound.play("done");
            sound.clearIdleTimer();
            const de = ev as { type: string; [k: string]: unknown };
            if (
              de.supervisorMode === true &&
              typeof de.sessionId === "string" &&
              typeof de.initialMessage === "string"
            ) {
              supervisorBox.pending = {
                sessionId: de.sessionId,
                initialMessage: de.initialMessage,
              };
            }
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
          } else if (useStore.getState().streaming) {
            sound.resetIdleTimer();
          }
          useStore.getState().onStream(ev);
        },
        signal: abortCtrl.signal,
        source: "cli",
      });

      const sp = supervisorBox.pending;
      if (sp) {
        await runAgentCli(sp.initialMessage, {
          runtime: handle.runtime,
          sessionId: sp.sessionId,
          preset,
          sandboxMode,
          initAgentName: "supervisor",
          onEvent: (ev) => useStore.getState().onStream(ev),
          signal: abortCtrl.signal,
          source: "supervisor",
        });
      }
    } catch (e) {
      sound.play("error");
      sound.clearIdleTimer();
      useStore.getState().toastMsg(String(e).slice(0, 60), "err");
      useStore.getState().setStreaming(false);
      useStore.getState().setAborting(false);
      useStore.getState().clearPendingMessages();
    } finally {
      // drain queue
      const next = useStore.getState().drainPendingMessage();
      if (next) {
        void send(next);
      }
    }
  }

  function abort() {
    const store = useStore.getState();
    if (store.aborting) return;
    store.setAborting(true);
    abortCtrl?.abort();
    void import("../input/terminal-approval.js")
      .then((m) => m.cancelAllTerminalApprovals("aborted"))
      .catch(() => {});
    sound.clearIdleTimer();
    store.toastMsg("已中断", "info");
  }

  function resetAgent() {
    abortCtrl?.abort();
    abortCtrl = null;
    agent = null;
    sound.clearIdleTimer();
  }

  function runCommand(id: string, _args?: string) {
    const store = useStore.getState();
    const slash = `/${id}${_args ? ` ${_args}` : ""}`;
    // 优先走系统斜杠解析（含 /model p m · /select p\0m）
    if (tryHandleSystemSlash(slash)) return;
    if (id === "stop") {
      abort();
      return;
    }
    // 透传 runtime 命令：作为用户消息发送（agent commandRegistry）
    void send(slash);
  }

  function subscribe(fn: (state: UIState) => void): () => void {
    // 立即推一次
    fn(useStore.getState());
    return useStore.subscribe((s) => fn(s));
  }

  function dispose() {
    resetAgent();
    setSlashCatalogProvider(null);
  }

  return {
    send,
    abort,
    resetAgent,
    runCommand,
    subscribe,
    getState: () => useStore.getState(),
    sound,
    boot,
    dispose,
  };
}
