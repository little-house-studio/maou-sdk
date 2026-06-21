/** Maou CLI 主应用 —— 响应式布局 + 键盘 + (可toggle)鼠标 + 流式驱动 */
import React, { useState, useEffect, useRef } from "react";
import { useApp } from "ink";
import { Box } from "ink";
import { currentTheme, setTheme, THEMES } from "./theme.js";
import { useStore } from "./state/store.js";
import { runChat } from "./sdk/index.js";
import { TopBar, Sidebar, Hud, StatusBar, Toast } from "./components/Hud.js";
import { ChatView } from "./components/Chat.js";
import { InputBox, colToCharIndex } from "./components/InputBox.js";
import { Panel } from "./components/Panel.js";
import { Collapsible } from "./components/Collapsible.js";
import { ModelPicker, CommandPalette, HelpModal } from "./components/Modals.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { useMouse } from "./hooks/useMouse.js";
import { useCleanInput } from "./hooks/useCleanInput.js";

type Focus = "input" | "sidebar" | "hud" | "chat";

export function App() {
  const { exit } = useApp();
  const term = useTerminalSize();
  const store = useStore();
  const [input, setInput] = useState("");
  const [cursor, setCursor] = useState(0);
  const [focus, setFocus] = useState<Focus>("input");
  const [frame, setFrame] = useState(0);
  const [mouseOn, setMouseOn] = useState(false); // 默认关 → 终端原生可拖选复制
  const [chatOffset, setChatOffset] = useState(0); // 对话滚动（消息粒度，0=最新）
  const abortRef = useRef<AbortController | null>(null);

  const cols = term.cols;
  const rows = term.rows;
  // 响应式：窄屏自动折叠（与用户手动开关取交集）
  const sidebarVisible = store.sidebarOpen && term.showSidebar;
  const hudVisible = store.hudOpen && term.showHud;

  // 动画帧循环 + 3D 旋转
  useEffect(() => {
    const id = setInterval(() => { setFrame((f) => f + 1); store.tickWire(); }, 100);
    return () => clearInterval(id);
  }, []);

  // 鼠标（默认关；按 ` 开启）。开启时只用 1000 模式，尽量不抢拖选。
  useMouse(mouseOn, (e) => {
    if (e.type === "down") {
      const sidebarW = sidebarVisible ? 20 : 0;
      const hudW = hudVisible ? 26 : 0;
      if (e.col <= sidebarW) setFocus("sidebar");
      else if (e.col >= cols - hudW) setFocus("hud");
      else if (e.row >= rows - 3) {
        setFocus("input");
        setCursor(colToCharIndex(input, Math.max(0, e.col - 4)));
      } else setFocus("chat");
    } else if (e.type === "wheelUp") {
      setChatOffset((o) => Math.min(Math.max(0, store.messages.length - 1), o + 1));
    } else if (e.type === "wheelDown") {
      setChatOffset((o) => Math.max(0, o - 1));
    }
  });

  const doSend = async () => {
    const text = input.trim();
    if (!text || store.streaming) return;
    setInput(""); setCursor(0); setChatOffset(0);
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
    if (key.ctrl && char === "g") return store.toggleHud();
    if (key.tab) { setFocus((f) => (f === "input" ? "sidebar" : f === "sidebar" ? "chat" : f === "chat" ? "hud" : "input")); return; }
    if (key.escape) { if (store.streaming) { abortRef.current?.abort(); store.toastMsg("已中断", "info"); } return; }
    if (char === "?" && focus !== "input") return store.setModal("help");

    if (focus === "chat") {
      if (key.upArrow) return setChatOffset((o) => Math.min(Math.max(0, store.messages.length - 1), o + 1));
      if (key.downArrow) return setChatOffset((o) => Math.max(0, o - 1));
    }

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
      <InputBox value={input} cursor={cursor} focused={focus === "input"} />
      <StatusBar mode={focus === "input" ? "输入" : focus.toUpperCase()} input={input} mouse={mouseOn} />
      {store.modal === "model" && <ModelPicker />}
      {store.modal === "command" && <CommandPalette onRun={runCommand} />}
      {store.modal === "help" && <HelpModal />}
    </Box>
  );
}
