/**
 * Layout —— 顶层布局。
 * [上下文窗口 95%] / 回到底部 / 事件块 / 输入框 / 状态栏 + overlay。
 */

import React, { useRef } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import stringWidth from "string-width";
import { useTheme } from "../theme/theme-context.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { ChatPage } from "../render/ChatPage.js";
import { EventBlock } from "../render/EventBlock.js";
import { InputBar } from "../render/InputBar.js";
import { NavBar, InfoBar } from "../render/NavBar.js";
import { GoalPanel } from "../render/GoalPanel.js";
import { ToastBar } from "../render/ToastBar.js";
import { CommandPalette } from "../overlay/CommandPalette.js";
import { ModelDialog } from "../overlay/ModelDialog.js";
import { SessionDialog } from "../overlay/SessionDialog.js";
import { HelpDialog } from "../overlay/HelpDialog.js";
import { SettingsDialog } from "../overlay/SettingsDialog.js";
import { AgentPanel } from "../overlay/AgentPanel.js";
import { PromptDialog } from "../overlay/PromptDialog.js";
import { FullScreenEditor } from "../render/FullScreenEditor.js";
import { useStore } from "../state/store.js";
import { useClickTarget } from "../input/click-target.js";
import type { AgentCliConfig } from "../types.js";

/** 贴在对话框与输入 chrome 之间：灰底全宽「回到最底部」 */
function BackToBottomBar() {
  const t = useTheme();
  const term = useTerminalSize();
  const ref = useRef<DOMElement | null>(null);
  useClickTarget(ref, () => useStore.getState().scrollToBottom(), []);
  const label = " ↓ 点击回到最底部 ";
  const pad = Math.max(0, term.cols - stringWidth(label));
  const left = Math.floor(pad / 2);
  const right = pad - left;
  const line = `${" ".repeat(left)}${label}${" ".repeat(right)}`;
  return (
    <Box ref={ref} flexShrink={0} width="100%">
      <Text backgroundColor={t.userBg} color={t.user} bold>
        {line}
      </Text>
    </Box>
  );
}

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
  // 与 ScrollHistory.hasNewer 一致：上滚离开底部时显示
  const autoFollow = useStore((s) => s.autoFollow);
  const chatScrollOffset = useStore((s) => s.chatScrollOffset);
  const maxChatScroll = useStore((s) => s.maxChatScroll);
  const showBackToBottom =
    !overlay && !autoFollow && Math.min(chatScrollOffset, maxChatScroll) > 0;

  return (
    <Box flexDirection="column" width={term.cols} height={term.rows}>
      {/* 上下文窗口 95%；overlay 开时清空内容避免穿透（Ink 无 z 序） */}
      <Box flexGrow={1} flexDirection="column" borderStyle="single" borderColor={t.border}>
        {overlay ? <Text>{" "}</Text> : <ChatPage frame={frame} />}
      </Box>

      {/* goal 监督面板（supervisor active 时显示） */}
      <GoalPanel />

      {/* 贴在输入 chrome 正上方：灰底全宽「回到最底部」（从对话框内下移到框外） */}
      {showBackToBottom && <BackToBottomBar />}

      {/* Toast：Ctrl+C 确认退出 / 模式切换等（在 chrome 上方，全宽醒目） */}
      <ToastBar />

      {/* 底部 chrome 整块白灰 #C5C5C5：分隔线/事件块 + 输入 + 信息栏 + 导航 */}
      <Box flexDirection="column" flexShrink={0} backgroundColor={t.footerBg} width="100%">
        <EventBlock draft={value} />
        <InputBar value={value} onSubmit={onSubmit} onChange={onInputChange} onFullEditor={onFullEditor} />
        <InfoBar />
        <NavBar />
      </Box>

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
      {overlay === "prompt" && <PromptDialog />}

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
