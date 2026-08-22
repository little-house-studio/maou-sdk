/**
 * Headless CLI session —— Ink 与 Ratatui 共用的 agent / stream / session 内核。
 *
 * 状态真相源：zustand `useStore` + `reducer`（与 Ink 完全同一路径）。
 * 视图层只订阅 UIState 或通过协议推送快照，禁止自建第二套 stream 逻辑。
 */

import { mkdirSync } from "node:fs";
import {
  runAgentCli,
  setSupervisorAbortSignal,
  SUPERVISOR_MANAGER,
  tryApplySupervisorUserConfirmation,
} from "@little-house-studio/agent";
import type { AgentHandle } from "@little-house-studio/agent";
import type { AgentCliConfig } from "../types.js";
import { useStore } from "../state/store.js";
import { loadLastSession, setActiveWorkspaceRoot } from "../state/store.js";
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
import { runTermSlash } from "../commands/term.js";
import { setCacheRebuildSink } from "./cache-rebuild-sink.js";

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
  const invocationCwd = opts.cwd ?? process.cwd();
  const maouRoot = opts.maouRoot ?? userMaouRoot();
  const cwd = config.scope === "global"
    ? (config.resolveWorkspaceRoot?.(maouRoot) ?? maouRoot)
    : invocationCwd;
  // global 产品的固定工作区（如 ~/.maou/ops）首次可能尚不存在；
  // Node spawn(…, { cwd }) 在目录缺失时会报 ENOENT，误导为 TUI 二进制不存在。
  if (config.scope === "global") {
    try {
      mkdirSync(cwd, { recursive: true });
    } catch {
      /* ignore — 创建失败时后续 spawn 会给出明确错误 */
    }
  }
  const enableSound = opts.sound !== false;
  setActiveWorkspaceRoot(cwd);

  let agent: AgentHandle | null = null;
  let abortCtrl: AbortController | null = null;
  const sound = new SoundManager(enableSound ? loadSoundConfig() : { enabled: false });
  setCacheRebuildSink((event) => {
    void agent?.runtime.atCacheRebuildPoint(event);
  });

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
    const scopeHint = config.scope === "global" ? "全局会话" : "本项目会话";
    useStore.getState().toastMsg(
      `已恢复${scopeHint} ${last.sessionId.slice(0, 8)}（${loaded.messages.length} 条）`,
      "info",
    );
  }

  async function boot() {
    await ensureAgentMeta();
    // 可选跳过恢复：MAOU_SKIP_SESSION_RESTORE=1 解决坏会话导致 UI 假死
    if (process.env.MAOU_SKIP_SESSION_RESTORE === "1") {
      useStore.getState().setMessages([]);
      useStore.getState().setSessionId(null);
      useStore.getState().toastMsg("已跳过会话恢复（MAOU_SKIP_SESSION_RESTORE=1）", "info");
    } else {
      try {
        restoreSessionIfAny();
      } catch (e) {
        useStore.getState().setMessages([]);
        useStore.getState().toastMsg(
          `会话恢复失败已跳过: ${String(e).slice(0, 60)}`,
          "warn",
        );
      }
    }
    // 恢复后强制清 streaming/busy，避免假「仍在生成」
    useStore.getState().setStreaming(false);
    useStore.getState().setAgentBusy(false);
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
            store.startNewSession({
              clearScreen: true,
              toast: a.clear ? "已清空" : "新会话",
              rebuildReason: a.clear ? "session_clear" : "session_new",
            });
            agent = null;
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
          case "term": {
            void runTermSlash({ sub: a.sub, id: a.id, cwd })
              .then((r) => store.toastMsg(r.toast, "info"))
              .catch((e) =>
                store.toastMsg(`终端列表失败: ${String(e).slice(0, 60)}`, "err"),
              );
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

  /** 把 SUPERVISOR_MANAGER 状态同步到 Goal 面板（立即可见） */
  function syncSupervisorUiFromSdk(sessionHint?: string | null): void {
    const sid = sessionHint || useStore.getState().sessionId;
    if (!sid) return;
    try {
      const b =
        SUPERVISOR_MANAGER.getBySupervisor(sid) ??
        SUPERVISOR_MANAGER.getByMain(sid);
      if (!b || b.state === "ended") {
        useStore.getState().clearSupervisor();
        return;
      }
      useStore.getState().setSupervisor({
        active: true,
        mainSessionId: b.mainSessionId,
        supervisorSessionId: b.supervisorSessionId,
        state: b.state,
        plan: b.plan,
        verifyRounds: b.verifyRounds,
        lastVerdict: b.lastVerdict,
      });
    } catch {
      /* ignore */
    }
  }

  async function send(text: string) {
    const store = useStore.getState();
    text = repairUtf8Mojibake(text);
    if (!text.trim()) return;

    // 系统斜杠指令：/model /select /sessions … 本地执行，绝不发给 AI
    if (tryHandleSystemSlash(text)) return;

    // 监督确认必须在 busy 排队之前处理，否则 Goal 条会一直卡在「待确认计划」
    const sidForAck = store.sessionId;
    let runText = text.trim();
    let supervisorForceName: string | undefined;
    if (sidForAck) {
      const ack = tryApplySupervisorUserConfirmation(sidForAck, runText);
      if (ack.applied) {
        if (ack.ended && ack.mainSessionId) {
          store.pushUserMessage(runText);
          try {
            useStore.getState().setSessionId(ack.mainSessionId);
            useStore.getState().clearSupervisor();
            useStore.getState().toastMsg("监督模式已结束，切回主 Agent", "ok");
          } catch { /* ignore */ }
          return;
        }
        if (ack.state === "started") {
          syncSupervisorUiFromSdk(sidForAck);
          useStore.getState().toastMsg("计划已确认 · 监督执行中", "ok");
          if (ack.continueAsUserMessage) runText = ack.continueAsUserMessage;
          supervisorForceName = "supervisor";
        }
      } else {
        // 监督 session 内其它消息也要用 supervisor 身份跑
        const b =
          SUPERVISOR_MANAGER.getBySupervisor(sidForAck) ??
          SUPERVISOR_MANAGER.getByMain(sidForAck);
        if (b && b.supervisorSessionId === sidForAck && b.state !== "ended") {
          supervisorForceName = "supervisor";
        }
      }
    }

    if (store.streaming || store.agentBusy) {
      store.enqueueMessage(runText);
      store.toastMsg("已排队，当前轮结束后发送", "info");
      return;
    }

    if (!agent) {
      try {
        // ops 切到项目 coding 时用 agentProjectRoot；否则用产品 workspace
        const bindRoot = store.agentProjectRoot || cwd;
        agent = config.createAgent(bindRoot, maouRoot);
        try {
          const { createTuiHookUi } = await import("../hooks/hook-ui.js");
          agent.runtime.setHookUi(createTuiHookUi());
        } catch { /* headless / 无 TUI 时保持 fail-closed */ }
        // 若列表切到了其它 agent 名，对齐 handle
        if (store.agentName && agent.agentName && store.agentName !== agent.agentName) {
          // createAgent 可能固定返回 ops/coding；initAgentName 在 run 时再绑定
        }
      } catch (e) {
        store.toastMsg(`agent 创建失败: ${String(e).slice(0, 50)}`, "err");
        store.setStreaming(false);
        return;
      }
    }
    const handle = agent;

    // 用户气泡显示原文（确认），模型侧可能收到改写后的 runText
    sound.onUserInteraction();
    store.pushUserMessage(text.trim());
    store.setAgentBusy(true);
    // Agent 页状态灯
    try {
      const { agentPresenceKey, markAgentRunning, markAgentReplied } = await import(
        "../state/agent-presence.js"
      );
      const key = agentPresenceKey(store.agentName, store.agentProjectRoot);
      markAgentReplied(key);
      markAgentRunning(key);
    } catch { /* ignore */ }
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
      // 监督 session 必须用 supervisor 身份，否则工具 isSupervisorSession/权限会错
      const initName =
        supervisorForceName ||
        (SUPERVISOR_MANAGER.isSupervisorSession(sessionId)
          ? "supervisor"
          : store.agentName || config.name);
      await runAgentCli(runText, {
        runtime: handle.runtime,
        sessionId,
        preset,
        sandboxMode,
        initAgentName: initName,
        onEvent: (ev) => {
          if (ev.type === "done") {
            sound.play("done");
            sound.clearIdleTimer();
            sound.clearStuckAlarm();
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
            // 每轮 done 后同步 Goal 条（submit_plan / start / verify 等）
            try {
              syncSupervisorUiFromSdk(sessionId);
            } catch { /* ignore */ }
          } else if (ev.type === "tool_result") {
            try {
              syncSupervisorUiFromSdk(sessionId);
            } catch { /* ignore */ }
          } else if (ev.type === "error") {
            // API / 重试类失败：完全静音（文案在系统消息里即可，绝不再连响）
            sound.clearIdleTimer();
            sound.clearStuckAlarm();
            const msg = String(
              (ev as { message?: string }).message ??
                (ev as { error?: string }).error ??
                "",
            );
            const isApiNoise =
              /API Error|请求失败|可重试|10305|status code|HTTP|ECONN|ETIMEDOUT|timeout|rate.?limit|overflow|上下文超|invalid_request|ModelArts/i.test(
                msg,
              );
            // 仅非 API 的意外错误：可选一声；默认也不长铃
            if (!isApiNoise) {
              sound.playOnce("error");
            }
          } else if (ev.type === "status") {
            // 重试 / 压缩 / API error 过程态：静音
            if (useStore.getState().streaming) sound.resetIdleTimer();
          } else if (
            ev.type === "log" &&
            (ev.level === "error" || ev.level === "warning" || ev.level === "warn")
          ) {
            // 含「请求失败可重试」等：静音
            if (useStore.getState().streaming) sound.resetIdleTimer();
          } else if (
            ev.type === "model.error" ||
            ev.type === "model.loop_detected" ||
            ev.type === "round_limit"
          ) {
            // 静音
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
        // 主 agent done 后 streaming 可能已 false；保持 agentBusy 覆盖 supervisor 第二轮
        useStore.getState().setAgentBusy(true);
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
      sound.clearIdleTimer();
      sound.clearStuckAlarm();
      // send 抛错多为 API/网络：静音，只 toast
      const em = String(e);
      if (
        !/API Error|请求失败|可重试|10305|status code|HTTP|ECONN|timeout|fetch failed/i.test(
          em,
        )
      ) {
        sound.playOnce("error");
      }
      useStore.getState().toastMsg(String(e).slice(0, 60), "err");
      useStore.getState().setStreaming(false);
      useStore.getState().setAborting(false);
      useStore.getState().clearPendingMessages();
    } finally {
      const st = useStore.getState();
      st.setAgentBusy(false);
      try {
        const { agentPresenceKey, markAgentDone } = await import("../state/agent-presence.js");
        markAgentDone(agentPresenceKey(st.agentName, st.agentProjectRoot));
      } catch { /* ignore */ }
      // drain queue
      const next = st.drainPendingMessage();
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
    setCacheRebuildSink(undefined);
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
