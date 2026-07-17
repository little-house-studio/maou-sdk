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
import {
  resolveThemeArg,
  setActiveTheme,
  loadThemeById,
  type LoadedTheme,
} from "../theme/load-theme.js";
import {
  installCliTerminalApprover,
  uninstallCliTerminalApprover,
  cancelAllTerminalApprovals,
  answerTerminalApproval,
} from "../input/terminal-approval.js";
import {
  pickGalleryWork,
  pickGallerySize,
  formatPlaque,
  shouldShowGalleryArt,
} from "../gallery/catalog.js";
import { loadFramedArt } from "../gallery/load-art.js";
import { SUPERVISOR_MANAGER } from "@little-house-studio/agent";
import type { SupervisorState } from "../state/types.js";
import {
  handleEscapeCancel,
  registerAbortStream,
} from "../hooks/escape-cancel.js";
import { ensurePerfHudSampler } from "../headless/perf-hud-lines.js";
import { notePaintFrame } from "../hooks/process-stats.js";
import { resolveKeyBinding } from "../config/keybindings.js";
import { commandOpensOverlay } from "../config/cli-commands.js";

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
  /** 可热切换；snapshot / ProtoTheme 读此引用 */
  let activeTheme: LoadedTheme = resolveThemeArg(opts.themePath);
  setActiveTheme(activeTheme, false);

  const cli = createCliSession({
    config: opts.config,
    cwd,
    restoreLastSession: true,
    sound: true,
  });
  await cli.boot();

  // Mark active backend ASAP so any Node CSI path (clear/viewport/exit) no-ops
  const { markRatatuiActive } = await import("./config.js");
  markRatatuiActive();

  installCliTerminalApprover();
  refreshSupervisor();
  registerAbortStream(() => cli.abort());

  // 展开状态（工具卡 / thinking / 长消息）—— 与 Ink 本地 useState 对等
  const expandedTools = new Set<string>();
  const expandedThinking = new Set<string>();
  /** 历史轮：用户点开全文 */
  const expandedMsgs = new Set<string>();
  /** 最新轮：用户点收纳（默认开） */
  const collapsedMsgs = new Set<string>();

  // PerfHud: keep process-stats sampler alive; refresh chrome every ~2s
  let unsubPerf: (() => void) | null = null;

  // 输入草稿由 Rust 持有；补全在 Node 算
  let lastInput = "";
  let lastCursor = 0;
  /** 历史浏览前暂存的草稿（Ink savedInputRef） */
  let historyDraft: string | null = null;
  /** 模型二级菜单：当前 provider；null=provider 列表 */
  let modelProvider: string | null = null;
  /** prompt 阅读框当前分段 */
  let promptSectionIndex = 0;
  let lastOverlayKind: string | null = null;

  let session: RatatuiSession | null = null;
  let lastSig = "";
  let lastScreenEpoch = useStore.getState().screenEpoch ?? 0;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;

  function galleryLines(seed: string): string[] {
    try {
      // Logo 由 Ratatui 左上自绘（Ink GallerySplash ①）；此处只送画 + 铭牌
      const work = pickGalleryWork(seed);
      const cols = Math.max(40, process.stdout.columns || 100);
      const termRows = Math.max(16, process.stdout.rows || 30);
      // 与 Ink contentRows 接近：底栏 ≈8；logo 固定 5 行不进 hang
      const contentRows = Math.max(0, termRows - 8);
      const logoH = 5;
      const hangArea = Math.max(0, contentRows - logoH);
      // 太矮：不送油画（Ratatui 只画 logo）
      if (!shouldShowGalleryArt(hangArea)) return [];
      const size = pickGallerySize(cols, Math.min(contentRows, 28));
      const art = loadFramedArt(work.id, size) ?? [];
      const maxArt = Math.min(art.length, Math.max(12, hangArea - 4));
      const plaque = formatPlaque(work);
      return [
        ...art.slice(0, maxArt),
        "",
        ...plaque,
        `gallery · ${size}`,
      ];
    } catch {
      return [];
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

  function snapshotOpts(s: UIState, input?: string, fullPaint = false) {
    const overlay = buildOverlay(s.overlay, opts.config, s.agentName, {
      modelProvider,
      promptSectionIndex,
    });
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
      collapsedMsgs,
      theme: activeTheme.tokens,
      overlay,
      completions: comps,
      input: input ?? lastInput,
      gallery_lines:
        s.messages.length === 0 ? galleryLines(s.gallerySeed || "boot") : undefined,
      full_paint: fullPaint || undefined,
    };
  }

  const pushState = (state?: UIState, force = false) => {
    if (session?.isDead?.()) return;
    const s = state ?? cli.getState();
    // 新打开 model/prompt 时重置多级状态；关闭时清理
    const ov = (s.overlay as string | null) ?? null;
    if (ov === "model" && lastOverlayKind !== "model") {
      modelProvider = null;
    } else if (ov === "prompt" && lastOverlayKind !== "prompt") {
      promptSectionIndex = 0;
    } else if (ov == null && lastOverlayKind != null) {
      modelProvider = null;
      promptSectionIndex = 0;
    }
    lastOverlayKind = ov;
    const epoch = s.screenEpoch ?? 0;
    const epochBump = epoch !== lastScreenEpoch;
    if (epochBump) lastScreenEpoch = epoch;
    // Only epoch bump (/new · clear-screen) requests hard full_paint — not every force push
    // (settings toggle / overlay refresh would flash the whole screen otherwise).
    const fullPaint = epochBump;
    const msg = buildFullState(s, snapshotOpts(s, undefined, fullPaint));
    // 含 token/rounds：否则会话恢复或轮次结束后 InfoBar 会一直 0/假值（不热更）
    const lastRound = s.rounds?.[s.rounds.length - 1];
    const ctxTok = lastRound
      ? (lastRound.total ?? lastRound.input + lastRound.output)
      : (s.currentRoundUsage?.input ?? 0) + (s.currentRoundUsage?.output ?? 0);
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
      epoch,
      s.gallerySeed ?? "",
      s.perfHud ? 1 : 0,
      s.rounds?.length ?? 0,
      s.maxContext ?? 0,
      ctxTok,
      s.eventBlock?.upTokens ?? 0,
      s.eventBlock?.downTokens ?? 0,
      s.systemEvents?.length ?? 0,
    ].join("|");
    if (!force && !epochBump && sig === lastSig) return;
    lastSig = sig;
    // Approx paint ticks for process-stats fps (Ink notes real paint frames)
    notePaintFrame();
    session?.send(msg);
  };

  // PerfHud sampler (~2s) → force chrome refresh with cpu/mem/verdict
  // 注意：session 尚未 spawn，采样回调里的 push 要等 ready 后才生效
  try {
    const { setProcessStatsHudEnabled } = await import("../hooks/process-stats.js");
    setProcessStatsHudEnabled(useStore.getState().perfHud !== false);
  } catch {
    /* ignore */
  }
  unsubPerf = ensurePerfHudSampler(() => {
    if (!session || session.isDead?.()) return;
    lastSig = "";
    pushState(undefined, true);
  });

  // 永远读最新 store，禁止闭包冻旧 state（否则 Submit 后 24ms 旧快照会抹掉刚 push 的 user 消息）
  const schedulePush = () => {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      pushState(undefined);
    }, 24);
  };
  const cancelScheduledPush = () => {
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
  };

  // 只在 nonce 递增时查 SDK（对齐 useSupervisorState 的 checkNonce 依赖）
  let lastSupervisorCheckNonce = useStore.getState().supervisorCheckNonce ?? 0;
  const unsub = cli.subscribe((_state) => {
    // tool_result/done 后同步监督状态（对齐 useSupervisorState）
    const state = cli.getState();
    const nonce = state.supervisorCheckNonce ?? 0;
    if (nonce !== lastSupervisorCheckNonce) {
      lastSupervisorCheckNonce = nonce;
      refreshSupervisor();
    }
    schedulePush();
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
        // 子进程就绪：立刻推含 perf_lines 的完整 state（采样器已在 boot 时 tick）
        lastSig = "";
        pushState(undefined, true);
        // 再短延迟推一次，覆盖首个 2s 窗后的 mem/cpu
        setTimeout(() => {
          if (!session || session.isDead?.()) return;
          lastSig = "";
          pushState(undefined, true);
        }, 100);
        return;
      }
      if (type === "quit") {
        // Ink: requestExit + process.exit — 仅 kill 子进程会卡在 wait/finally 后仍挂着
        try {
          useStore.getState().requestExit();
          useStore.getState().toastMsg("正在退出…", "ok");
        } catch {
          /* ignore */
        }
        session?.kill();
        setTimeout(() => {
          try {
            process.exit(0);
          } catch {
            /* ignore */
          }
        }, 80);
        return;
      }
      if (type === "abort") {
        cli.abort();
        return;
      }
      if (type === "escape") {
        // 模型二级：Esc 先回 provider 列表
        if (useStore.getState().overlay === "model" && modelProvider) {
          modelProvider = null;
          lastSig = "";
          pushState(undefined, true);
          return;
        }
        // 与 Ink 同一套 Esc 分层栈（escape-cancel.ts）
        const r = handleEscapeCancel();
        if (r.handled) {
          if (r.action === "abort_stream") {
            // abortStreamHandler already called cli.abort via registerAbortStream
          }
          // 关 overlay 时清多级状态
          if (useStore.getState().overlay == null) {
            modelProvider = null;
            promptSectionIndex = 0;
          }
          lastSig = "";
          pushState(undefined, true);
        }
        return;
      }
      if (type === "submit") {
        // 勿 bumpScreenEpoch：full_paint 会让发送后卡顿数秒；Ratatui 自行管理 viewport
        const text = String(msg.text ?? "");
        lastInput = "";
        lastCursor = 0;
        if (!text.trim()) return;
        // 发送即写入历史（浏览历史时不再 push）
        useStore.getState().pushInputHistory(text);
        useStore.getState().resetHistoryIndex();
        historyDraft = null;
        // 取消 pending 旧快照，避免覆盖刚 append 的 user 消息
        cancelScheduledPush();
        // send() 同步段会 pushUserMessage；勿 await 整轮 agent，先推 UI
        const sendP = cli.send(text);
        lastSig = "";
        pushState(undefined, true);
        void sendP.finally(() => {
          lastSig = "";
          pushState(undefined, true);
        });
        return;
      }
      if (type === "input_update") {
        const nextText = String(msg.text ?? "");
        const nextCursor = Number(msg.cursor ?? nextText.length) || 0;
        // 浏览历史时：仅文本相对历史条目真正变化才退出；光标移动不 reset（对齐 Ink applyingHistory）
        const stHist = useStore.getState();
        if (stHist.historyIndex >= 0) {
          const histEntry = stHist.inputHistory[stHist.historyIndex];
          if (histEntry !== undefined && nextText !== histEntry) {
            stHist.resetHistoryIndex();
            historyDraft = null;
          }
        }
        lastInput = nextText;
        lastCursor = nextCursor;
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
        // 仅首次 ↑ 进入历史时暂存草稿；浏览过程中绝不 push（否则会把草稿顶进历史末尾导致死循环）
        if (dir === "up" && st.historyIndex < 0) {
          historyDraft = lastInput;
        }
        // 已在最早一条再 ↑：不动（避免同文反复 input_set 像死循环）
        if (dir === "up" && st.historyIndex === 0) {
          return;
        }
        const h = useStore.getState().navigateHistory(dir);
        if (h != null) {
          // 下键超出历史末尾 → 恢复草稿（Ink savedInputRef）
          if (h === "" && dir === "down") {
            lastInput = historyDraft ?? "";
            historyDraft = null;
          } else {
            lastInput = h;
          }
          // ↑ 进历史：光标置最前；↓ 下一条：光标到文末
          lastCursor = dir === "up" ? 0 : lastInput.length;
          session?.send({ type: "input_set", text: lastInput, cursor: lastCursor });
        }
        return;
      }
      if (type === "command") {
        // Nav / palette: open local overlay or run slash (Ink NavBar + runCommand)
        const id = String(msg.id ?? msg.action ?? "");
        const args = msg.args != null ? String(msg.args) : undefined;
        if (!id) return;
        const store = useStore.getState();
        if (store.isLocalCommand(id)) {
          store.runCommand(id);
        } else if (id === "new" || id === "clear") {
          store.runCommand(id);
        } else {
          try {
            cli.runCommand(id, args);
          } catch {
            store.toastMsg(`未知命令: ${id}`, "warn");
          }
        }
        lastSig = "";
        pushState(undefined, true);
        return;
      }
      if (type === "overlay_action") {
        const action = String(msg.action ?? "");
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
        if (!mid) return;
        // 最新轮默认展开：点一下 → 收纳；历史轮默认收：点一下 → 展开
        const msgs = useStore.getState().messages;
        let lastHuman = -1;
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]!;
          if (m.role !== "user") continue;
          const kind = m.kind ?? "human_user";
          if (
            kind === "system_notice" ||
            kind === "runtime_control" ||
            kind === "agent_message" ||
            kind === "compact" ||
            kind === "unknown"
          ) {
            continue;
          }
          lastHuman = i;
          break;
        }
        const idx = msgs.findIndex((m) => m.id === mid);
        const inLatest = lastHuman < 0 || idx >= lastHuman;
        if (inLatest) {
          if (collapsedMsgs.has(mid)) collapsedMsgs.delete(mid);
          else {
            collapsedMsgs.add(mid);
            expandedMsgs.delete(mid);
          }
        } else {
          if (expandedMsgs.has(mid)) expandedMsgs.delete(mid);
          else {
            expandedMsgs.add(mid);
            collapsedMsgs.delete(mid);
          }
        }
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

  // 子进程异常退出时立刻停掉后续 push，并提示退出码（避免干到一半只看到 EPIPE）
  session.child.on("exit", (code, signal) => {
    cancelScheduledPush();
    if (code && code !== 0) {
      try {
        process.stderr.write(
          `[maou] ratatui 子进程退出 code=${code}${signal ? ` signal=${signal}` : ""}\n` +
            `  若频繁闪退，请把 [ratatui] 日志贴出排查，或重编：npm run build:tui-ratatui\n`,
        );
      } catch {
        /* ignore */
      }
    }
  });

  async function handleHotkey(key: string) {
    const store = useStore.getState();
    const kb = resolveKeyBinding(key);

    if (kb?.commandId) {
      if (kb.commandId === "new" || kb.commandId === "clear") {
        cli.resetAgent();
      }
      store.runCommand(kb.commandId);
      pushState(undefined, true);
      return;
    }

    switch (kb?.ui) {
      case "command_palette":
        store.setOverlay("command");
        break;
      case "full_editor":
        session?.send({ type: "full_editor", text: lastInput });
        break;
      case "toggle_sound": {
        const en = !cli.sound.isEnabled();
        cli.sound.updateConfig({ enabled: en });
        store.toastMsg(en ? "🔊 音效已开启" : "🔇 音效已关闭", "info");
        break;
      }
      case "cycle_approval": {
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
      modelProvider = null;
      promptSectionIndex = 0;
      pushState(undefined, true);
      return;
    }
    // prompt 分段切换
    if (kind === "prompt" && (action === "section_prev" || action === "section_next" || action === "section_goto")) {
      const ov = buildOverlay("prompt", opts.config, store.agentName, {
        promptSectionIndex,
      });
      const n = ov?.sections?.length ?? 0;
      if (n > 0) {
        if (action === "section_prev") {
          promptSectionIndex = (promptSectionIndex - 1 + n) % n;
        } else if (action === "section_next") {
          promptSectionIndex = (promptSectionIndex + 1) % n;
        } else {
          const g = Number(value);
          if (Number.isFinite(g)) {
            promptSectionIndex = Math.max(0, Math.min(Math.floor(g), n - 1));
          }
        }
      }
      lastSig = "";
      pushState(undefined, true);
      return;
    }

    if (action === "select" || action === "run") {
      if (kind === "command" || action === "run") {
        const id = value || action;
        if (id === "quit") {
          store.requestExit();
          store.toastMsg("正在退出…", "ok");
          session?.kill();
          setTimeout(() => process.exit(0), 80);
          return;
        }
        if (store.isLocalCommand(id)) {
          store.runCommand(id);
        } else {
          cli.runCommand(id);
        }
        // 打开 overlay 的指令由注册表判定，勿硬编码 id 列表
        if (!commandOpensOverlay(id)) {
          store.setOverlay(null);
        }
        pushState(undefined, true);
        return;
      }
      if (kind === "model") {
        // 一级：进入 provider
        if (value.startsWith("provider:")) {
          modelProvider = value.slice("provider:".length) || null;
          lastSig = "";
          pushState(undefined, true);
          return;
        }
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
        modelProvider = null;
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
        if (value === "model") {
          modelProvider = null;
          store.setOverlay("model");
          pushState(undefined, true);
          return;
        }
        if (value === "theme") {
          store.setOverlay("theme");
          pushState(undefined, true);
          return;
        }
        if (value === "approval") {
          const next = store.cycleApprovalMode();
          store.toastMsg(`审核 · ${next}`, "info");
        } else if (value === "thinking") {
          store.runCommand("thinking");
        } else if (value === "sound") {
          await handleHotkey("ctrl+s");
          return;
        } else if (value === "perf_hud") {
          const on = store.togglePerfHud();
          store.toastMsg(
            on ? "Debug 显示已开启（已保存）" : "Debug 显示已关闭（已保存）",
            "ok",
          );
          lastSig = "";
          pushState(undefined, true);
          return;
        } else if (value === "mouse") {
          const next = !store.mouseCapture;
          store.setMouseCapture(next);
          store.toastMsg(
            next ? "鼠标捕获已开启（已保存）" : "鼠标捕获已关闭（已保存）",
            "ok",
          );
          lastSig = "";
          pushState(undefined, true);
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
      if (kind === "theme") {
        const th = loadThemeById(value);
        if (th) {
          activeTheme = th;
          setActiveTheme(th, true);
          store.toastMsg(`配色 → ${th.name}`, "ok");
        } else {
          store.toastMsg(`未找到主题 ${value}`, "err");
        }
        store.setOverlay(null);
        lastSig = "";
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
    if (s.exitRequested) {
      session?.kill();
      setTimeout(() => process.exit(0), 80);
    }
  });

  // 父进程收到 Ctrl+C（TTY 共享时 SIGINT 可能到 Node 而非 TUI）→ 干净退出
  const onSigInt = () => {
    try {
      useStore.getState().requestExit();
    } catch {
      /* ignore */
    }
    session?.kill();
    setTimeout(() => process.exit(0), 50);
  };
  process.once("SIGINT", onSigInt);
  process.once("SIGTERM", onSigInt);

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
    process.off("SIGINT", onSigInt);
    process.off("SIGTERM", onSigInt);
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
  // 子进程结束后确保 CLI 退出（与 Ink requestExit 后 process.exit 一致）
  if (useStore.getState().exitRequested) {
    process.exit(0);
  }
}
