/**
 * Maou CLI 主应用。
 * ThemeProvider + Layout + useAgent + 全局按键（Ctrl+C/K/M/N/G/E + Esc）。
 * 全屏编辑器 / 命令面板通过 store 状态驱动 overlay。
 */

import React, { useState, useEffect, useRef } from "react";
import { useApp } from "ink";
import { ThemeProvider, TAU_CETI } from "./theme/theme-context.js";
import type { ThemeTokens } from "./theme/tokens.js";
import { watchThemes, loadThemeFile } from "./theme/hot-reload.js";
import {
  resolveThemeArg,
  setActiveTheme,
  type LoadedTheme,
} from "./theme/load-theme.js";

import { Layout } from "./layout/Layout.js";
import { useCleanInput } from "./hooks/useCleanInput.js";
import {
  handleEscapeCancel,
  isEscapeKey,
  registerAbortStream,
} from "./hooks/escape-cancel.js";
import { useTerminalSize, TerminalSizeProvider } from "./hooks/useTerminalSize.js";
import { useStore, loadLastSession } from "./state/store.js";
import { loadSessionMessages } from "./state/session-loader.js";
import { useAgent } from "./events/useAgent.js";
import { useSupervisorState } from "./hooks/useSupervisorState.js";
import { useMouseInput } from "./input/useMouseInput.js";
import {
  extractSelection as vramExtract,
  clearSelection as vramClear,
  getSelection as vramGet,
  scheduleFullPaint,
  setThemeBg,
} from "./render/vram-layer.js";
import { copyToClipboard } from "./input/osc52.js";
import { copyScreenDump, isScreenDumpHotkey } from "./lib/screen-dump.js";
import type { LayoutRect } from "./input/hit-test.js";
import type { AgentCliConfig } from "./types.js";
import {
  FULL_EDITOR_TEXT_COL_OFFSET,
  INPUT_TEXT_COL_OFFSET_DEFAULT,
} from "./config/ui-constants.js";
import {
  installCliTerminalApprover,
  uninstallCliTerminalApprover,
  cancelAllTerminalApprovals,
} from "./input/terminal-approval.js";

