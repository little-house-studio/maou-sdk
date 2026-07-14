/**
 * ToolCard —— 工具调用行（无边框，弱化卡片感）
 *
 * 收纳态单行：
 *   [name 色底] target reason ▶
 * 点击标题行 → 展开输入/结果；执行中可看 ring/进度
 */

import React, { useState, useMemo, useRef, useEffect } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import stringWidth from "string-width";
import { useTheme } from "../../theme/theme-context.js";
import { useStore } from "../../state/store.js";
import type { ToolCardState } from "../../state/types.js";
import { DiffRenderer } from "./DiffRenderer.js";
import { useClickTarget } from "../../input/click-target.js";
import { durationStr } from "../../layout/decorators.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";
import { readBoxHeight } from "../../hooks/useBoxSize.js";
import { CollapsibleText } from "./Collapsible.js";
import { useAnimFrame, spinnerChar, neonRgb } from "../../hooks/useAnimFrame.js";
import { chatBodyCols } from "../../layout/chat-width.js";
import {
  extractProgressPct,
  formatElapsed,
  pctBar,
  ringChar,
  useBackgroundTerminals,
} from "../../hooks/useBackgroundTerminals.js";

const WRITE_TOOLS = new Set([
  "create", "edit", "write", "patch", "rm", "remove", "mkdir", "move",
  "write_file", "edit_file",
]);

/** 从 args JSON 抽出展示用字段 */
function parseArgs(args: string): {
  reason: string;
  target: string;
  pretty: string;
  raw: Record<string, unknown> | null;
} {
  try {
    const a = JSON.parse(args) as Record<string, unknown>;
    const reason = typeof a.reason === "string" ? a.reason.trim() : "";
    const target = String(
      a.path ?? a.file_path ?? a.command ?? a.pattern ?? a.query ?? a.name ?? a.url ?? "",
    ).trim();
    // 美化 JSON；reason 单独展示时可从 pretty 里去掉重复
    const pretty = JSON.stringify(a, null, 2);
    return { reason, target, pretty, raw: a };
  } catch {
    return {
      reason: "",
      target: args.slice(0, 40),
      pretty: args,
      raw: null,
    };
  }
}

/** 输入区：参数 JSON 可折叠 */
function ArgsSection({ text, maxWidth }: { text: string; maxWidth: number }) {
  const t = useTheme();
  if (!text || text === "{}" || text === "{\n}") return null;
  return (
    <Box flexDirection="column" marginTop={0}>
      <Text color={t.dim}>{"▸ 输入"}</Text>
      <CollapsibleText
        text={text}
        color={t.warn}
        maxLines={6}
      />
    </Box>
  );
}

/** 输出区：结果可折叠（diff 整块也可折） */
function ResultSection({
  result,
  isError,
  isDiff,
}: {
  result: string;
  isError?: boolean;
  isDiff: boolean;
}) {
  const t = useTheme();
  if (result === undefined || result === "") return null;

  return (
    <Box flexDirection="column" marginTop={0}>
      <Text color={t.dim}>{isError ? "▸ 输出（失败）" : "▸ 输出"}</Text>
      {isDiff ? (
        // diff 可能很长：外包一层 CollapsibleText 用纯文本预览；展开后仍用 DiffRenderer 更好
        // 这里用 Collapsible 控制是否显示完整 DiffRenderer
        <DiffCollapsible result={result} color={isError ? t.err : t.toolResult} />
      ) : (
        <CollapsibleText
          text={result}
          color={isError ? t.err : t.toolResult}
          maxLines={8}
        />
      )}
    </Box>
  );
}

function DiffCollapsible({ result, color }: { result: string; color: string }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<DOMElement | null>(null);
  const lines = result.split("\n").length;
  const need = lines > 12;
  const cid = useClickTarget(
    ref,
    () => {
      if (need) setOpen((o) => !o);
    },
    [need, open],
  );
  const isHover = useStore((s) => s.hoverId) === cid;

  if (!need || open) {
    return (
      <Box ref={ref} flexDirection="column">
        <DiffRenderer diff={result} />
        {need && (
          <Text color={isHover ? t.accent : t.dim}>
            {" ▲ 收起 diff"}
          </Text>
        )}
      </Box>
    );
  }

  // 折叠：只显示前几行纯文本
  const preview = result.split("\n").slice(0, 8).join("\n");
  return (
    <Box ref={ref} flexDirection="column">
      <CollapsibleText text={preview} color={color} maxLines={8} />
      <Text color={isHover ? t.accent : t.dim}>
        {` ▼ 展开完整 diff（${lines} 行 · 点击展开）`}
      </Text>
    </Box>
  );
}

