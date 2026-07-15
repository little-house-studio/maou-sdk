/**
 * Ratatui 后端：与 Ink 共用 CliSession + store；推送全量语义 UI。
 */

import { spawnRatatui, type RatatuiSession } from "./launch.js";
import { createCliSession } from "../headless/cli-session.js";
import { buildFullState } from "../headless/state-snapshot.js";
import { buildOverlay } from "../headless/overlay-data.js";
import type { AgentCliConfig } from "../types.js";
import { useStore } from "../state/store.js";
import type { UIState } from "../state/types.js";
import { complete, applyCompletion } from "../overlay/Completer.js";
import { loadSessionMessages } from "../state/session-loader.js";
import { resolveThemeArg, setActiveTheme } from "../theme/load-theme.js";
import {
  installCliTerminalApprover,
  uninstallCliTerminalApprover,
  cancelAllTerminalApprovals,
  answerTerminalApproval,
} from "../input/terminal-approval.js";
import { pickGalleryWork, pickGallerySize, formatPlaque } from "../gallery/catalog.js";
import { loadFramedArt } from "../gallery/load-art.js";
import { SUPERVISOR_MANAGER } from "@little-house-studio/agent";
import type { SupervisorState } from "../state/types.js";
import {
  handleEscapeCancel,
  registerAbortStream,
} from "../hooks/escape-cancel.js";
import { restoreTerminalViewport } from "../input/terminal-viewport.js";
import { ensurePerfHudSampler } from "../headless/perf-hud-lines.js";
import { notePaintFrame } from "../hooks/process-stats.js";

export interface RunRatatuiOpts {
  config: AgentCliConfig;
  productName?: string;
  themePath?: string;
}

/**
 * 从 SDK SUPERVISOR_MANAGER 同步监督状态到 store。
 * 必须与 useSupervisorState 一样：无变化时不 set，否则
 * setSupervisor → store.subscribe → refreshSupervisor 死循环（栈溢出）。
 */
function refreshSupervisor(): void {
  const sid = useStore.getState().sessionId;
  let next: SupervisorState | null = null;
  if (sid) {
    const b =
      SUPERVISOR_MANAGER.getBySupervisor(sid) ??
      SUPERVISOR_MANAGER.getByMain(sid);
    if (b) {
      next = {
        active: b.state !== "ended",
        mainSessionId: b.mainSessionId,
        supervisorSessionId: b.supervisorSessionId,
        state: b.state,
        plan: b.plan,
        verifyRounds: b.verifyRounds,
        lastVerdict: b.lastVerdict,
      };
      // ended 或 inactive → 清掉 UI 状态
      if (!next.active) next = null;
    }
  }

  const cur = useStore.getState().supervisor;
  // 双 null：绝不能 set（zustand 仍会 notify 所有 subscriber）
  if (!cur && !next) return;
  if (
    cur &&
    next &&
    cur.state === next.state &&
    cur.verifyRounds === next.verifyRounds &&
    cur.plan === next.plan &&
    cur.active === next.active &&
    cur.mainSessionId === next.mainSessionId &&
    cur.supervisorSessionId === next.supervisorSessionId &&
    cur.lastVerdict === next.lastVerdict
  ) {
    return;
  }
  useStore.getState().setSupervisor(next);
}