export function App({ config, themePath }: { config: AgentCliConfig; themePath?: string }) {
  const { exit } = useApp();
  const { send, abort, sound } = useAgent(config);
  useSupervisorState();

  // Esc / 统一取消栈：注册流式中断
  useEffect(() => {
    registerAbortStream(() => abort());
    return () => registerAbortStream(null);
  }, [abort]);

  // normal 模式终端审批：注入 tools 层 setTerminalApprover，阻塞直到用户点 Y/N
  useEffect(() => {
    installCliTerminalApprover();
    return () => {
      cancelAllTerminalApprovals("app unmount");
      uninstallCliTerminalApprover();
    };
  }, []);
  const [frame, setFrame] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [loadedTheme, setLoadedThemeState] = useState<LoadedTheme>(() => {
    const t = resolveThemeArg(themePath);
    setActiveTheme(t, false);
    return t;
  });
  const [theme, setTheme] = useState<ThemeTokens>(() => loadedTheme.tokens);
  const streaming = useStore((s) => s.streaming);
  const overlay = useStore((s) => s.overlay);
  const fullEditorInitial = useStore((s) => s.fullEditorInitial);
  const pendingSubmit = useStore((s) => s.pendingSubmit);
  const fullEditorResult = useStore((s) => s.fullEditorResult);
  const pendingSend = useStore((s) => s.pendingSend);
  const exitRequested = useStore((s) => s.exitRequested);
  const setAgentMeta = useStore((s) => s.setAgentMeta);
  const term = useTerminalSize();

  // 初始化 provider/model/maxContext：优先全局 api.roles.main，否则 presets 列表第一项
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { getRolePresetFromMaouConfig } = await import("@little-house-studio/agent");
        const main = getRolePresetFromMaouConfig("main") as {
          name?: string;
          model?: string;
          maxContext?: number;
          maxTokens?: number;
        } | undefined;
        if (cancelled) return;
        if (main?.name && main?.model) {
          const maxContext = main.maxContext ?? main.maxTokens ?? 0;
          // provider id 与 Completer/ModelDialog 一致：preset.name
          setAgentMeta(config.name, main.name, main.model, maxContext);
          return;
        }
      } catch {
        /* fall through */
      }
      if (cancelled) return;
      const ps = config.getProviders?.() ?? [];
      if (ps.length > 0) {
        const ms = config.getModels?.(ps[0]!.id) ?? [];
        if (ms.length > 0) {
          const preset = config.getPreset(ps[0]!.id, ms[0]!.id) as {
            maxContext?: number;
            maxTokens?: number;
          };
          const maxContext = preset.maxContext ?? preset.maxTokens ?? 0;
          setAgentMeta(config.name, ps[0]!.id, ms[0]!.id, maxContext);
        } else {
          setAgentMeta(config.name, ps[0]!.id, "", 0);
        }
      } else {
        setAgentMeta(config.name, "", "", 0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, setAgentMeta]);

  // 启动自动恢复「当前工作区」上次会话（.maou/last-session.json，按 cwd 隔离）
  // /new 会落盘空会话并改写 last-session：下次只绑 id、不恢复消息 → 画廊
  const didRestore = useRef(false);
  useEffect(() => {
    if (didRestore.current) return;
    didRestore.current = true;
    const cwd = process.cwd();
    const agent = config.name || "coding";
    const last = loadLastSession(cwd, agent);
    if (!last?.sessionId) return;

    // 始终先绑定指针 id（含 /new 空会话），避免后续 startSession 另开旧档
    useStore.getState().setSessionId(last.sessionId);

    const loaded = loadSessionMessages(last.sessionId, cwd);
    // 空文件 / 解析无消息：保持画廊，绝不另寻旧 jsonl
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
  }, [config.name]);

  // spinner 动画已局部化到 MessageRow/ToolCard（各自 interval），
  // 不再全 App 每 200ms 重渲（闪烁根因之一）。frame 仅作 fallback 静态值。
  void setFrame;

  // 生成结束（streaming true→false）时自动发送排队的下一条消息
  const prevStreaming = useRef(streaming);
  useEffect(() => {
    if (prevStreaming.current && !streaming) {
      const next = useStore.getState().drainPendingMessage();
      if (next) {
        // 异步触发，避免在 reducer/setState 回调里直接 send
        setTimeout(() => send(next), 0);
      }
    }
    prevStreaming.current = streaming;
  }, [streaming, send]);

  // 退出请求 → 调 Ink exit（兜底强退在 Ctrl+C 第二次按下时设，不挂 effect 避免被 unmount cleanup 清）
  useEffect(() => {
    if (!exitRequested) return;
    exit();
  }, [exitRequested, exit]);

  // 主题热重载：~/.maou/themes/*.json 变更即时换色
  useEffect(() => {
    return watchThemes((t) => {
      setTheme(t);
      setLoadedThemeState((prev) => ({ ...prev, tokens: t }));
    });
  }, []);

  // 同步当前主题 bg 到渲染层：渲染层是 React 外的同步函数，靠此 effect 接收主题。
  // 覆盖初始主题（默认 TAU_CETI / --theme 指定）、热重载、--theme 切换三种来源。
  useEffect(() => {
    setThemeBg(theme.bg);
  }, [theme]);

  // 全屏编辑器退出后：值带回 InputBar（pendingSubmit 则发送）
  useEffect(() => {
    if (pendingSubmit !== null) {
      send(pendingSubmit);
      useStore.getState().clearPendingSubmit();
      setInputValue("");
    } else if (fullEditorResult !== null) {
      setInputValue(fullEditorResult);
      useStore.getState().clearPendingSubmit();
    }
  }, [pendingSubmit, fullEditorResult, send]);

  // 通用发送桥接：组件（GoalPanel 确认按钮等）设 pendingSend，这里发出去
  useEffect(() => {
    if (pendingSend !== null) {
      send(pendingSend);
      useStore.getState().clearPendingSend();
    }
  }, [pendingSend, send]);

  // vram 方案：总是开 ?1003 鼠标（选区蓝底由 vram-layer 渲染）
  const mouseEnabled = true;
  // 全屏编辑器开时切换鼠标 rect：输入框不再在底部，全屏文本区占据整屏。
  const fullEditorOpen = fullEditorInitial !== null;
  const inputLineCount = useStore((s) => s.inputLineCount);
  const inputRect = useStore((s) => s.inputRect);
  // chatBottom 回退：底栏约 EventBlock+Input+Info+Nav≈4 行，再留余量；优先用 store.chatViewport
  const mouseRect: LayoutRect = fullEditorOpen
    ? { inputRowFromBottom: 0, inputLineCount, chatTop: 2, chatBottom: Math.max(4, term.rows - 4), inputRect, inputTextColOffset: FULL_EDITOR_TEXT_COL_OFFSET }
    : { inputRowFromBottom: 2, inputLineCount, chatTop: 2, chatBottom: Math.max(4, term.rows - 8), inputRect, inputTextColOffset: INPUT_TEXT_COL_OFFSET_DEFAULT };

  useMouseInput(mouseEnabled, mouseRect, {
    onInputCursor: (col, line) => {
      useStore.getState().setMouseCursorCol(col);
      useStore.getState().setMouseCursorLine(line);
    },
    onChatScroll: (dir) => { useStore.getState().scrollChat(dir); },
    onInputScroll: (dir) => { useStore.getState().shiftInputCursor(dir); },
    onOverlayScroll: (dir) => { useStore.getState().scrollOverlay(dir); },
  });

  // 全局快捷键
  // Esc：统一取消/返回/关闭（见 escape-cancel.ts，全场景一层回退）
  // Ctrl+C：有可取消层时等同 Esc；否则 streaming 停任务；空闲双击退出
  const ctrlCAtRef = useRef(0);
  const ctrlCTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useCleanInput((char, key) => {
    // Esc 任何场景都走统一取消栈（含全屏编辑器）
    if (isEscapeKey(char, key)) {
      handleEscapeCancel();
      return;
    }

    // 整屏文字截图 → 剪贴板（排查 UI 时一键发给 AI）
    // macOS 经典终端几乎不传 Ctrl+Shift 的 shift 位，主绑定用 Ctrl+G
    // 放在 fullEditor 短路之前，编辑器/弹层打开时也能 dump
    if (isScreenDumpHotkey(char ?? "", key)) {
      const r = copyScreenDump();
      if (r.ok) {
        useStore.getState().toastMsg(
          `已复制整屏 ${r.chars} 字（${r.lines} 行）· 可粘贴发给 AI`,
          "ok",
        );
      } else {
        useStore.getState().toastMsg(r.message, "warn");
      }
      return;
    }

    // 全屏编辑器其余键由 FullScreenEditor 处理
    if (useStore.getState().fullEditorInitial !== null) return;

    // Ctrl+C 识别：key.ctrl+c / ETX(\x03) / 部分 Ink 只给 \x03 不置 ctrl
    const isCtrlC =
      char === "\x03" ||
      (key.ctrl && (char === "c" || char === "C" || char === "" || char == null));
    if (isCtrlC) {
      // 0. 有可取消层时：与 Esc 同一栈（关面板/清选区/停任务等），不直接退
      const esc = handleEscapeCancel();
      if (esc.handled) {
        if (esc.action === "overlay" || esc.action === "nested_back") {
          useStore.getState().toastMsg("已关闭面板 · 再按 Ctrl+C 退出", "info");
        } else if (esc.action === "screen_selection" || esc.action === "input_selection") {
          useStore.getState().toastMsg("已取消选区 · 再按 Ctrl+C 退出", "info");
        } else if (esc.action === "abort_stream") {
          useStore.getState().toastMsg("已停止当前上下文中的任务", "warn");
        } else if (esc.action === "terminal_approval") {
          useStore.getState().toastMsg("已拒绝命令", "info");
        }
        ctrlCAtRef.current = Date.now();
        return;
      }
      // 1. supervisor 残留：Ctrl+C 第一次中断+提示，第二次强制清（不退 CLI）
      if (useStore.getState().supervisor) {
        const now = Date.now();
        if (now - ctrlCAtRef.current < 3000) {
          if (ctrlCTimerRef.current) clearTimeout(ctrlCTimerRef.current);
          abort();
          useStore.getState().exitSupervisor();
          useStore.getState().toastMsg("已退出监督模式", "ok");
        } else {
          abort();
          ctrlCAtRef.current = now;
          useStore.getState().toastMsg("已中断 · 再按一次 Ctrl+C 退出监督", "warn");
        }
        return;
      }
      // 2. 空闲：双击确认退出界面（3 秒内）
      const now = Date.now();
      if (now - ctrlCAtRef.current < 3000) {
        if (ctrlCTimerRef.current) clearTimeout(ctrlCTimerRef.current);
        useStore.getState().toastMsg("正在退出…", "ok");
        useStore.getState().requestExit();
        setTimeout(() => process.exit(0), 50);
      } else {
        ctrlCAtRef.current = now;
        useStore.getState().toastMsg("再按一次 Ctrl+C 退出界面", "warn");
        if (ctrlCTimerRef.current) clearTimeout(ctrlCTimerRef.current);
        ctrlCTimerRef.current = setTimeout(() => {
          if (Date.now() - ctrlCAtRef.current >= 2900) {
            useStore.getState().toastMsg("", "info");
            scheduleFullPaint();
          }
        }, 3000);
      }
      return;
    }
    // Cmd+C / meta+c：复制选区（Terminal.app 常拦截；iTerm/Kitty 等可到）
    if (key.meta && char === "c") {
      const sel = vramGet();
      if (sel) {
        const text = vramExtract();
        if (text && text.trim()) {
          copyToClipboard(text);
          useStore.getState().toastMsg(`已复制 ${text.length} 字`, "ok");
        }
        vramClear();
      }
      return;
    }
    // Ctrl+Shift+C 常见终端复制绑定（部分终端会转发）
    if (key.ctrl && key.shift && (char === "c" || char === "C")) {
      const sel = vramGet();
      if (sel) {
        const text = vramExtract();
        if (text && text.trim()) {
          copyToClipboard(text);
          useStore.getState().toastMsg(`已复制 ${text.length} 字`, "ok");
        }
        return;
      }
    }
    // 补全菜单开时：上下键只在这里 cycle 一次（InputBar 已 disable Up/Down，避免双跳）
    if (useStore.getState().completion?.items?.length) {
      if (key.upArrow) {
        useStore.getState().cycleCompletion("up");
        return;
      }
      if (key.downArrow) {
        useStore.getState().cycleCompletion("down");
        return;
      }
      // Tab 在 TextArea onTab；这里兜底
      if (key.tab && !key.shift) {
        // 交给 InputBar 的 onTab；若未触发则不处理
        return;
      }
    }
    // agents overlay 开时，→ 键返回聊天界面
    if (useStore.getState().overlay === "agents" && key.rightArrow) {
      useStore.getState().setOverlay(null);
      return;
    }
    if (useStore.getState().overlay) return;
    // Shift+Tab 循环审核模式 normal → auto → yolo（Tab 仍给补全）
    if (key.tab && key.shift) {
      const next = useStore.getState().cycleApprovalMode();
      const labels: Record<string, string> = {
        normal: "询问（每次确认）",
        auto: "自动（小模型审核）",
        yolo: "全放（不问）",
      };
      useStore.getState().toastMsg(`审核 · ${labels[next] ?? next}`, "info");
      return;
    }
    if (key.ctrl && char === "k") { useStore.getState().setOverlay("command"); return; }
    if (key.ctrl && char === "m") { useStore.getState().setOverlay("model"); return; }
    if (key.ctrl && char === ",") { useStore.getState().setOverlay("settings"); return; }
    if (key.ctrl && char === "n") {
      useStore.getState().startNewSession({ clearScreen: true, toast: "新会话" });
      return;
    }
    // Ctrl+E 触发全屏编辑器（react-ink-textarea 已禁用其默认行尾行为）
    // 外部 $EDITOR（原 Ctrl+G）已移除，旧实现见 legacy/pre-lib-migration/hooks/useExternalEditor.ts
    if (key.ctrl && char === "e") { useStore.getState().openFullEditor(inputValue); return; }
    // Ctrl+S 切换音效开/关
    if (key.ctrl && char === "s") {
      const newState = !sound.isEnabled();
      sound.updateConfig({ enabled: newState });
      useStore.getState().toastMsg(newState ? "🔊 音效已开启" : "🔇 音效已关闭", "info");
      return;
    }
  });

  const handleSubmit = (text: string) => {
    setInputValue("");
    send(text);
  };

  const handleFullEditor = (initial: string) => {
    useStore.getState().openFullEditor(initial || inputValue);
  };

  return (
    <ThemeProvider initial={theme} initialLoaded={loadedTheme}>
      {/* 登记 fakeStdout + 单例 resize/SIGWINCH → 全树自适应 */}
      <TerminalSizeProvider>
        <Layout
          frame={frame}
          value={inputValue}
          config={config}
          onSubmit={handleSubmit}
          onInputChange={setInputValue}
          onFullEditor={handleFullEditor}
        />
      </TerminalSizeProvider>
    </ThemeProvider>
  );
}
