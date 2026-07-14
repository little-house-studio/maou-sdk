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
import { PerfHud } from "../render/PerfHud.js";
import { EventBlock } from "../render/EventBlock.js";
import { InputBar } from "../render/InputBar.js";
import { NavBar, InfoBar } from "../render/NavBar.js";
import { GoalPanel } from "../render/GoalPanel.js";
import { TerminalApprovalBar } from "../render/TerminalApprovalBar.js";
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

/** 水平居中一行（按显示宽，CJK=2） */
function centerLine(text: string, cols: number): string {
  const w = stringWidth(text);
  if (w >= cols) return text;
  const pad = Math.floor((cols - w) / 2);
  return `${" ".repeat(pad)}${text}`;
}

/** 仅订阅滚动态：上滚离开底时显示「回到最底部」，不拖 Layout 整树 */
function BackToBottomSlot({ hidden }: { hidden?: boolean }) {
  const autoFollow = useStore((s) => s.autoFollow);
  const chatScrollOffset = useStore((s) => s.chatScrollOffset);
  const maxChatScroll = useStore((s) => s.maxChatScroll);
  const show =
    !hidden && !autoFollow && Math.min(chatScrollOffset, maxChatScroll) > 0;
  return (
    <Box flexShrink={0} width="100%" height={1} overflow="hidden">
      {show ? <BackToBottomBar /> : <Text>{" "}</Text>}
    </Box>
  );
}

/** 贴在对话框与输入 chrome 之间：灰底全宽「回到最底部」（固定 1 行高） */
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
    <Box ref={ref} flexShrink={0} width="100%" height={1} overflow="hidden">
      <Text backgroundColor={t.userBg} color={t.user} bold>
        {line}
      </Text>
    </Box>
  );
}

/**
 * 空会话提示：隔一行贴在输入 chrome 上方（对话框外），
 * 不占用画廊垂直空间。
 */
function EmptySessionHint() {
  const t = useTheme();
  const term = useTerminalSize();
  const label = "输入消息开始对话 · Ctrl+K 命令 · Ctrl+C 退出";
  return (
    <Box flexDirection="column" flexShrink={0} width="100%">
      <Text>{" "}</Text>
      <Text color={t.dim}>{centerLine(label, term.cols)}</Text>
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
  const completion = useStore((s) => s.completion);
  // 只订 length：订整表 messages 会在每个 stream delta 重渲 Layout+底栏+全树，20 轮后卡死主因之一
  const messageCount = useStore((s) => s.messages.length);
  const streaming = useStore((s) => s.streaming);
  // 指令补全弹出时隐藏 EventBlock / InfoBar 状态条，把高度让给补全菜单
  const showComp = completion !== null && (completion.items?.length ?? 0) > 0;
  // 空会话：提示贴输入框上方（对话框外，隔一行）
  // 注意：不要在此订阅 chatScrollOffset——否则每次滚 1 格整 Layout（Input/Nav/Event）重渲
  const showEmptyHint =
    !overlay && !showComp && messageCount === 0 && !streaming;

  return (
    <Box flexDirection="column" width={term.cols} height={term.rows}>
      {/* 上下文窗口 95%；overlay 开时清空内容避免穿透（Ink 无 z 序） */}
      <Box flexGrow={1} flexDirection="column" borderStyle="single" borderColor={t.border}>
        {/* 右上角：本进程 CPU/内存（ui=前端 · ag=agent 后端） */}
        {!overlay && <PerfHud />}
        {overlay ? <Text>{" "}</Text> : <ChatPage frame={frame} />}
      </Box>

      {/* goal 监督面板（supervisor active 时显示） */}
      <GoalPanel />

      {/* normal 模式：终端命令审批条（阻塞 use_terminal，不遮盖对话） */}
      <TerminalApprovalBar />

      {/*
        始终占 1 行；显示逻辑放在子组件内订阅 scroll，避免 Layout 跟滚。
      */}
      <BackToBottomSlot hidden={!!overlay} />

      {/* Toast：Ctrl+C 确认退出 / 模式切换等（在 chrome 上方，全宽醒目） */}
      <ToastBar />

      {/* 空会话提示：隔一行贴紧输入框 chrome */}
      {showEmptyHint && <EmptySessionHint />}

      {/* 底部 chrome：无顶部分隔线，与对话区直接相接 */}
      <Box
        flexDirection="column"
        flexShrink={0}
        backgroundColor={t.footerBg}
        width="100%"
      >
        {!showComp && <EventBlock draft={value} />}
        <InputBar value={value} onSubmit={onSubmit} onChange={onInputChange} onFullEditor={onFullEditor} />
        {!showComp && <InfoBar />}
        <NavBar />
      </Box>

      {/* Overlay：命令面板 / 模型 / 会话 / 帮助 / 设置 */}
      {overlay === "command" && <CommandPalette onRun={(id) => {
        // 本地 UI 命令（含 new/clear）走 runCommand；其余透传 runtime
        if (useStore.getState().isLocalCommand(id)) {
          useStore.getState().runCommand(id);
        } else {
          useStore.getState().setOverlay(null);
          onSubmit(`/${id}`);
        }
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