export async function runAgentWithRatatui(opts: RunRatatuiOpts): Promise<void> {
  const cwd = process.cwd();
  const loadedTheme = resolveThemeArg(opts.themePath);
  setActiveTheme(loadedTheme, false);

  const cli = createCliSession({
    config: opts.config,
    cwd,
    restoreLastSession: true,
    sound: true,
  });
  await cli.boot();

  installCliTerminalApprover();
  refreshSupervisor();
  registerAbortStream(() => cli.abort());

  // 展开状态（工具卡 / thinking / 长消息）—— 与 Ink 本地 useState 对等
  const expandedTools = new Set<string>();
  const expandedThinking = new Set<string>();
  const expandedMsgs = new Set<string>();

  // PerfHud: keep process-stats sampler alive; refresh chrome every ~2s
  let unsubPerf: (() => void) | null = null;

  // 输入草稿由 Rust 持有；补全在 Node 算
  let lastInput = "";
  let lastCursor = 0;
  /** 历史浏览前暂存的草稿（Ink savedInputRef） */
  let historyDraft: string | null = null;

  let session: RatatuiSession | null = null;
  let lastSig = "";
  let pushTimer: ReturnType<typeof setTimeout> | null = null;

  function galleryLines(seed: string): string[] {
    try {
      // Logo 由 Ratatui 左上自绘（Ink GallerySplash ①）；此处只送画 + 铭牌
      const work = pickGalleryWork(seed);
      const cols = Math.max(40, process.stdout.columns || 100);
      const rows = Math.max(16, process.stdout.rows || 30);
      // 扣 logo≈5 + 底栏≈8，与 Ink contentRows 预算接近
      const size = pickGallerySize(cols, Math.min(rows - 10, 28));
      const art = loadFramedArt(work.id, size) ?? [];
      const maxArt = Math.min(art.length, Math.max(12, rows - 14));
      const plaque = formatPlaque(work);
      return [
        ...art.slice(0, maxArt),
        "",
        ...plaque,
        `gallery · ${size}`,
      ];
    } catch {
      return ["", "输入消息开始对话"];
    }
  }

  function completionsFor(input: string, cursor: number) {
    try {
      useStore.getState().updateCompletion(input, cursor);
      const c = useStore.getState().completion;
      if (!c || c.items.length === 0) return null;
      return {
        items: c.items.map((it) => ({
          value: it.value,
          label: it.label,
          description: it.description,
        })),
        sel: c.sel,
        prefix: c.prefix,
        range: c.range,
      };
    } catch {
      return null;
    }
  }

  function snapshotOpts(s: UIState, input?: string) {
    const overlay = buildOverlay(s.overlay, opts.config, s.agentName);
    const comps =
      input != null
        ? completionsFor(input, lastCursor)
        : lastInput
          ? completionsFor(lastInput, lastCursor)
          : null;
    return {
      expandedTools,
      expandedThinking,
      expandedMsgs,
      theme: loadedTheme.tokens,
      overlay,
      completions: comps,
      input: input ?? lastInput,
      gallery_lines:
        s.messages.length === 0 ? galleryLines(s.gallerySeed || "boot") : undefined,
    };
  }

  const pushState = (state?: UIState, force = false) => {
    const s = state ?? cli.getState();
    const msg = buildFullState(s, snapshotOpts(s));
    const sig = [
      s.lastStreamNonce,
      s.messages.length,
      s.streaming,
      s.toast?.text ?? "",
      s.model,
      s.overlay,
      s.approvalMode,
      s.terminalApproval?.id ?? "",
      expandedTools.size,
      lastInput.length,
      (s as UIState & { pendingMessages?: string[] }).pendingMessages?.length ?? 0,
      s.eventBlockExpanded ? 1 : 0,
    ].join("|");
    if (!force && sig === lastSig) return;
    lastSig = sig;
    // Approx paint ticks for process-stats fps (Ink notes real paint frames)
    notePaintFrame();
    session?.send(msg);
  };

  // PerfHud sampler (~2s) → force chrome refresh with cpu/mem/verdict
  unsubPerf = ensurePerfHudSampler(() => {
    lastSig = "";
    pushState(undefined, true);
  });

  const schedulePush = (state: UIState) => {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      pushState(state);
    }, 24);
  };

  // 只在 nonce 递增时查 SDK（对齐 useSupervisorState 的 checkNonce 依赖）
  let lastSupervisorCheckNonce = useStore.getState().supervisorCheckNonce ?? 0;
  const unsub = cli.subscribe((state) => {
    // tool_result/done 后同步监督状态（对齐 useSupervisorState）
    const nonce = state.supervisorCheckNonce ?? 0;
    if (nonce !== lastSupervisorCheckNonce) {
      lastSupervisorCheckNonce = nonce;
      refreshSupervisor();
    }
    schedulePush(state);
  });

  // GoalPanel requestSend / pendingSubmit
  let lastPendingSend: string | null = null;
  let lastPendingSubmit: string | null = null;
  const unsubPending = useStore.subscribe((s) => {
    if (s.pendingSend && s.pendingSend !== lastPendingSend) {
      lastPendingSend = s.pendingSend;
      const text = s.pendingSend;
      useStore.getState().clearPendingSend();
      void cli.send(text);
    }
    if (s.pendingSubmit && s.pendingSubmit !== lastPendingSubmit) {
      lastPendingSubmit = s.pendingSubmit;
      const text = s.pendingSubmit;
      useStore.getState().clearPendingSubmit();
      void cli.send(text);
    }
  });

  session = spawnRatatui(
    {
      cwd,
      product: opts.productName ?? "coding",
      agent: opts.config.name || "main",
      model: cli.getState().model || "",
    },
    async (msg) => {
      const type = String(msg.type ?? "");

      if (type === "ready") {
        lastSig = "";
        pushState(undefined, true);
        return;
      }
      if (type === "quit") {
        session?.kill();
        return;
      }
      if (type === "abort") {
        cli.abort();
        return;
      }
      if (type === "escape") {
        // 与 Ink 同一套 Esc 分层栈（escape-cancel.ts）
        const r = handleEscapeCancel();
        if (r.handled) {
          if (r.action === "abort_stream") {
            // abortStreamHandler already called cli.abort via registerAbortStream
          }
          lastSig = "";
          pushState(undefined, true);
        }
        return;
      }
      if (type === "submit") {
        // Ink doSubmit: restore terminal viewport after IME lateral scroll (Q08)
        restoreTerminalViewport();
        const text = String(msg.text ?? "");
        lastInput = "";
        lastCursor = 0;
        if (!text.trim()) return;
        await cli.send(text);
        lastSig = "";
        pushState(undefined, true);
        return;
      }
      if (type === "input_update") {
        lastInput = String(msg.text ?? "");
        lastCursor = Number(msg.cursor ?? lastInput.length) || 0;
        // 浏览历史时手动编辑 → 退出历史模式（Ink resetHistoryIndex）
        if (useStore.getState().historyIndex >= 0) {
          useStore.getState().resetHistoryIndex();
          historyDraft = null;
        }
        useStore.getState().setInputDraft(lastInput);
        // Ink InputBar: report multi-line height for hit-test (M04)
        useStore.getState().setInputLineCount(
          Math.max(1, Math.min(4, lastInput.split("\n").length)),
        );
        useStore.getState().updateCompletion(lastInput, lastCursor);
        // 轻量推 completions
        session?.send({
          type: "completions",
          completions: completionsFor(lastInput, lastCursor),
        });
        return;
      }
      if (type === "complete_select") {
        // Mouse click on completion row: set sel then accept
        const idx = Number(msg.index ?? 0);
        const cur = useStore.getState().completion;
        if (!cur?.items?.length) return;
        const sel = Math.max(0, Math.min(idx, cur.items.length - 1));
        useStore.setState({ completion: { ...cur, sel } });
        // fall through to accept
      }
      if (type === "complete_accept" || type === "complete_select") {
        const cur = useStore.getState().completion;
        if (!cur?.items?.length) return;
        const applied = applyCompletion(
          lastInput,
          cur.items[cur.sel] ?? cur.items[0]!,
          cur.range,
        );
        lastInput = applied.text;
        lastCursor = applied.cursorIndex;
        historyDraft = null;
        useStore.getState().resetHistoryIndex();
        session?.send({
          type: "input_set",
          text: lastInput,
          cursor: lastCursor,
        });
        useStore.getState().updateCompletion(lastInput, lastCursor);
        session?.send({
          type: "completions",
          completions: completionsFor(lastInput, lastCursor),
        });
        return;
      }
      if (type === "complete_cycle") {
        const dir = String(msg.dir ?? "down") === "up" ? "up" : "down";
        useStore.getState().cycleCompletion(dir);
        const c = useStore.getState().completion;
        session?.send({
          type: "completions",
          completions: c
            ? {
                items: c.items.map((it) => ({
                  value: it.value,
                  label: it.label,
                  description: it.description,
                })),
                sel: c.sel,
                prefix: c.prefix,
                range: c.range,
              }
            : null,
        });
        return;
      }
      if (type === "history") {
        const dir = String(msg.dir ?? "up") === "down" ? "down" : "up";
        const st = useStore.getState();
        if (dir === "up") {
          // 首次进入历史：暂存当前草稿
          if (st.historyIndex < 0) {
            historyDraft = lastInput;
          }
          if (lastInput.trim()) {
            st.pushInputHistory(lastInput);
          }
        }
        const h = useStore.getState().navigateHistory(dir);
        if (h != null) {
          // 下键超出历史末尾 → 恢复草稿（Ink savedInputRef）
          if (h === "" && dir === "down" && historyDraft != null) {
            lastInput = historyDraft;
            historyDraft = null;
          } else {
            lastInput = h;
          }
          lastCursor = lastInput.length;
          session?.send({ type: "input_set", text: lastInput, cursor: lastCursor });
        }
        return;
      }
      if (type === "command" || type === "overlay_action") {
        const action = String(msg.action ?? msg.id ?? "");
        const value = msg.value != null ? String(msg.value) : "";
        await handleOverlayAction(action, value);
        return;
      }
      if (type === "hotkey") {
        await handleHotkey(String(msg.key ?? ""));
        return;
      }
      if (type === "tool_toggle") {
        const tid = String(msg.tool_id ?? "");
        if (!tid) return;
        if (expandedTools.has(tid)) expandedTools.delete(tid);
        else expandedTools.add(tid);
        pushState(undefined, true);
        return;
      }
      if (type === "thinking_toggle") {
        const tid = String(msg.id ?? "");
        if (expandedThinking.has(tid)) expandedThinking.delete(tid);
        else expandedThinking.add(tid);
        pushState(undefined, true);
        return;
      }
      if (type === "message_expand") {
        const mid = String(msg.id ?? "");
        if (expandedMsgs.has(mid)) expandedMsgs.delete(mid);
        else expandedMsgs.add(mid);
        pushState(undefined, true);
        return;
      }
      if (type === "approval") {
        const choice = String(msg.choice ?? "n").toLowerCase();
        const id = String(msg.id ?? useStore.getState().terminalApproval?.id ?? "");
        const map: Record<string, "once" | "always" | "deny" | "blacklist"> = {
          y: "once",
          a: "always",
          n: "deny",
          b: "blacklist",
          once: "once",
          always: "always",
          deny: "deny",
          blacklist: "blacklist",
        };
        if (id) answerTerminalApproval(id, map[choice] ?? "deny");
        pushState(undefined, true);
        return;
      }
      if (type === "set_approval_mode") {
        const next = useStore.getState().cycleApprovalMode();
        useStore.getState().toastMsg(`审核 · ${next}`, "info");
        pushState(undefined, true);
        return;
      }
      if (type === "open_full_editor") {
        useStore.getState().openFullEditor(lastInput);
        // 全屏编辑器：用 overlay 行文本模拟（Phase：input 多行已支持；这里推 full_editor 模式）
        session?.send({
          type: "full_editor",
          text: lastInput,
        });
        return;
      }
      if (type === "full_editor_done") {
        const text = String(msg.text ?? "");
        const submit = Boolean(msg.submit);
        useStore.getState().exitFullEditor(text, submit);
        lastInput = text;
        lastCursor = text.length;
        session?.send({ type: "input_set", text, cursor: text.length });
        if (submit && text.trim()) {
          await cli.send(text);
          lastInput = "";
        }
        pushState(undefined, true);
        return;
      }
      if (type === "screen_dump") {
        // Rust VRAM path: already_copied ⇒ 勿二次 OSC52/toast（对齐 Ink 单路径）
        const already = !!(msg as { already_copied?: boolean }).already_copied;
        const text = String(msg.text ?? "");
        if (already) {
          // Rust 已用「已复制整屏 N 字（L 行）· 可粘贴发给 AI」本地 toast
          pushState(undefined, true);
          return;
        }
        if (text) {
          try {
            const { copyToClipboard } = await import("../input/osc52.js");
            copyToClipboard(text);
            const lines = text.split("\n").length;
            useStore.getState().toastMsg(
              `已复制整屏 ${text.length} 字（${lines} 行）· 可粘贴发给 AI`,
              "ok",
            );
          } catch {
            useStore.getState().toastMsg("复制失败", "warn");
          }
        } else {
          useStore.getState().runCommand("screenshot");
        }
        pushState(undefined, true);
        return;
      }
      if (type === "event_block_toggle") {
        useStore.getState().toggleEventBlockExpanded();
        pushState(undefined, true);
        return;
      }
      if (type === "supervisor_scroll") {
        const dir = String(msg.dir ?? "down") === "up" ? "up" : "down";
        useStore.getState().scrollSupervisor(dir);
        return;
      }
      if (type === "sound_toggle") {
        const en = !cli.sound.isEnabled();
        cli.sound.updateConfig({ enabled: en });
        useStore.getState().toastMsg(en ? "🔊 音效已开启" : "🔇 音效已关闭", "info");
        pushState(undefined, true);
        return;
      }
      if (type === "scroll_to_bottom") {
        useStore.getState().scrollToBottom();
        return;
      }
      if (type === "goal_action") {
        const act = String(msg.action ?? "");
        if (act === "confirm_plan") {
          useStore.getState().requestSend("确认");
        } else if (act === "confirm_pass") {
          useStore.getState().requestSend("通过");
        } else if (act === "exit") {
          useStore.getState().exitSupervisor();
          cli.abort();
        }
        refreshSupervisor();
        pushState(undefined, true);
        return;
      }
      if (type === "jump_prev_user") {
        // optional: analytics only; scroll handled in Rust
        return;
      }
      if (type === "log") {
        process.stderr.write(`[ratatui] ${String(msg.text ?? "")}\n`);
      }
    },
  );

  async function handleHotkey(key: string) {
    const store = useStore.getState();
    switch (key) {
      case "ctrl+k":
        store.setOverlay("command");
        break;
      case "ctrl+m":
        store.setOverlay("model");
        break;
      case "ctrl+,":
        store.setOverlay("settings");
        break;
      case "ctrl+n":
        cli.resetAgent();
        store.startNewSession({ clearScreen: true, toast: "新会话" });
        break;
      case "ctrl+e":
        session?.send({ type: "full_editor", text: lastInput });
        break;
      case "ctrl+g":
        store.runCommand("screenshot");
        break;
      case "ctrl+s": {
        const en = !cli.sound.isEnabled();
        cli.sound.updateConfig({ enabled: en });
        store.toastMsg(en ? "🔊 音效已开启" : "🔇 音效已关闭", "info");
        break;
      }
      case "shift+tab": {
        const next = store.cycleApprovalMode();
        store.toastMsg(`审核 · ${next}`, "info");
        break;
      }
      case "open_agents":
        store.setOverlay("agents");
        break;
      default:
        break;
    }
    pushState(undefined, true);
  }

  async function handleOverlayAction(action: string, value: string) {
    const store = useStore.getState();
    const kind = store.overlay;

    if (action === "close") {
      store.setOverlay(null);
      pushState(undefined, true);
      return;
    }

    if (action === "select" || action === "run") {
      if (kind === "command" || action === "run") {
        const id = value || action;
        if (id === "quit") {
          store.requestExit();
          session?.kill();
          return;
        }
        if (store.isLocalCommand(id)) {
          store.runCommand(id);
        } else {
          cli.runCommand(id);
        }
        if (id !== "model" && id !== "sessions" && id !== "settings" && id !== "agents" && id !== "help" && id !== "prompt") {
          store.setOverlay(null);
        }
        pushState(undefined, true);
        return;
      }
      if (kind === "model") {
        const [p, m] = value.split("\0");
        if (p && m) {
          store.setProviderModel(p, m);
          const preset = opts.config.getPreset(p, m) as {
            maxContext?: number;
            maxTokens?: number;
          };
          store.setAgentMeta(
            store.agentName,
            p,
            m,
            preset.maxContext ?? preset.maxTokens ?? 0,
          );
          store.toastMsg(`已切换 ${p}/${m}`, "ok");
        }
        store.setOverlay(null);
        pushState(undefined, true);
        return;
      }
      if (kind === "sessions") {
        const loaded = loadSessionMessages(value, cwd);
        if (loaded) {
          store.setMessages(loaded.messages);
          store.setSessionId(value);
          store.setAutoFollow(true);
          store.toastMsg(
            `已加载会话 ${value.slice(0, 8)}（${loaded.messages.length} 条）`,
            "ok",
          );
        } else {
          store.setSessionId(value);
        }
        store.setOverlay(null);
        pushState(undefined, true);
        return;
      }
      if (kind === "agents") {
        if (value === "__subs__") return;
        if (value.startsWith("sub:")) {
          store.toastMsg("子 agent 由 main agent 调度，无法独立切换", "info");
          store.setOverlay(null);
          pushState(undefined, true);
          return;
        }
        store.requestAgentSwitch(value);
        // 同步 reset handle
        cli.resetAgent();
        store.setOverlay(null);
        pushState(undefined, true);
        return;
      }
      if (kind === "settings") {
        if (value === "approval") {
          const next = store.cycleApprovalMode();
          store.toastMsg(`审核 · ${next}`, "info");
        } else if (value === "thinking") {
          store.runCommand("thinking");
        } else if (value === "sound") {
          await handleHotkey("ctrl+s");
          return;
        } else if (value === "help") {
          store.setOverlay("help");
          pushState(undefined, true);
          return;
        }
        store.setOverlay(null);
        pushState(undefined, true);
        return;
      }
    }

    // 命令面板直接 run id
    if (action && !kind) {
      cli.runCommand(action, value || undefined);
      pushState(undefined, true);
    }
  }

  const unsubExit = useStore.subscribe((s) => {
    if (s.exitRequested) session?.kill();
  });

  // agent 切换 nonce
  let lastSwitch = useStore.getState().agentSwitchNonce;
  const unsubSwitch = useStore.subscribe((s) => {
    if (s.agentSwitchNonce !== lastSwitch) {
      lastSwitch = s.agentSwitchNonce;
      const name = s.pendingAgentName;
      if (name) {
        cli.resetAgent();
        // useAgent 逻辑：restore
        const cur = s.agentName;
        if (cur && cur !== name) s.saveCurrentSession(cur);
        const restored = s.restoreSession(name);
        if (!restored) s.clearMessages();
        s.clearPendingMessages();
        s.setAgentMeta(name, "", "", 0);
        if (!restored) {
          s.setSessionId(null);
          s.toastMsg(`切换到 ${name}（新会话）`, "ok");
        }
        s.clearPendingAgentSwitch();
        s.setOverlay(null);
      }
    }
  });

  try {
    const code = await session.wait();
    if (code !== 0) {
      process.stderr.write(`[maou] ratatui exit code ${code}\n`);
    }
  } finally {
    if (pushTimer) clearTimeout(pushTimer);
    unsubPerf?.();
    unsub();
    unsubExit();
    unsubSwitch();
    unsubPending();
    registerAbortStream(null);
    cancelAllTerminalApprovals("ratatui exit");
    uninstallCliTerminalApprover();
    cli.dispose();
  }
}
