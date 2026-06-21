/** Maou CLI 主应用 —— 布局 + 键盘 + 鼠标 + 流式驱动 */
import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput, useApp, useStdout, useStdin } from "ink";
import { currentTheme, setTheme, THEMES } from "./theme.js";
import { useStore } from "./state/store.js";
import { runChat } from "./sdk/index.js";
import { TopBar, Sidebar, Hud, StatusBar, Toast } from "./components/Hud.js";
import { ChatView } from "./components/Chat.js";
import { InputBox, colToCharIndex } from "./components/InputBox.js";
import { Panel } from "./components/Panel.js";
import { ModelPicker, CommandPalette, HelpModal } from "./components/Modals.js";
import { parseMouse, enableMouse, disableMouse } from "./input/mouse.js";

type Focus = "input" | "sidebar" | "hud" | "chat";

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { stdin, setRawMode } = useStdin();
  const store = useStore();
  const [input, setInput] = useState("");
  const [cursor, setCursor] = useState(0);
  const [focus, setFocus] = useState<Focus>("input");
  const [frame, setFrame] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const inputRowRef = useRef<{ row: number; col: number }>({ row: 0, col: 0 });

  const cols = stdout?.columns ?? 100;
  const rows = stdout?.rows ?? 30;

  // 动画帧循环 + 3D 旋转
  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => f + 1);
      store.tickWire();
    }, 100);
    return () => clearInterval(id);
  }, []);

  // 鼠标：启用 SGR + 解析点击
  useEffect(() => {
    if (!stdout) return;
    enableMouse(stdout);
    const onData = (data: Buffer) => {
      const evts = parseMouse(data.toString("latin1"));
      for (const e of evts) {
        if (e.type === "down") {
          // 按列粗判聚焦哪个面板
          const sidebarW = store.sidebarOpen ? 20 : 0;
          const hudW = store.hudOpen ? 26 : 0;
          if (e.col <= sidebarW) setFocus("sidebar");
          else if (e.col >= cols - hudW) setFocus("hud");
          else if (e.row >= rows - 3) {
            // 点输入框 → 定位光标
            setFocus("input");
            const relCol = Math.max(0, e.col - inputRowRef.current.col - 3);
            setCursor(colToCharIndex(input, relCol));
          } else setFocus("chat");
        } else if (e.type === "wheelUp" || e.type === "wheelDown") {
          // 滚动（占位，ChatView 自动裁剪近期）
        }
      }
    };
    stdin?.on("data", onData);
    return () => { stdin?.off("data", onData); disableMouse(stdout); };
  }, [stdout, stdin, cols, rows, input, store.sidebarOpen, store.hudOpen]);

  const doSend = async () => {
    const text = input.trim();
    if (!text || store.streaming) return;
    setInput("");
    setCursor(0);
    store.send(text);
    const history = [...useStore.getState().messages].map((m) => ({ role: m.role, content: m.content })) as any;
    abortRef.current = new AbortController();
    try {
      await runChat({
        provider: store.provider,
        model: store.model,
        systemPrompt: "你是 Vampire，一个高傲又可爱的吸血鬼 AI 助手。回答简洁有个性。",
        history,
        signal: abortRef.current.signal,
        onEvent: (ev) => useStore.getState().onStream(ev),
      });
    } catch (e) {
      useStore.getState().toastMsg(String(e).slice(0, 60), "err");
      useStore.getState().finishStream();
    }
  };

  const runCommand = (id: string) => {
    store.setModal(null);
    switch (id) {
      case "new": case "clear": store.clearMessages(); store.toastMsg("已清空", "ok"); break;
      case "model": store.setModal("model"); break;
      case "help": store.setModal("help"); break;
      case "theme": { const names = Object.keys(THEMES); const next = names[(names.indexOf(currentTheme.name) + 1) % names.length]!; setTheme(next); store.toastMsg(`主题: ${next}`, "ok"); break; }
      case "quit": cleanup(); exit(); break;
    }
  };

  const cleanup = () => { if (stdout) disableMouse(stdout); };

  // 键盘
  useInput((char, key) => {
    if (store.modal) return; // 弹窗自己处理
    if (key.ctrl && char === "c") { cleanup(); exit(); return; }
    if (key.ctrl && char === "k") return store.setModal("command");
    if (key.ctrl && char === "m") return store.setModal("model");
    if (key.ctrl && char === "n") { store.clearMessages(); return; }
    if (key.ctrl && char === "b") return store.toggleSidebar();
    if (key.ctrl && char === "g") return store.toggleHud();
    if (key.tab) { setFocus((f) => (f === "input" ? "sidebar" : f === "sidebar" ? "chat" : f === "chat" ? "hud" : "input")); return; }
    if (key.escape) { if (store.streaming) { abortRef.current?.abort(); store.toastMsg("已中断", "info"); } return; }
    if (char === "?" && focus !== "input") return store.setModal("help");

    if (focus === "input") {
      if (key.return) return void doSend();
      if (key.leftArrow) return setCursor((c) => Math.max(0, c - 1));
      if (key.rightArrow) return setCursor((c) => Math.min(input.length, c + 1));
      if (key.backspace || key.delete) {
        if (cursor > 0) { setInput((v) => v.slice(0, cursor - 1) + v.slice(cursor)); setCursor((c) => c - 1); }
        return;
      }
      if (char && !key.ctrl && !key.meta) { setInput((v) => v.slice(0, cursor) + char + v.slice(cursor)); setCursor((c) => c + char.length); return; }
    }
  });

  const t = currentTheme;
  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Toast />
      <TopBar frame={frame} />
      <Box flexGrow={1}>
        {store.sidebarOpen && <Sidebar focused={focus === "sidebar"} />}
        <Box flexGrow={1} flexDirection="column">
          <Panel title="对话" icon="✦" focused={focus === "chat"} flexGrow={1}>
            <ChatView messages={store.messages} frame={frame} maxRows={rows - 10} />
          </Panel>
        </Box>
        {store.hudOpen && <Hud frame={frame} angle={store.wireAngle} />}
      </Box>
      <InputBox value={input} cursor={cursor} focused={focus === "input"} />
      <StatusBar mode={focus === "input" ? "输入" : focus.toUpperCase()} input={input} />
      {store.modal === "model" && <ModelPicker />}
      {store.modal === "command" && <CommandPalette onRun={runCommand} />}
      {store.modal === "help" && <HelpModal />}
    </Box>
  );
}
