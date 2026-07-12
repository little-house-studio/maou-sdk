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
import { Layout } from "./layout/Layout.js";
import { useCleanInput } from "./hooks/useCleanInput.js";
import { useTerminalSize, TerminalSizeProvider } from "./hooks/useTerminalSize.js";
import { useStore, loadLastSession } from "./state/store.js";
import { loadSessionMessages } from "./state/session-loader.js";
import { useAgent } from "./events/useAgent.js";
import { useSupervisorState } from "./hooks/useSupervisorState.js";
import { useMouseInput } from "./input/useMouseInput.js";
import { extractSelection as vramExtract, clearSelection as vramClear, getSelection as vramGet, scheduleFullPaint, setThemeBg } from "./render/vram-layer.js";
import { copyToClipboard } from "./input/osc52.js";
import type { LayoutRect } from "./input/hit-test.js";
import type { AgentCliConfig } from "./types.js";

export function App({ config, themePath }: { config: AgentCliConfig; themePath?: string }) {
  const { exit } = useApp();
  const { send, abort, sound } = useAgent(config);
  useSupervisorState();
  const [frame, setFrame] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [theme, setTheme] = useState<ThemeTokens>(() => themePath ? (loadThemeFile(themePath) ?? TAU_CETI) : TAU_CETI);
  const streaming = useStore((s) => s.streaming);
  const overlay = useStore((s) => s.overlay);
  const fullEditorInitial = useStore((s) => s.fullEditorInitial);
  const pendingSubmit = useStore((s) => s.pendingSubmit);
  const fullEditorResult = useStore((s) => s.fullEditorResult);
  const pendingSend = useStore((s) => s.pendingSend);
  const exitRequested = useStore((s) => s.exitRequested);
  const setAgentMeta = useStore((s) => s.setAgentMeta);
  const term = useTerminalSize();

  // 初始化 provider/model/maxContext（从 config 拿真实值）
  useEffect(() => {
    const ps = config.getProviders?.() ?? [];
    if (ps.length > 0) {
      const ms = config.getModels?.(ps[0]!.id) ?? [];
      if (ms.length > 0) {
        const preset = config.getPreset(ps[0]!.id, ms[0]!.id) as { maxContext?: number; maxTokens?: number };
        const maxContext = preset.maxContext ?? preset.maxTokens ?? 0;
        setAgentMeta(config.name, ps[0]!.id, ms[0]!.id, maxContext);
      } else {
        setAgentMeta(config.name, ps[0]!.id, "", 0);
      }
    } else {
      setAgentMeta(config.name, "", "", 0);
    }
  }, [config, setAgentMeta]);

  // 启动自动加载上次会话（last-session.json 记录的 agent + sessionId）
  const didRestore = useRef(false);
  useEffect(() => {
    if (didRestore.current) return;
    didRestore.current = true;
    const last = loadLastSession();
    if (!last || last.agentName !== config.name) return;
    const loaded = loadSessionMessages(last.sessionId);
    if (loaded && loaded.messages.length > 0) {
      useStore.getState().setMessages(loaded.messages);
      useStore.getState().setSessionId(last.sessionId);
      useStore.getState().setAutoFollow(true);
    }
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
    return watchThemes((t) => setTheme(t));
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
  const mouseRect: LayoutRect = fullEditorOpen
    ? { inputRowFromBottom: 0, inputLineCount, chatTop: 2, chatBottom: term.rows - 3, inputRect, inputTextColOffset: 1 }
    : { inputRowFromBottom: 2, inputLineCount, chatTop: 2, chatBottom: term.rows - 3, inputRect, inputTextColOffset: 4 };

  useMouseInput(mouseEnabled, mouseRect, {
    onInputCursor: (col, line) => {
      useStore.getState().setMouseCursorCol(col);
      useStore.getState().setMouseCursorLine(line);
    },
    onChatScroll: (dir) => { useStore.getState().scrollChat(dir); },
    onInputScroll: (dir) => { useStore.getState().shiftInputCursor(dir); },
    onOverlayScroll: (dir) => { useStore.getState().scrollOverlay(dir); },
  });

  // 全局快捷键（全屏编辑器开时由 FullScreenEditor 自己处理，不干预）
  // Ctrl+C 分层逻辑：有选区→清选区 | streaming→中断/退出 | 空闲→双击退出
  const ctrlCAtRef = useRef(0);
  const ctrlCTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useCleanInput((char, key) => {
    if (fullEditorInitial !== null) return;
    // Ctrl+C 识别：key.ctrl+c / ETX(\x03) / 部分 Ink 只给 \x03 不置 ctrl
    const isCtrlC =
      char === "\x03" ||
      (key.ctrl && (char === "c" || char === "C" || char === "" || char == null));
    if (isCtrlC) {
      // 0. overlay 打开时：第一次 Ctrl+C 关 overlay（与 Esc 一致），不直接退
      const ov = useStore.getState().overlay;
      if (ov) {
        useStore.getState().setOverlay(null);
        useStore.getState().toastMsg("已关闭面板 · 再按 Ctrl+C 退出", "info");
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
      // 2. 有选区：清选区（松手已自动复制，这里只清蓝底，不退出）
      if (vramGet()) {
        vramClear();
        useStore.getState().toastMsg("已取消选区 · 再按 Ctrl+C 退出", "info");
        ctrlCAtRef.current = Date.now();
        return;
      }
      // 3. streaming（非监督）：第一次中断，3秒内第二次退出
      if (useStore.getState().streaming && !useStore.getState().aborting) {
        abort();
        ctrlCAtRef.current = Date.now();
        useStore.getState().toastMsg("已中断 · 再按一次 Ctrl+C 退出", "warn");
        return;
      }
      // 4. 空闲 / 已中断：双击确认退出（3 秒内）
      const now = Date.now();
      if (now - ctrlCAtRef.current < 3000) {
        if (ctrlCTimerRef.current) clearTimeout(ctrlCTimerRef.current);
        useStore.getState().toastMsg("正在退出…", "ok");
        useStore.getState().requestExit(); // → useApp().exit()，走 waitUntilExit 恢复备用屏
        // 兜底强退：给 Ink 极短时间 unmount；绝不能等 1s（用户体感「退出很慢」）
        // 终端恢复序列由 installExitGuard 的 process.on('exit') 保证
        setTimeout(() => process.exit(0), 50);
      } else {
        ctrlCAtRef.current = now;
        useStore.getState().toastMsg("再按一次 Ctrl+C 退出", "warn");
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
    // Esc / 裸 \x1b：优先关 overlay（用 getState 避免闭包陈旧）
    if (key.escape || char === "\x1b") {
      // 有选区先清蓝底，但若有 overlay 同一次 Esc 一并关闭（避免 /prompt 卡住）
      if (vramGet()) vramClear();
      if (useStore.getState().completion) {
        useStore.getState().closeCompletion();
        return;
      }
      const ov = useStore.getState().overlay;
      if (ov) {
        useStore.getState().setOverlay(null);
        return;
      }
      if (useStore.getState().streaming) {
        abort();
        return;
      }
      return;
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
    if (key.ctrl && char === "n") { useStore.getState().clearMessages(); useStore.getState().toastMsg("新会话", "ok"); return; }
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
    <ThemeProvider initial={theme}>
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
