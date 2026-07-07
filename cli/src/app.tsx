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
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { openExternalEditor } from "./hooks/useExternalEditor.js";
import { useStore } from "./state/store.js";
import { useAgent } from "./events/useAgent.js";
import { useMouseInput } from "./input/useMouseInput.js";
import { extractSelection } from "./input/screen-buffer.js";
import { osc52 } from "./input/osc52.js";
import type { LayoutRect } from "./input/hit-test.js";
import type { AgentCliConfig } from "./types.js";

export function App({ config, themePath }: { config: AgentCliConfig; themePath?: string }) {
  const { exit } = useApp();
  const { send, abort, sound } = useAgent(config);
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

  // 鼠标捕获：store.mouseCapture（运行时可切换）。Terminal.app 下 1000 模式与直接拖拽
  // 选字互斥，默认开鼠标功能，按 Ctrl+Shift+M 切换关闭以选字。
  const mouseCapture = useStore((s) => s.mouseCapture);
  const mouseEnabled = mouseCapture;
  // 全屏编辑器开时切换鼠标 rect：输入框不再在底部，全屏文本区占据整屏。
  const fullEditorOpen = fullEditorInitial !== null;
  const inputLineCount = useStore((s) => s.inputLineCount);
  const mouseRect: LayoutRect = fullEditorOpen
    ? { inputRowFromBottom: 0, inputLineCount, chatTop: 2, chatBottom: term.rows - 3 }
    : { inputRowFromBottom: 2, inputLineCount, chatTop: 2, chatBottom: term.rows - 3 };

  useMouseInput(mouseEnabled, mouseRect, {
    onInputCursor: (col, line) => {
      useStore.getState().setMouseCursorCol(col);
      useStore.getState().setMouseCursorLine(line);
    },
    onChatScroll: (dir) => { useStore.getState().scrollChat(dir); },
    onInputScroll: (dir) => { useStore.getState().shiftInputCursor(dir); },
  });

  // 全局快捷键（全屏编辑器开时由 FullScreenEditor 自己处理，不干预）
  // Ctrl+C 双击退出：第一次警告，3 秒内第二次退出（streaming 时第一次中断生成）
  const ctrlCAtRef = useRef(0);
  useCleanInput((char, key) => {
    if (fullEditorInitial !== null) return;
    if (key.ctrl && char === "c") {
      // 有选区：Ctrl+C 复制选区 + 清选区（不退出）
      const sel = useStore.getState().selection;
      if (sel) {
        const text = extractSelection(sel.start, sel.end);
        if (text && text.trim()) {
          osc52(text);
          useStore.getState().toastMsg(`已复制 ${text.length} 字`, "ok");
        }
        useStore.getState().setSelection(null);
        return;
      }
      // streaming 时：第一次 Ctrl+C 中断；非 streaming 或已中断后再按才走双击退出
      if (streaming && !useStore.getState().aborting) {
        abort();
        return;
      }
      const now = Date.now();
      if (now - ctrlCAtRef.current < 3000) {
        useStore.getState().requestExit();
      } else {
        ctrlCAtRef.current = now;
        useStore.getState().toastMsg("再按一次 Ctrl+C 退出", "warn");
      }
      return;
    }
    // Cmd+C（macOS）：Terminal.app 拦截不发到程序，但若终端转发（iTerm2 等），meta+c 触发复制
    if (key.meta && char === "c") {
      const sel = useStore.getState().selection;
      if (sel) {
        const text = extractSelection(sel.start, sel.end);
        if (text && text.trim()) {
          osc52(text);
          useStore.getState().toastMsg(`已复制 ${text.length} 字`, "ok");
        }
        useStore.getState().setSelection(null);
      }
      return;
    }
    if (key.escape) {
      // 有选区：Esc 清选区（优先级最高）
      if (useStore.getState().selection) { useStore.getState().setSelection(null); return; }
      // 补全菜单开时，Esc 关闭补全
      if (useStore.getState().completion) { useStore.getState().closeCompletion(); return; }
      if (overlay) { useStore.getState().setOverlay(null); return; }
      if (streaming) { abort(); return; }
      return;
    }
    // 补全菜单开时，上下键选菜单（InputBar 已禁用 Up/Down，按键冒泡到这里）
    if (useStore.getState().completion) {
      if (key.upArrow) { useStore.getState().cycleCompletion("up"); return; }
      if (key.downArrow) { useStore.getState().cycleCompletion("down"); return; }
    }
    // agents overlay 开时，→ 键返回聊天界面
    if (overlay === "agents" && key.rightArrow) { useStore.getState().setOverlay(null); return; }
    if (overlay) return;
    // Shift+Tab 循环思考级别（react-ink-textarea 的 Tab 用于补全，Shift+Tab 这里捕获）
    if (key.tab && key.shift) {
      const cur = useStore.getState().thinkingLevel;
      useStore.getState().setThinking((cur + 1) % 6);
      return;
    }
    if (key.ctrl && char === "k") { useStore.getState().setOverlay("command"); return; }
    if (key.ctrl && char === "m") { useStore.getState().setOverlay("model"); return; }
    if (key.ctrl && char === ",") { useStore.getState().setOverlay("settings"); return; }
    if (key.ctrl && char === "n") { useStore.getState().clearMessages(); useStore.getState().toastMsg("新会话", "ok"); return; }
    if (key.ctrl && char === "g") {
      const edited = openExternalEditor(inputValue);
      if (edited !== null) { setInputValue(edited); useStore.getState().toastMsg("已从编辑器读取", "ok"); }
      return;
    }
    // Ctrl+E 触发全屏编辑器（react-ink-textarea 已禁用其默认行尾行为）
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
      <Layout frame={frame} value={inputValue} config={config} onSubmit={handleSubmit} onInputChange={setInputValue} onFullEditor={handleFullEditor} />
    </ThemeProvider>
  );
}
