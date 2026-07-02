/** Maou CLI 主应用 — 极简布局 + 事件分发 */
import React, { useState, useEffect, useRef } from "react";
import { useApp, Box, Text, useStdout } from "ink";
import { TextInput } from "@inkjs/ui";
import { currentTheme as t, setTheme, THEMES } from "./theme.js";
import { useStore } from "./state/store.js";
import { useAgent } from "./hooks/useAgent.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { useMouse } from "./hooks/useMouse.js";
import { useCleanInput } from "./hooks/useCleanInput.js";
import { useImeCursor } from "./hooks/useImeCursor.js";
import { openExternalEditor } from "./hooks/useExternalEditor.js";
import { ChatView } from "./components/ChatView.js";
import { StatusBar } from "./components/StatusBar.js";
import { CommandPalette, ModelPicker, HelpModal } from "./components/Modal.js";
import type { AgentCliConfig } from "./types.js";

export function App({ config }: { config: AgentCliConfig }) {
  const { exit } = useApp();
  const term = useTerminalSize();
  const store = useStore();
  const { send, abort } = useAgent(config);
  const [inputValue, setInputValue] = useState("");
  const [frame, setFrame] = useState(0);
  const [chatOffset, setChatOffset] = useState(0);

  // 初始化 provider/model
  useEffect(() => {
    if (!store.provider || !store.model) {
      const ps = config.getProviders?.() ?? [];
      if (ps.length > 0) {
        const ms = config.getModels?.(ps[0]!.id) ?? [];
        if (ms.length > 0) store.setProviderModel(ps[0]!.id, ms[0]!.id);
      }
    }
  }, []);

  // 动画帧：仅流式时
  useEffect(() => {
    if (!store.streaming) return;
    const id = setInterval(() => setFrame(f => f + 1), 200);
    return () => clearInterval(id);
  }, [store.streaming]);

  // 鼠标关闭：@inkjs/ui TextInput 内部用 useInput，不经过 useCleanInput，
  // 鼠标 SGR 序列会被 TextInput 当文本插入。关掉鼠标上报从根源解决。
  // 滚轮改用方向键替代（↑↓ 在对话区滚动，TextInput 里正常移动光标）。
  useMouse(false, () => {});

  // 全局快捷键（TextInput 自己处理字符输入/光标/退格/左右键）
  useCleanInput((char, key) => {
    if (store.modal) return;
    // Ctrl+C 退出（TextInput 自己会忽略 Ctrl+C）
    if (key.ctrl && char === "c") { exit(); return; }
    // Ctrl+K 命令面板
    if (key.ctrl && char === "k") return store.setModal("command");
    // Ctrl+M 模型选择
    if (key.ctrl && char === "m") return store.setModal("model");
    // Ctrl+N 新对话
    if (key.ctrl && char === "n") { store.clearMessages(); return; }
    // Ctrl+G / Ctrl+E 外部编辑器
    if (key.ctrl && (char === "g" || char === "e")) {
      const edited = openExternalEditor(inputValue);
      if (edited !== null) { setInputValue(edited); store.toastMsg("已从编辑器读取", "ok"); }
      return;
    }
    // Esc 中断
    if (key.escape) { if (store.streaming) abort(); return; }
  });

  // TextInput onSubmit → 发送
  const handleSubmit = (value: string) => {
    if (value.trim()) { send(value.trim()); setInputValue(""); setChatOffset(0); }
  };

  const runCommand = (id: string) => {
    store.setModal(null);
    switch (id) {
      case "new": store.clearMessages(); store.toastMsg("新会话", "ok"); break;
      case "model": store.setModal("model"); break;
      case "help": store.setModal("help"); break;
      case "quit": exit(); break;
    }
  };

  return (
    <Box flexDirection="column" width={term.cols} height={term.rows}>
      {/* 顶栏 */}
      <Box justifyContent="space-between" paddingX={1} flexShrink={0}>
        <Text color={t.accent} bold> MAOU</Text>
        <Text color={store.streaming ? t.accent2 : t.dim}>{store.streaming ? "► 思考中" : "■ 待命"}</Text>
        <Text color={t.fg}>{store.provider}/{store.model}</Text>
      </Box>

      {/* 对话区 95% */}
      <Box flexGrow={1} flexDirection="column" borderStyle="single" borderColor={t.border}>
        <ChatView messages={store.messages} frame={frame} maxRows={term.rows - 6} offset={chatOffset} />
      </Box>

      {/* 输入框：@inkjs/ui TextInput（现成组件，自带光标/退格/左右键/中文） */}
      <Box flexShrink={0} {...({ backgroundColor: t.overlayBg } as object)}>
        <Text color={t.accent} bold> ❯ </Text>
        <TextInput
          defaultValue=""
          onChange={(v: string) => setInputValue(v)}
          onSubmit={handleSubmit}
          placeholder="输入消息…（Ctrl+K 命令 · Ctrl+G 编辑器）"
        />
      </Box>

      {/* 状态栏 */}
      <StatusBar />

      {/* 弹窗 */}
      {store.modal === "command" && <CommandPalette onRun={runCommand} />}
      {store.modal === "model" && <ModelPicker config={config} />}
      {store.modal === "help" && <HelpModal />}

      {/* Toast */}
      {store.toast && (
        <Box paddingX={1} flexShrink={0}>
          <Text backgroundColor={store.toast.kind === "err" ? t.status.err : store.toast.kind === "ok" ? t.status.ok : t.status.info} color={t.bg} bold>
            {" "}{store.toast.text}{" "}
          </Text>
        </Box>
      )}
    </Box>
  );
}
