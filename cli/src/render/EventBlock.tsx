/**
 * EventBlock —— 输入 chrome 顶栏
 *
 * 布局（非监督）：
 *   左：短状态（图标 + 英文）+ 本轮未缓存新输入 ↑N
 *   中：审核模式整段色底（Normal 深灰 / Auto 黄 / Yolo 橙红）
 *   右：最近一轮 input / output token
 *
 * 未缓存 input：
 *   - 忙碌：agent.uncachedInputTokens（usage.input − cache_read）
 *   - 空闲：预估「下一发请求」整包新输入
 *     = system + 会话全部消息（含 tool/think）+ 输入框草稿
 *     若上轮有 cache_read，则 totalEst − cache_read（下限 ≥ 草稿）
 *     用 ↑~ 标记为估算
 */

import React, { useRef, useState, useEffect, useMemo } from "react";
import { Box, Text, useBoxMetrics } from "ink";
import type { DOMElement } from "ink";
import stringWidth from "string-width";
import { uncachedInputTokens } from "@little-house-studio/agent";
import { estimateTokens, estimateContextTokens } from "@little-house-studio/llm";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { compact, techFillTop } from "../layout/decorators.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useClickTarget } from "../input/click-target.js";
import { previewCurrentSystemPrompt } from "../lib/preview-system.js";
import {
  APPROVAL_LABELS,
  type ApprovalMode,
  type EventMode,
  type ChatMessage,
} from "../state/types.js";

/** 把一条 ChatMessage 压成可估 token 的文本（正文 + think + 工具） */
function messageToEstimateText(m: ChatMessage): string {
  const parts: string[] = [];
  if (m.content) parts.push(m.content);
  for (const b of m.thinkingBlocks ?? []) {
    if (b.content) parts.push(b.content);
  }
  for (const tc of m.toolCalls ?? []) {
    parts.push(`${tc.name} ${tc.args ?? ""}`);
    if (tc.result) parts.push(tc.result);
  }
  return parts.join("\n");
}

const EXPANDED_HEIGHT = 12;

function fit(text: string, width: number): string {
  if (width <= 0) return "";
  let out = "";
  let used = 0;
  for (const ch of text) {
    const w = stringWidth(ch) || 1;
    if (used + w > width) break;
    out += ch;
    used += w;
  }
  if (used < width) out += " ".repeat(width - used);
  return out;
}

function centerFit(text: string, width: number): string {
  if (width <= 0) return "";
  let core = text;
  let tw = stringWidth(core);
  if (tw > width) {
    core = fit(text, width);
    tw = stringWidth(core);
  }
  const pad = Math.max(0, width - tw);
  const left = Math.floor(pad / 2);
  return " ".repeat(left) + core + " ".repeat(pad - left);
}

/** 审核模式色 */
function approvalStyle(mode: ApprovalMode, t: ReturnType<typeof useTheme>) {
  if (mode === "auto") return { bg: t.warn, fg: "#000000", title: "AUTO" };
  if (mode === "yolo") return { bg: t.err, fg: "#000000", title: "YOLO" };
  return { bg: t.userBg, fg: "#FFFFFF", title: "NORMAL" };
}

/** 短状态：图标 + 英文 */
function shortStatus(
  mode: EventMode,
  aborting: boolean,
  detail?: string,
): { icon: string; en: string; colorKey: "idle" | "busy" | "err" } {
  if (aborting) return { icon: "✕", en: "ABORT", colorKey: "err" };
  switch (mode) {
    case "thinking":
      return { icon: "◈", en: "THINK", colorKey: "busy" };
    case "generating":
      return { icon: "◆", en: "GEN", colorKey: "busy" };
    case "tool_pending":
      return { icon: "▣", en: detail ? `TOOL ${detail.slice(0, 12)}` : "TOOL", colorKey: "busy" };
    case "error":
      return { icon: "✕", en: "ERR", colorKey: "err" };
    default:
      return { icon: "○", en: "IDLE", colorKey: "idle" };
  }
}

function ChromeShell({
  children,
  midBg,
}: {
  children: React.ReactNode;
  midBg: string;
}) {
  const t = useTheme();
  const term = useTerminalSize();
  const fb = t.footerBg;
  const top = techFillTop(term.cols, " ");
  return (
    <Box flexShrink={0} width="100%" backgroundColor={fb} flexDirection="row">
      <Text backgroundColor={fb} color={t.bg}>{top.left}</Text>
      <Box flexGrow={1} backgroundColor={midBg} flexDirection="row" justifyContent="space-between">
        {children}
      </Box>
      <Text backgroundColor={fb} color={t.bg}>{top.right}</Text>
    </Box>
  );
}

