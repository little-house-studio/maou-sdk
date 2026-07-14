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
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import stringWidth from "string-width";
import { uncachedInputTokens } from "@little-house-studio/agent";
import { estimateTokens, estimateContextTokens } from "@little-house-studio/llm";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { compact, techFillTop } from "../layout/decorators.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useBoxSize } from "../hooks/useBoxSize.js";
import { useClickTarget } from "../input/click-target.js";
import { previewCurrentSystemPrompt } from "../lib/preview-system.js";
import {
  APPROVAL_LABELS,
  type ApprovalMode,
  type EventMode,
  type ChatMessage,
} from "../state/types.js";
import { useAnimFrame, spinnerChar, neonRgb } from "../hooks/useAnimFrame.js";
import {
  formatElapsed,
  useBackgroundTerminals,
  type BgTerminalInfo,
} from "../hooks/useBackgroundTerminals.js";
import { modelReportsPromptCache } from "../lib/prompt-cache.js";

/** 流式时 EventBlock 不读历史消息（避免每 delta 订 messages 全表） */
const EMPTY_MSGS_FOR_EST: ChatMessage[] = [];

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

/** 右对齐：不足宽度时左侧补空格 */
function fitRight(text: string, width: number): string {
  if (width <= 0) return "";
  let out = "";
  let used = 0;
  for (const ch of text) {
    const w = stringWidth(ch) || 1;
    if (used + w > width) break;
    out += ch;
    used += w;
  }
  if (used < width) return " ".repeat(width - used) + out;
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

/** 审核模式色（字色统一黑，NORMAL 浅底以区分 footer） */
function approvalStyle(mode: ApprovalMode, t: ReturnType<typeof useTheme>) {
  if (mode === "auto") return { bg: t.warn, fg: "#000000", title: "AUTO" };
  if (mode === "yolo") return { bg: t.err, fg: "#000000", title: "YOLO" };
  // NORMAL：浅灰底 + 黑字（原深灰底白字对比弱、与 chrome 融在一起）
  return { bg: t.inputFieldBg, fg: "#000000", title: "NORMAL" };
}

/** 短状态：图标 + 英文 */
function shortStatus(
  mode: EventMode,
  aborting: boolean,
  detail?: string,
  opts?: {
    bgRunning?: BgTerminalInfo[];
    model?: string;
    /** 本轮缓存命中 %（0–100），未知 null */
    cacheHitPct?: number | null;
  },
): { icon: string; en: string; colorKey: "idle" | "busy" | "err" | "warn" } {
  if (aborting) return { icon: "✕", en: "ABORT", colorKey: "err" };

  const running = opts?.bgRunning ?? [];
  // 后台终端：优先 TERM（模型仍在跑）/ WAIT（空闲等任务）
  if (running.length > 0) {
    const primary = running[0]!;
    const idShort = primary.id.length > 14 ? `${primary.id.slice(0, 12)}…` : primary.id;
    const pct =
      primary.progressPct != null
        ? `${primary.progressPct}%`
        : opts?.cacheHitPct != null
          ? `${opts.cacheHitPct}%`
          : formatElapsed(primary.elapsedMs);
    const modelShort = (opts?.model || "").split("/").pop() || opts?.model || "";
    if (mode === "idle" || mode === "error") {
      // 模型空闲、后台还在跑 → WAIT term_xxx
      return {
        icon: "⏳",
        en: running.length > 1 ? `WAIT ×${running.length}` : `WAIT ${idShort}`,
        colorKey: "warn",
      };
    }
    // 模型仍在思考/工具中 + 后台任务 → TERM ↓model 24%
    const modelPart = modelShort ? `↓${modelShort.slice(0, 10)}` : "↓";
    return {
      icon: "▣",
      en: `TERM ${modelPart} ${pct}`.trim(),
      colorKey: "busy",
    };
  }

  switch (mode) {
    case "thinking":
      return { icon: "◈", en: "THINK", colorKey: "busy" };
    case "generating":
      return { icon: "◆", en: "GEN", colorKey: "busy" };
    case "tool_pending":
      return { icon: "▣", en: detail ? `TOOL ${detail.slice(0, 12)}` : "TOOL", colorKey: "busy" };
    case "retrying": {
      // 优先展示简短原因，过长则只写 RETRY
      const d = (detail ?? "").replace(/\s+/g, " ").trim();
      const short =
        d.length === 0
          ? "RETRY"
          : d.length <= 14
            ? `RETRY ${d}`
            : `RETRY ${d.slice(0, 12)}…`;
      return { icon: "↻", en: short, colorKey: "warn" };
    }
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
      {/* 子项按固定列宽顺序铺满，不用 space-between（避免右栏悬空不贴边） */}
      <Box flexGrow={1} backgroundColor={midBg} flexDirection="row">
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
  // 流式中预估走 usage，不订 messages → 避免每 delta 重渲底栏
  const messages = useStore((s) => (s.streaming ? EMPTY_MSGS_FOR_EST : s.messages));
  const agentName = useStore((s) => s.agentName);
  const model = useStore((s) => s.model);
  const provider = useStore((s) => s.provider);
  const term = useTerminalSize();
  const { running: bgRunning } = useBackgroundTerminals();

  const style = approvalStyle(approvalMode, t);
  const meta = APPROVAL_LABELS[approvalMode] ?? APPROVAL_LABELS.normal;

  // system prompt 只在 agent 切换时重算（与 /prompt 同源，作空闲 ↑ 预估）
  const systemPromptText = useMemo(() => {
    try {
      const r = previewCurrentSystemPrompt(agentName);
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
  // retrying 在 streaming 期间保持可见（不会被刷成 idle）
  const liveMode: EventMode = aborting
    ? "error"
    : streaming || eventBlock.mode === "error" || eventBlock.mode === "retrying"
      ? eventBlock.mode === "idle" && streaming
        ? "thinking"
        : eventBlock.mode
      : "idle";

  const isRetry = liveMode === "retrying";
  const hasBg = bgRunning.length > 0;
  const busy = (streaming && !aborting) || isRetry || hasBg;
  const anim = useAnimFrame(busy, 130);
  // 本轮缓存命中 %：仅主模型且支持 cache 上报时有意义（xopqwen 等 → null）
  const cacheHitPct = (() => {
    if (!modelReportsPromptCache(model, provider)) return null;
    if (currentRoundUsage.input > 0 && currentRoundUsage.cacheEligible !== false) {
      return Math.round(((currentRoundUsage.cacheRead ?? 0) / currentRoundUsage.input) * 100);
    }
    const lastR = rounds.length > 0 ? rounds[rounds.length - 1]! : null;
    if (lastR && (lastR.input ?? 0) > 0 && lastR.cacheEligible !== false) {
      return Math.round(((lastR.cacheRead ?? 0) / lastR.input) * 100);
    }
    return null;
  })();
  const st = shortStatus(liveMode, aborting, eventBlock.detail, {
    bgRunning,
    model,
    cacheHitPct,
  });
  // 忙碌：状态 chip 霓虹变色；重试时用警告黄底，更醒目
  const busyRgb = neonRgb(anim * 0.6);
  const busyHex = `#${busyRgb.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  const leftIcon = busy ? spinnerChar(anim) : st.icon;
  const leftFg = "#000000";

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

  // 状态 chip 本体（会霓虹）；其余左栏空白用静态底，避免整段宽条五颜六色
  const statusCore = `${leftIcon} ${st.en}${busy ? spinnerChar(anim + 3) : ""}  ↑${uncachedApprox ? "~" : ""}${compact(uncached)}`;
  const statusCoreW = Math.min(leftBudget, Math.max(1, stringWidth(statusCore)));
  const statusPad = Math.max(0, leftBudget - statusCoreW);
  const centerStr = centerFit(
    term.cols >= 60
      ? ` ${style.title} · ${meta.short} `
      : ` ${style.title} `,
    centerBudget,
  );
  // 右栏右对齐贴 ◥ 内侧
  const rightStr = fitRight(
    `${compact(rightIn)}↑ ${compact(rightOut)}↓ `,
    rightBudget,
  );

  // 中/右始终审核模式底色；左 chip：重试/WAIT 警告黄，其它 busy 霓虹，空闲跟审核底
  const barBg = style.bg;
  const statusBg =
    isRetry || (hasBg && !streaming)
      ? t.warn
      : busy
        ? busyHex
        : style.bg;
  return (
    <ChromeShell midBg={barBg}>
      <Text backgroundColor={statusBg} color={leftFg} bold>
        {statusCore}
      </Text>
      {statusPad > 0 ? (
        <Text backgroundColor={barBg} color={leftFg}>
          {" ".repeat(statusPad)}
        </Text>
      ) : null}
      <Text backgroundColor={barBg} color="#000000" bold>
        {centerStr}
      </Text>
      <Text backgroundColor={barBg} color="#000000">
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
  const metrics = useBoxSize(contentRef, [
    messages.length,
    // 监督输出变长时重测高度
    messages.reduce((n, m) => n + (m.content?.length ?? 0), 0),
  ]);
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
