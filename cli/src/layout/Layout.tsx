/**
 * Layout —— 顶层布局。
 * [上下文窗口 95%] / 事件块 / 输入框 / 状态栏 + overlay（命令面板/全屏编辑器）。
 */

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/theme-context.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { ChatPage } from "../render/ChatPage.js";
import { EventBlock } from "../render/EventBlock.js";
import { InputBar } from "../render/InputBar.js";
import { NavBar, InfoBar } from "../render/NavBar.js";
import { GoalPanel } from "../render/GoalPanel.js";
import { CommandPalette } from "../overlay/CommandPalette.js";
import { ModelDialog } from "../overlay/ModelDialog.js";
import { SessionDialog } from "../overlay/SessionDialog.js";
import { HelpDialog } from "../overlay/HelpDialog.js";
import { SettingsDialog } from "../overlay/SettingsDialog.js";
import { AgentPanel } from "../overlay/AgentPanel.js";
import { FullScreenEditor } from "../render/FullScreenEditor.js";
import { useStore } from "../state/store.js";
import type { AgentCliConfig } from "../types.js";

export function Layout({
  frame,
  value,
  config,
  onSubmit,
  onInputChange,
  onFullEditor,
}: {
  frame: number;
  value: string;
  config: AgentCliConfig;
  onSubmit: (text: string) => void;
  onInputChange: (v: string) => void;
  onFullEditor: (initial: string) => void;
}) {
  const t = useTheme();
  const term = useTerminalSize();
  const overlay = useStore((s) => s.overlay);
  const fullEditorInitial = useStore((s) => s.fullEditorInitial);

  return (
    <Box flexDirection="column" width={term.cols} height={term.rows}>
      {/* 上下文窗口 95%；overlay 开时清空内容避免穿透（Ink 无 z 序） */}
      <Box flexGrow={1} flexDirection="column" borderStyle="single" borderColor={t.border}>
        {overlay ? <Text>{" "}</Text> : <ChatPage frame={frame} />}
      </Box>

      {/* 事件块（输入框上方） */}
      <EventBlock />

      {/* goal 监督面板（supervisor active 时显示） */}
      <GoalPanel />

      {/* 输入框 */}
      <InputBar value={value} onSubmit={onSubmit} onChange={onInputChange} onFullEditor={onFullEditor} />

      {/* 信息栏（倒数第二行） */}
      <InfoBar />

      {/* 导航栏按键（最底部） */}
      <NavBar />

      {/* Overlay：命令面板 / 模型 / 会话 / 帮助 / 设置 */}
      {overlay === "command" && <CommandPalette onRun={(id) => {
        // 本地 UI 命令走 runCommand；其余（new/clear/stop/agent/goal）当斜杠命令透传 runtime
        if (useStore.getState().isLocalCommand(id)) useStore.getState().runCommand(id);
        else { useStore.getState().setOverlay(null); onSubmit(`/${id}`); }
      }} />}
      {overlay === "model" && <ModelDialog config={config} />}
      {overlay === "sessions" && <SessionDialog />}
      {overlay === "help" && <HelpDialog />}
      {overlay === "settings" && <SettingsDialog config={config} />}
      {overlay === "agents" && <AgentPanel config={config} />}

      {/* Overlay：全屏编辑器（最上层） */}
      {fullEditorInitial !== null && (
        <FullScreenEditor
          initial={fullEditorInitial}
          onExit={(value, submit) => useStore.getState().exitFullEditor(value, submit)}
        />
      )}
    </Box>
  );
}
