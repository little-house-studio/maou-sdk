/** Maou CLI 主应用 —— 响应式布局 + 键盘 + (可toggle)鼠标 + 流式驱动（通用框架，接 AgentCliConfig） */
import React, { useState, useEffect, useRef } from "react";
import { useApp } from "ink";
import { Box } from "ink";
import { useStdout } from "ink";
import { currentTheme, setTheme, THEMES } from "./theme.js";
import { useStore, setConfig } from "./state/store.js";
import { runAgentCli } from "@little-house-studio/agent";
import type { AgentCliConfig } from "./types.js";
import { TopBar, Sidebar, Hud, StatusBar, Toast } from "./components/Hud.js";
import { ChatView } from "./components/Chat.js";
import { InputBox, colToCharIndex } from "./components/InputBox.js";
import { Panel } from "./components/Panel.js";
import { Collapsible } from "./components/Collapsible.js";
import { ModelPicker, CommandPalette, HelpModal, SessionPicker } from "./components/Modals.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { useMouse } from "./hooks/useMouse.js";
import { useCleanInput } from "./hooks/useCleanInput.js";
import { useImeCursor } from "./hooks/useImeCursor.js";
import { openExternalEditor } from "./hooks/useExternalEditor.js";
import { osc52 } from "./clipboard.js";
import { join } from "node:path";

type Focus = "input" | "sidebar" | "hud" | "chat";