export function EventBlock({ draft = "" }: { draft?: string }) {
  const t = useTheme();
  const eventBlock = useStore((s) => s.eventBlock);
  const streaming = useStore((s) => s.streaming);
  const aborting = useStore((s) => s.aborting);
  const supervisor = useStore((s) => s.supervisor);
  const supervisorMessages = useStore((s) => s.supervisorMessages);
  const expanded = useStore((s) => s.eventBlockExpanded);
  const approvalMode = useStore((s) => s.approvalMode);
  const currentRoundUsage = useStore((s) => s.currentRoundUsage);
  const rounds = useStore((s) => s.rounds);
  const messages = useStore((s) => s.messages);
  const agentName = useStore((s) => s.agentName);
  const term = useTerminalSize();

  const style = approvalStyle(approvalMode, t);
  const meta = APPROVAL_LABELS[approvalMode] ?? APPROVAL_LABELS.normal;

  // system prompt 只在 agent 切换时重算（与 /prompt 同源，作空闲 ↑ 预估）
  const systemPromptText = useMemo(() => {
    try {
      const r = previewCurrentSystemPrompt(agentName || "coding");
      return r.ok ? r.text : "";
    } catch {
      return "";
    }
  }, [agentName]);

  // ── 监督 ──────────────────────────────────────────────
  if (supervisor?.active) {
    const stateLabel: Record<string, string> = {
      planning: "规划中",
      confirming_plan: "待确认计划",
      started: `执行中 · ${supervisor.verifyRounds ?? 0} 轮`,
      confirming: "待最终验收",
      ended: "已结束",
    };
    const label = stateLabel[supervisor.state] ?? supervisor.state;
    const stateColor =
      supervisor.state === "confirming_plan" || supervisor.state === "confirming"
        ? t.warn
        : t.accent;
    if (!expanded) {
      return (
        <EventBlockCollapsed
          label={label}
          stateColor={stateColor}
          verdict={supervisor.lastVerdict}
        />
      );
    }
    return (
      <EventBlockExpanded
        label={label}
        stateColor={stateColor}
        verdict={supervisor.lastVerdict}
        messages={supervisorMessages}
        cols={term.cols}
      />
    );
  }

  // ── 主会话 ────────────────────────────────────────────
  const liveMode: EventMode = aborting
    ? "error"
    : streaming || eventBlock.mode === "error"
      ? eventBlock.mode
      : "idle";

  const st = shortStatus(liveMode, aborting, eventBlock.detail);

  // 未缓存新输入
  let uncached = 0;
  let uncachedApprox = false;
  if (streaming || (currentRoundUsage.input > 0 && liveMode !== "idle")) {
    // 忙碌：真实 usage（input − cache_read）
    uncached = uncachedInputTokens({
      input_tokens: currentRoundUsage.input,
      cache_read_input_tokens: currentRoundUsage.cacheRead ?? 0,
    });
  } else {
    // 空闲：预估下一发「整包」请求的未缓存 input
    // = system + 会话消息（正文/think/tool）+ 输入框草稿
    // 不只是草稿几个字
    const historyMsgs = messages.map((m) => ({
      content: messageToEstimateText(m),
    }));
    if (draft.trim()) {
      historyMsgs.push({ content: draft });
    }
    const totalEst = estimateContextTokens({
      systemPrompt: systemPromptText || undefined,
      messages: historyMsgs,
    });
    const lastRound = rounds.length > 0 ? rounds[rounds.length - 1]! : null;
    const lastCache = lastRound?.cacheRead ?? 0;
    if (lastCache > 0 && totalEst > 0) {
      // 有历史缓存命中时：预估可复用 ≈ 上轮 cache_read，新 input ≈ total − cache
      // 下限至少包含当前草稿（新用户消息必为新 token）
      const draftTok = draft.trim() ? estimateTokens(draft) : 0;
      uncached = Math.max(draftTok, totalEst - lastCache);
    } else {
      // 首轮或无缓存：整包都算新输入
      uncached = totalEst;
    }
    uncachedApprox = true;
  }

  // 最近一轮 in/out：忙碌看当前累计；空闲看 rounds 末条
  const last = rounds.length > 0 ? rounds[rounds.length - 1]! : null;
  const rightIn = streaming ? currentRoundUsage.input : (last?.input ?? 0);
  const rightOut = streaming ? currentRoundUsage.output : (last?.output ?? 0);

  const midW = Math.max(8, term.cols - 2);
  // 三栏：左状态+↑uncached | 中模式 | 右 最近轮 in/out
  const leftBudget = Math.max(10, Math.floor(midW * 0.32));
  const rightBudget = Math.max(10, Math.floor(midW * 0.28));
  const centerBudget = Math.max(8, midW - leftBudget - rightBudget);

  const leftStr = fit(
    `${st.icon} ${st.en}  ↑${uncachedApprox ? "~" : ""}${compact(uncached)}`,
    leftBudget,
  );
  const centerStr = centerFit(
    term.cols >= 60
      ? ` ${style.title} · ${meta.short} `
      : ` ${style.title} `,
    centerBudget,
  );
  const rightStr = fit(
    ` ${compact(rightIn)}↑ ${compact(rightOut)}↓ `,
    rightBudget,
  );

  const statusFg =
    st.colorKey === "err" ? "#000000"
    : st.colorKey === "busy" ? "#000000"
    : style.fg;

  return (
    <ChromeShell midBg={style.bg}>
      <Text backgroundColor={style.bg} color={statusFg} bold>
        {leftStr}
      </Text>
      <Text backgroundColor={style.bg} color={style.fg} bold>
        {centerStr}
      </Text>
      <Text backgroundColor={style.bg} color={style.fg}>
        {rightStr}
      </Text>
    </ChromeShell>
  );
}

