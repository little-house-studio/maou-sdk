/**
 * Maou CLI 主应用。
 * ThemeProvider + Layout + useAgent + 全局按键（Ctrl+C/K/M/N/G/E + Esc）。
 * 全屏编辑器 / 命令面板通过 store 状态驱动 overlay。
 */

import React, { useState, useEffect } from "react";
import { useApp } from "ink";
import { ThemeProvider, TAU_CETI } from "./theme/theme-context.js";
import type { ThemeTokens } from "./theme/tokens.js";
import { watchThemes, loadThemeFile } from "./theme/hot-reload.js";
import { Layout } from "./layout/Layout.js";
import { useCleanInput } from "./hooks/useCleanInput.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { openExternalEditor } from "./hooks/useExternalEditor.js";
import { useStore } from "./state/store.js";
import { useAgent } from "./events/useAgent.js";
import { useMouseInput } from "./input/useMouseInput.js";
import type { LayoutRect } from "./input/hit-test.js";
import type { AgentCliConfig } from "./types.js";

export function App({ config, themePath }: { config: AgentCliConfig; themePath?: string }) {
  const { exit } = useApp();
  const { send, abort } = useAgent(config);
  const [frame, setFrame] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [theme, setTheme] = useState<ThemeTokens>(() => themePath ? (loadThemeFile(themePath) ?? TAU_CETI) : TAU_CETI);
  const streaming = useStore((s) => s.streaming);
  const overlay = useStore((s) => s.overlay);
  const fullEditorInitial = useStore((s) => s.fullEditorInitial);
  const pendingSubmit = useStore((s) => s.pendingSubmit);
  const fullEditorResult = useStore((s) => s.fullEditorResult);
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

  // 动画帧：仅流式时（spinner/REC 闪烁）
  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => setFrame(f => f + 1), 200);
    return () => clearInterval(id);
  }, [streaming]);

  // 退出请求 → 调 Ink exit
  useEffect(() => {
    if (exitRequested) exit();
  }, [exitRequested, exit]);

  // 主题热重载：~/.maou/themes/*.json 变更即时换色
  useEffect(() => {
    return watchThemes((t) => setTheme(t));
  }, []);

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

  // 鼠标：MAOU_MOUSE=1 开启点击移光标/拖选OSC52/滚轮。
  // filtered-stdin 已剥离 SGR 防止 react-ink-textarea 乱码，可安全开鼠标。
  const mouseEnabled = process.env.MAOU_MOUSE === "1";
  // 全屏编辑器开时切换鼠标 rect：输入框不再在底部，全屏文本区占据整屏。
  const fullEditorOpen = fullEditorInitial !== null;
  const mouseRect: LayoutRect = fullEditorOpen
    ? { inputRowFromBottom: 0, chatTop: 2, chatBottom: term.rows - 3 }
    : { inputRowFromBottom: 2, chatTop: 2, chatBottom: term.rows - 3 };
  useMouseInput(mouseEnabled, mouseRect, {
    onInputCursor: (col) => { useStore.getState().setMouseCursorCol(col); },
    onChatScroll: (dir) => {
      // 全屏编辑器开时，滚轮走 onInputScroll（移光标让全屏 textarea 滚动）
      if (fullEditorOpen) useStore.getState().shiftInputCursor(dir);
      else useStore.getState().scrollChat(dir);
    },
    onInputScroll: (dir) => { useStore.getState().shiftInputCursor(dir); },
    onSelectText: (text) => useStore.getState().toastMsg(`已复制 ${text.length} 字`, "ok"),
  });

  // 全局快捷键（全屏编辑器开时由 FullScreenEditor 自己处理，不干预）
  useCleanInput((char, key) => {
    if (fullEditorInitial !== null) return;
    if (key.ctrl && char === "c") { exit(); return; }
    if (key.escape) {
      if (overlay) { useStore.getState().setOverlay(null); return; }
      if (streaming) { abort(); return; }
      return;
    }
    if (overlay) return;
    // Shift+Tab 循环思考级别（react-ink-textarea 的 Tab 用于补全，Shift+Tab 这里捕获）
    if (key.tab && key.shift) {
      const cur = useStore.getState().thinkingLevel;
      useStore.getState().setThinking((cur + 1) % 6);
      return;
    }
    if (key.ctrl && char === "k") { useStore.getState().setOverlay("command"); return; }
    if (key.ctrl && char === "m") { useStore.getState().setOverlay("model"); return; }
    if (key.ctrl && char === "n") { useStore.getState().clearMessages(); useStore.getState().toastMsg("新会话", "ok"); return; }
    if (key.ctrl && char === "g") {
      const edited = openExternalEditor(inputValue);
      if (edited !== null) { setInputValue(edited); useStore.getState().toastMsg("已从编辑器读取", "ok"); }
      return;
    }
    // Ctrl+E 触发全屏编辑器（react-ink-textarea 已禁用其默认行尾行为）
    if (key.ctrl && char === "e") { useStore.getState().openFullEditor(inputValue); return; }
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
      <Layout frame={frame} value={inputValue} config={config} onSubmit={handleSubmit} onInputChange={setInputValue} onFullEditor={handleFullEditor} />
    </ThemeProvider>
  );
}