export function App({ config }: { config: AgentCliConfig }) {
  setConfig(config); // 全局缓存供 Modals 等组件读取
  const { exit } = useApp();
  const term = useTerminalSize();
  const { stdout } = useStdout();
  const store = useStore();
  const [input, setInput] = useState("");
  const [cursor, setCursor] = useState(0);
  const [focus, setFocus] = useState<Focus>("input");
  // agent 句柄缓存（首次 doSend 时创建）
  const agentRef = useRef<ReturnType<AgentCliConfig["createAgent"]> | null>(null);
  const maouRoot = join(process.env.HOME ?? "", ".maou");
  const [frame, setFrame] = useState(0);
  const [mouseOn, setMouseOn] = useState(false); // 默认关 → 终端原生可拖选复制
  const [chatOffset, setChatOffset] = useState(0); // 对话滚动（消息粒度，0=最新）
  const [sel, setSel] = useState<[number, number] | null>(null); // 输入框选区
  const selAnchor = useRef<number | null>(null);
  const dragged = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const cols = term.cols;
  const rows = term.rows;
  // 响应式：窄屏自动折叠（与用户手动开关取交集）
  const sidebarVisible = store.sidebarOpen && term.showSidebar;
  const hudVisible = store.hudOpen && term.showHud;
  const inputColOffset = 4; // 输入框文本起始列（border+pad+"❯ "）

  // 动画帧循环 —— 仅在流式输出/HUD可见时运行（避免静态时重渲染打断终端框选）
  useEffect(() => {
    if (!store.streaming && !hudVisible) return;
    const id = setInterval(() => { setFrame((f) => f + 1); store.tickWire(); }, 150);
    return () => clearInterval(id);
  }, [store.streaming, hudVisible]);

  // IME 硬件光标定位（InputBox 获焦时显示硬件光标，支持中文输入法）
  useImeCursor({ focused: focus === "input", value: input, cursor, rows });

  // 鼠标（默认关；按 ` 开启，1002 拖动模式）。点击=光标，拖动=选区，松手=OSC52 复制。
  useMouse(mouseOn, (e) => {
    const inInputRow = e.row >= rows - 3;
    if (e.type === "down") {
      const sidebarW = sidebarVisible ? 20 : 0;
      const hudW = hudVisible ? 26 : 0;
      if (inInputRow) {
        setFocus("input");
        const idx = colToCharIndex(input, Math.max(0, e.col - inputColOffset));
        selAnchor.current = idx; dragged.current = false; setSel(null); setCursor(idx);
      } else if (e.col <= sidebarW) setFocus("sidebar");
      else if (e.col >= cols - hudW) setFocus("hud");
      else setFocus("chat");
    } else if (e.type === "drag" && selAnchor.current != null) {
      dragged.current = true;
      const idx = colToCharIndex(input, Math.max(0, e.col - inputColOffset));
      setSel([selAnchor.current, idx]); setCursor(idx);
    } else if (e.type === "up" && selAnchor.current != null) {
      const a = selAnchor.current, b = colToCharIndex(input, Math.max(0, e.col - inputColOffset));
      selAnchor.current = null;
      if (dragged.current && a !== b) { const s = Math.min(a, b), en = Math.max(a, b); setSel([s, en]); setCursor(en); const text = input.slice(s, en); if (text && stdout) { stdout.write(osc52(text)); store.toastMsg(`已复制 ${[...text].length} 字`, "ok"); } }
      else { setCursor(a); setSel(null); } // 纯单击：光标到按下处
    } else if (e.type === "wheelUp") {
      setChatOffset((o) => Math.min(Math.max(0, store.messages.length - 1), o + 1));
    } else if (e.type === "wheelDown") {
      setChatOffset((o) => Math.max(0, o - 1));
    }
  });

  const doSend = async () => {
    const text = input.trim();
    if (!text || store.streaming) return;
    setInput(""); setCursor(0); setChatOffset(0); setSel(null);
    store.send(text);

    // 首次发送时创建 agent 句柄（装配依赖 + 物化）
    if (!agentRef.current) {
      try {
        agentRef.current = config.createAgent(process.cwd(), maouRoot);
      } catch (e) {
        useStore.getState().toastMsg(`agent 创建失败: ${String(e).slice(0, 50)}`, "err");
        useStore.getState().finishStream();
        return;
      }
    }

    abortRef.current = new AbortController();
    try {
      const preset = config.getPreset(store.provider, store.model);
      const sessionId = useStore.getState().sessionId ?? agentRef.current.startSession();
      if (!useStore.getState().sessionId) useStore.getState().setSessionId(sessionId);

      await runAgentCli(text, {
        runtime: agentRef.current.runtime,
        sessionId,
        preset,
        onEvent: (ev) => useStore.getState().onStream(ev),
        signal: abortRef.current.signal,
        source: "cli",
      });
    } catch (e) {
      useStore.getState().toastMsg(String(e).slice(0, 60), "err");
      useStore.getState().finishStream();
    }
  };

  const runCommand = (id: string) => {
    store.setModal(null);
    switch (id) {
      case "new": case "clear": store.clearMessages(); useStore.getState().setSessionId(""); store.toastMsg("已清空，新会话", "ok"); break;
      case "sessions": store.setModal("sessions"); break;
      case "model": store.setModal("model"); break;
      case "help": store.setModal("help"); break;
      case "theme": { const names = Object.keys(THEMES); const next = names[(names.indexOf(currentTheme.name) + 1) % names.length]!; setTheme(next); store.toastMsg(`主题: ${next}`, "ok"); break; }
      case "quit": exit(); break;
    }
  };

  // 键盘（经 useCleanInput 过滤鼠标转义，避免点击插入乱码）
  useCleanInput((char, key) => {
    if (store.modal) return; // 弹窗自己处理
    if (key.ctrl && char === "c") { exit(); return; }
    if (char === "`") { setMouseOn((m) => !m); store.toastMsg(mouseOn ? "鼠标关闭（可拖选复制）" : "鼠标开启（点击/滚轮交互）", "info"); return; }
    if (key.ctrl && char === "k") return store.setModal("command");
    if (key.ctrl && char === "m") return store.setModal("model");
    if (key.ctrl && char === "n") { store.clearMessages(); setChatOffset(0); return; }
    if (key.ctrl && char === "b") return store.toggleSidebar();
    if (key.ctrl && char === "h") return store.toggleHud();
    if (key.ctrl && char === "g") {
      // Ctrl+G — 打开外部编辑器（IME 回退方案）
      const edited = openExternalEditor(input);
      if (edited !== null) { setInput(edited); setCursor(edited.length); store.toastMsg("已从编辑器读取", "ok"); }
      return;
    }
    if (key.tab) { setFocus((f) => (f === "input" ? "sidebar" : f === "sidebar" ? "chat" : f === "chat" ? "hud" : "input")); return; }
    if (key.escape) { if (store.streaming) { abortRef.current?.abort(); store.toastMsg("已中断", "info"); } return; }
    if (char === "?" && focus !== "input") return store.setModal("help");

    if (focus === "chat") {
      if (key.upArrow) return setChatOffset((o) => Math.min(Math.max(0, store.messages.length - 1), o + 1));
      if (key.downArrow) return setChatOffset((o) => Math.max(0, o - 1));
    }

    if (focus === "input") {
      // alt/meta+enter 换行（插入 \n）；enter 发送
      if (key.return && key.meta) {
        setSel(null);
        setInput((v) => v.slice(0, cursor) + "\n" + v.slice(cursor));
        setCursor((c) => c + 1);
        return;
      }
      if (key.return) return void doSend();
      if (key.leftArrow) { setSel(null); return setCursor((c) => Math.max(0, c - 1)); }
      if (key.rightArrow) { setSel(null); return setCursor((c) => Math.min(input.length, c + 1)); }
      // alt/meta+退格：快速退词（删到上一个空格/标点）
      if ((key.backspace || key.delete) && key.meta) {
        setSel(null);
        if (cursor > 0) {
          const before = input.slice(0, cursor);
          // 找到上一个非空白字符的词边界
          const trimmed = before.replace(/[\s\n]+$/, "");
          const wordStart = trimmed.search(/[\s\n][^\s\n]*$/);
          const newCursor = wordStart === -1 ? 0 : wordStart + 1;
          setInput((v) => v.slice(0, newCursor) + v.slice(cursor));
          setCursor(newCursor);
        }
        return;
      }
      if (key.backspace || key.delete) {
        setSel(null);
        if (cursor > 0) { setInput((v) => v.slice(0, cursor - 1) + v.slice(cursor)); setCursor((c) => c - 1); }
        return;
      }
      if (char && !key.ctrl && !key.meta) { setSel(null); setInput((v) => v.slice(0, cursor) + char + v.slice(cursor)); setCursor((c) => c + char.length); return; }
    }
  });

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Toast />
      <TopBar frame={frame} />
      <Box flexGrow={1}>
        <Collapsible open={sidebarVisible} size={20} axis="x">
          <Sidebar focused={focus === "sidebar"} />
        </Collapsible>
        <Box flexGrow={1} flexDirection="column">
          <Panel title="对话" icon="✦" focused={focus === "chat"} flexGrow={1}>
            <ChatView messages={store.messages} frame={frame} maxRows={rows - 10} offset={chatOffset} />
          </Panel>
        </Box>
        {hudVisible && <Hud frame={frame} angle={store.wireAngle} />}
      </Box>
      <InputBox value={input} cursor={cursor} focused={focus === "input"} selStart={sel?.[0]} selEnd={sel?.[1]} />
      <StatusBar mode={focus === "input" ? "输入" : focus.toUpperCase()} input={input} mouse={mouseOn} />
      {store.modal === "model" && <ModelPicker />}
      {store.modal === "command" && <CommandPalette onRun={runCommand} />}
      {store.modal === "help" && <HelpModal />}
      {store.modal === "sessions" && <SessionPicker />}
    </Box>
  );
}
