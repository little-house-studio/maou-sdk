/**
 * EventBlock —— 输入框上方的流式事件块。
 * 显示当前轮：模式（思考中/生成中/工具待执行）+ 上传/下传 token。
 * 监督模式时：粗略(1行状态)/展开(12行可滚 supervisorMessages)两模式，点击切换。
 */

import React, { useRef, useState, useEffect } from "react";
import { Box, Text, useBoxMetrics } from "ink";
import type { DOMElement } from "ink";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { compact, codename, hr } from "../layout/decorators.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useClickTarget } from "../input/click-target.js";

const EXPANDED_HEIGHT = 12;

export function EventBlock() {
  const t = useTheme();
  const eventBlock = useStore((s) => s.eventBlock);
  const streaming = useStore((s) => s.streaming);
  const supervisor = useStore((s) => s.supervisor);
  const supervisorMessages = useStore((s) => s.supervisorMessages);
  const expanded = useStore((s) => s.eventBlockExpanded);
  const term = useTerminalSize();

  // 监督模式：粗略(1行)/展开(12行可滚)两模式
  if (supervisor?.active) {
    const stateLabel: Record<string, string> = {
      planning: "规划中",
      confirming_plan: "待确认计划",
      started: `执行中 · ${supervisor.verifyRounds ?? 0} 轮`,
      confirming: "待最终验收",
      ended: "已结束",
    };
    const label = stateLabel[supervisor.state] ?? supervisor.state;
    const stateColor = supervisor.state === "confirming_plan" || supervisor.state === "confirming" ? t.warn : t.accent;

    // 粗略模式：1 行状态，点击展开
    if (!expanded) {
      return <EventBlockCollapsed label={label} stateColor={stateColor} verdict={supervisor.lastVerdict} />;
    }

    // 展开模式：标题行 + 12 行可滚 supervisorMessages
    return <EventBlockExpanded label={label} stateColor={stateColor} verdict={supervisor.lastVerdict} messages={supervisorMessages} cols={term.cols} />;
  }

  if (!streaming && eventBlock.mode === "idle") {
    return (
      <Box flexShrink={0} paddingX={1}>
        <Text color={t.dim}>{hr(term.cols, "─", 8, 30)}</Text>
      </Box>
    );
  }

  const modeLabel: Record<string, string> = {
    thinking: "思考中",
    generating: "生成中",
    tool_pending: `工具 ${eventBlock.detail ?? ""}`,
    error: "错误",
    idle: "待命",
  };
  const modeColor = eventBlock.mode === "error" ? t.err
    : eventBlock.mode === "tool_pending" ? t.warn
    : eventBlock.mode === "thinking" ? t.info
    : t.accent;

  return (
    <Box flexShrink={0} paddingX={1} justifyContent="space-between">
      <Box gap={1}>
        <Text color={modeColor} bold>{modeLabel[eventBlock.mode] ?? "处理中"}</Text>
        {eventBlock.detail && eventBlock.mode !== "tool_pending" && (
          <Text color={t.dim}>{eventBlock.detail}</Text>
        )}
      </Box>
      <Text color={t.dim}>{codename("tokens")} {compact(eventBlock.upTokens)}↑ {compact(eventBlock.downTokens)}↓</Text>
    </Box>
  );
}

/** 粗略模式：1 行，点击切换展开 */
function EventBlockCollapsed({ label, stateColor, verdict }: { label: string; stateColor: string; verdict?: string }) {
  const t = useTheme();
  const ref = useRef<DOMElement | null>(null);
  useClickTarget(ref, () => useStore.getState().toggleEventBlockExpanded(), []);
  return (
    <Box ref={ref} flexShrink={0} paddingX={1} justifyContent="space-between">
      <Box gap={1}>
        <Text color={stateColor} bold>🎯 监督</Text>
        <Text color={t.dim}>·</Text>
        <Text color={stateColor}>{label}</Text>
        <Text color={t.dim}> ▶ 展开</Text>
      </Box>
      {verdict && (
        <Text color={verdict === "pass" ? t.ok : t.err}>
          上轮{verdict === "pass" ? "合格" : "不合格"}
        </Text>
      )}
    </Box>
  );
}

/** 展开模式：标题 + 12 行可滚 supervisorMessages，点击折叠 */
function EventBlockExpanded({ label, stateColor, verdict, messages, cols }: {
  label: string; stateColor: string; verdict?: string; messages: { content: string; streaming?: boolean }[]; cols: number;
}) {
  const t = useTheme();
  const ref = useRef<DOMElement | null>(null);
  useClickTarget(ref, () => useStore.getState().toggleEventBlockExpanded(), []);
  const contentRef = useRef(null);
  const metrics = useBoxMetrics(contentRef);
  const [offset, setOffset] = useState(0);

  const contentHeight = metrics.height ?? 0;
  const maxScroll = Math.max(0, contentHeight - EXPANDED_HEIGHT);
  const clampedOffset = Math.min(offset, maxScroll);
  const marginTop = -clampedOffset;

  // 滚轮驱动（由 useMouseInput 按鼠标位置路由到 onSupervisorScroll → 这里消费）
  // 简化：监听 store 的 supervisorScrollCmd（同 chatScrollOffset 模式）
  const scrollCmd = useStore((s) => s.supervisorScrollCmd);
  useEffect(() => {
    if (!scrollCmd) return;
    setOffset(o => scrollCmd.dir === "up" ? Math.max(0, o - 1) : Math.min(maxScroll, o + 1));
  }, [scrollCmd, maxScroll]);

  return (
    <Box ref={ref} flexShrink={0} flexDirection="column" borderStyle="single" borderColor={stateColor}>
      <Box justifyContent="space-between" paddingX={1}>
        <Box gap={1}>
          <Text color={stateColor} bold>🎯 监督 · {label}</Text>
          <Text color={t.dim}>▼ 折叠</Text>
        </Box>
        {verdict && <Text color={verdict === "pass" ? t.ok : t.err}>上轮{verdict === "pass" ? "合格" : "不合格"}</Text>}
      </Box>
      <Box height={EXPANDED_HEIGHT} overflow="hidden" flexDirection="column">
        <Box ref={contentRef} flexShrink={0} marginTop={marginTop} flexDirection="column" paddingX={1}>
          {messages.length === 0
            ? <Text color={t.dim}>（监督 Agent 输出将显示在此）</Text>
            : messages.map((m, i) => <Text key={i} color={t.fg} wrap="wrap">{m.content || " "}</Text>)
          }
        </Box>
      </Box>
    </Box>
  );
}