function EventBlockCollapsed({
  label,
  stateColor,
  verdict,
}: {
  label: string;
  stateColor: string;
  verdict?: string;
}) {
  const t = useTheme();
  const fb = t.footerBg;
  const term = useTerminalSize();
  const ref = useRef<DOMElement | null>(null);
  useClickTarget(ref, () => useStore.getState().toggleEventBlockExpanded(), []);

  const left = `🎯 SUP · ${label} ▶`;
  const right =
    verdict === "pass" ? "PASS"
    : verdict === "fail" || verdict === "loop" ? "FAIL"
    : "";
  const midW = Math.max(8, term.cols - 2);
  const rightW = right ? Math.min(stringWidth(right) + 1, 10) : 0;
  const leftW = Math.max(4, midW - rightW);

  return (
    <Box ref={ref} flexShrink={0} width="100%">
      <ChromeShell midBg={fb}>
        <Text backgroundColor={fb} color={stateColor} bold>
          {fit(left, leftW)}
        </Text>
        {right ? (
          <Text backgroundColor={fb} color={verdict === "pass" ? t.ok : t.err}>
            {fit(right, rightW)}
          </Text>
        ) : (
          <Text backgroundColor={fb}>{" "}</Text>
        )}
      </ChromeShell>
    </Box>
  );
}

function EventBlockExpanded({
  label,
  stateColor,
  verdict,
  messages,
  cols,
}: {
  label: string;
  stateColor: string;
  verdict?: string;
  messages: { content: string; streaming?: boolean }[];
  cols: number;
}) {
  const t = useTheme();
  const ref = useRef<DOMElement | null>(null);
  useClickTarget(ref, () => useStore.getState().toggleEventBlockExpanded(), []);
  const contentRef = useRef(null);
  const metrics = useBoxMetrics(contentRef);
  const [offset, setOffset] = useState(0);

  const contentHeight = metrics.height ?? 0;
  const maxScroll = Math.max(0, contentHeight - EXPANDED_HEIGHT);
  const marginTop = -Math.min(offset, maxScroll);

  const scrollCmd = useStore((s) => s.supervisorScrollCmd);
  useEffect(() => {
    if (!scrollCmd) return;
    setOffset((o) =>
      scrollCmd.dir === "up" ? Math.max(0, o - 1) : Math.min(maxScroll, o + 1),
    );
  }, [scrollCmd, maxScroll]);

  void cols;

  return (
    <Box ref={ref} flexShrink={0} flexDirection="column" borderStyle="single" borderColor={stateColor}>
      <Box justifyContent="space-between" paddingX={1}>
        <Box gap={1}>
          <Text color={stateColor} bold>
            🎯 SUP · {label}
          </Text>
          <Text color={t.dim}>▼ fold</Text>
        </Box>
        {verdict && (
          <Text color={verdict === "pass" ? t.ok : t.err}>
            {verdict === "pass" ? "PASS" : "FAIL"}
          </Text>
        )}
      </Box>
      <Box height={EXPANDED_HEIGHT} overflow="hidden" flexDirection="column">
        <Box
          ref={contentRef}
          flexShrink={0}
          marginTop={marginTop}
          flexDirection="column"
          paddingX={1}
        >
          {messages.length === 0 ? (
            <Text color={t.dim}>(supervisor output)</Text>
          ) : (
            messages.map((m, i) => (
              <Text key={i} color={t.fg} wrap="wrap">
                {m.content || " "}
              </Text>
            ))
          )}
        </Box>
      </Box>
    </Box>
  );
}