/** 是否「长命令」：use_terminal / bash / 参数含 background 或命令偏长 */
function isLongCommandTool(name: string, args: string, raw: Record<string, unknown> | null): boolean {
  const n = name.toLowerCase();
  if (n === "use_terminal" || n === "bash" || n === "terminal" || n === "shell") return true;
  if (raw && (raw.background === true || raw.action === "run")) return true;
  if (typeof raw?.command === "string" && raw.command.length >= 40) return true;
  // 结果很长时也算（用于完成后默认展开）
  if (args.length > 200) return true;
  return false;
}

export function ToolCard({
  tool,
  index: _index,
  frame: _frame,
}: {
  tool: ToolCardState;
  index: number;
  frame: number;
}) {
  const t = useTheme();
  const isWrite = WRITE_TOOLS.has(tool.name.toLowerCase());
  const waiting = !tool.done && tool.result === undefined;
  const parsed = useMemo(() => parseArgs(tool.args), [tool.args]);
  const longCmd = isLongCommandTool(tool.name, tool.args, parsed.raw);
  // 仅执行中默认展开；历史/已完成卡一律折叠（用户点过标题后以手动为准）
  const [open, setOpen] = useState(() => waiting);
  const [userToggled, setUserToggled] = useState(false);

  // 进入 waiting：若未手动操作则展开（看 ring/进度）
  useEffect(() => {
    if (waiting && !userToggled) setOpen(true);
  }, [waiting, userToggled]);

  // 完成/历史：未手动操作则强制收起，降挂载与 paint 成本
  useEffect(() => {
    if (!waiting && !userToggled) setOpen(false);
  }, [waiting, userToggled]);

  const anim = useAnimFrame(waiting, 140);
  const term = useTerminalSize();
  // 无边框：直接用正文列宽
  const lineW = Math.max(12, chatBodyCols(term.cols));
  // 仅执行中或用户主动展开时订终端轮询
  const { running: bgRunning } = useBackgroundTerminals({
    enabled: waiting || (longCmd && open),
  });

  const callDur = durationStr(tool.callDuration);
  const termId =
    (typeof parsed.raw?.id === "string" && parsed.raw.id) ||
    (typeof parsed.raw?.terminal_id === "string" && parsed.raw.terminal_id) ||
    null;
  const matchedBg = termId
    ? bgRunning.find((x) => x.id === termId)
    : bgRunning.find((x) =>
        tool.name.toLowerCase().includes("terminal") &&
        (x.command === String(parsed.raw?.command ?? "") ||
          x.description === String(parsed.raw?.description ?? "")),
      );
  const liveElapsed = matchedBg?.elapsedMs
    ?? (tool.callStartTs ? Date.now() - tool.callStartTs : 0);
  const livePct =
    matchedBg?.progressPct ??
    extractProgressPct(tool.result ?? "", String(parsed.raw?.command ?? ""), parsed.reason);

  const headRef = useRef<DOMElement | null>(null);
  const rootRef = useRef<DOMElement | null>(null);
  const prevHeightRef = useRef<number>(0);

  const canExpand = tool.result !== undefined || tool.done || !!tool.args || waiting;
  const toggle = () => {
    if (!canExpand) return;
    setUserToggled(true);
    // 展开前记下高度；禁止 useBoxMetrics 持续监听（滚动时 top 漂移 → #185）
    prevHeightRef.current = readBoxHeight(rootRef) || prevHeightRef.current;
    setOpen((o) => !o);
  };
  // 只在标题行注册点击，避免与内层 Collapsible 抢点
  const cid = useClickTarget(headRef, toggle, [tool.result, tool.id, open, tool.done, canExpand]);
  const isHover = useStore((s) => s.hoverId) === cid;

  // 用户手动展开/收起后：一次性测高并 shift 滚动，不挂 layout 监听
  useEffect(() => {
    if (!userToggled) {
      // 首帧/历史卡：只记高度，不 shift（避免加载历史时 N 卡连环 expandShift）
      const t = setTimeout(() => {
        const h = readBoxHeight(rootRef);
        if (h > 0) prevHeightRef.current = h;
      }, 0);
      return () => clearTimeout(t);
    }
    let alive = true;
    const apply = () => {
      if (!alive) return;
      const h = readBoxHeight(rootRef);
      if (h <= 0) return;
      const prev = prevHeightRef.current;
      const delta = h - prev;
      prevHeightRef.current = h;
      if (prev > 0 && delta !== 0) {
        useStore.getState().expandShift(delta);
      }
    };
    const t0 = setTimeout(apply, 0);
    const t1 = setTimeout(apply, 16);
    const t2 = setTimeout(apply, 48);
    return () => {
      alive = false;
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [open, userToggled]);

  const isDiff = useMemo(
    () => isWrite && !!tool.result && /^@@ |^--- |^\+\+\+ /m.test(tool.result),
    [tool.result, isWrite],
  );

  // 执行中：名称底色霓虹脉冲（无边框）
  const pulseRgb = neonRgb(anim * 0.5);
  const pulseHex = `#${pulseRgb.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  const headBg = isHover
    ? t.accent
    : waiting
      ? pulseHex
      : tool.isError
        ? t.err
        : t.accent;

  const spin = spinnerChar(anim);
  const chevron = canExpand ? (open ? "▼" : "▶") : waiting ? spin : "";

  // 单行：name 色底 + target + reason + (dur) chevron
  const nameLabel = waiting ? ` ${spin} ${tool.name} ` : ` ${tool.name} `;
  const tailLabel = `${callDur ? `(${callDur}) ` : ""}${chevron}`;
  const nameW = stringWidth(nameLabel);
  const tailW = stringWidth(tailLabel ? ` ${tailLabel}` : "");
  let remain = Math.max(0, lineW - nameW - tailW);

  /** 按视觉列宽截断（CJK=2） */
  const clipVis = (s: string, maxW: number): string => {
    if (maxW <= 1) return "…";
    if (stringWidth(s) <= maxW) return s;
    let used = 0;
    let out = "";
    for (const ch of s) {
      const w = stringWidth(ch) || 1;
      if (used + w > maxW - 1) break;
      out += ch;
      used += w;
    }
    return out + "…";
  };

  let targetPart = "";
  if (parsed.target && remain > 4) {
    const rawT = parsed.target.replace(/\n/g, " ");
    // target 最多占剩余一半，给 reason 留空
    const tMax = Math.max(4, Math.min(stringWidth(rawT), Math.floor(remain * 0.5)));
    const tBody = clipVis(rawT, tMax);
    if (tBody) {
      targetPart = ` ${tBody}`;
      remain -= stringWidth(targetPart);
    }
  }

  let reasonPart = "";
  if (parsed.reason && remain > 3) {
    const rawR = parsed.reason.replace(/\n/g, " ");
    const rBody = clipVis(rawR, remain - 1); // 前导空格
    if (rBody) reasonPart = ` ${rBody}`;
  }

  return (
    <Box
      ref={rootRef}
      flexDirection="column"
      width={lineW}
      flexShrink={0}
      overflow="hidden"
    >
      {/* 无边框单行：工具名色底 + 摘要 + chevron */}
      <Box ref={headRef} flexDirection="row" width={lineW} overflow="hidden">
        <Text backgroundColor={headBg} color="#000" bold>
          {nameLabel}
        </Text>
        {targetPart ? <Text color={t.muted}>{targetPart}</Text> : null}
        {reasonPart ? (
          <Text color={isHover ? t.accent : waiting ? pulseHex : t.dim}>{reasonPart}</Text>
        ) : null}
        {tailLabel ? (
          <Text color={waiting ? pulseHex : t.dim}>{` ${tailLabel}`}</Text>
        ) : null}
      </Box>

      {/* 展开：输入 / 输出 / 进度（仍无外框） */}
      {open && (
        <Box flexDirection="column" marginTop={0} width={lineW}>
          <ArgsSection text={parsed.pretty} maxWidth={lineW} />
          {tool.result !== undefined && (
            <ResultSection
              result={String(tool.result)}
              isError={tool.isError}
              isDiff={isDiff}
            />
          )}
          {waiting && (
            <Box flexDirection="column" marginTop={0}>
              <Text color={pulseHex}>
                {`  ${ringChar(anim)} ${spin} 执行中… ${formatElapsed(liveElapsed)}`}
                {livePct != null ? ` · ${livePct}%` : ""}
                {termId || matchedBg?.id ? ` · ${termId || matchedBg?.id}` : ""}
              </Text>
              <Text color={t.dim}>
                {`  ${pctBar(livePct, Math.min(16, Math.max(8, lineW - 4)), anim)}`}
                {livePct != null ? ` ${livePct}%` : " running"}
              </Text>
            </Box>
          )}
        </Box>
      )}
      {/* 收纳态：长命令一行 ring 进度 */}
      {!open && waiting && longCmd && (
        <Text color={pulseHex}>
          {` ${ringChar(anim)} ${formatElapsed(liveElapsed)}`}
          {livePct != null ? ` ${livePct}%` : ""}
          {` ${pctBar(livePct, 8, anim)}`}
        </Text>
      )}
    </Box>
  );
}
