/**
 * ToolCard —— 工具调用卡片（两级折叠）
 *
 * 外层（默认收纳）：
 *   标题：name + 目标摘要 + reason + 耗时
 *   点击标题/卡片头 → 展开看输入与结果
 *
 * 内层（展开后）：
 *   输入 args / 输出 result 过长默认折叠，各自点击可再展开/收纳
 */

import React, { useState, useMemo, useRef, useEffect } from "react";
import { Box, Text, useBoxMetrics } from "ink";
import type { DOMElement } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import { useStore } from "../../state/store.js";
import type { ToolCardState } from "../../state/types.js";
import { DiffRenderer } from "./DiffRenderer.js";
import { useClickTarget } from "../../input/click-target.js";
import { truncate, durationStr } from "../../layout/decorators.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";
import { CollapsibleText } from "./Collapsible.js";

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
  const [open, setOpen] = useState(false);

  const waiting = !tool.done && tool.result === undefined;
  const term = useTerminalSize();
  const innerW = Math.max(12, term.cols - 12);

  const parsed = useMemo(() => parseArgs(tool.args), [tool.args]);
  const callDur = durationStr(tool.callDuration);

  // 标题摘要：优先 path/command；reason 单独一行或跟在后面
  const targetShort = useMemo(
    () => (parsed.target ? truncate(parsed.target.replace(/\n/g, " "), Math.max(8, Math.floor(innerW * 0.35))) : ""),
    [parsed.target, innerW],
  );
  const reasonShort = useMemo(
    () =>
      parsed.reason
        ? truncate(parsed.reason.replace(/\n/g, " "), Math.max(12, Math.floor(innerW * 0.4)))
        : "",
    [parsed.reason, innerW],
  );

  const headRef = useRef<DOMElement | null>(null);
  const rootRef = useRef<DOMElement | null>(null);
  const rootMetrics = useBoxMetrics(rootRef);
  const prevHeightRef = useRef<number>(0);

  const canExpand = tool.result !== undefined || tool.done || !!tool.args;
  const toggle = () => {
    if (canExpand) setOpen((o) => !o);
  };
  // 只在标题行注册点击，避免与内层 Collapsible 抢点
  const cid = useClickTarget(headRef, toggle, [tool.result, tool.id, open, tool.done, canExpand]);
  const isHover = useStore((s) => s.hoverId) === cid;

  useEffect(() => {
    const h = rootMetrics.height ?? 0;
    const delta = h - prevHeightRef.current;
    if (prevHeightRef.current > 0 && delta !== 0) {
      useStore.getState().expandShift(delta);
    }
    prevHeightRef.current = h;
  }, [rootMetrics.height]);

  const isDiff = useMemo(
    () => isWrite && !!tool.result && /^@@ |^--- |^\+\+\+ /m.test(tool.result),
    [tool.result, isWrite],
  );

  const borderColor = isHover ? t.accent : t.border;
  const headBg = isHover
    ? t.accent
    : waiting
      ? t.warn
      : tool.isError
        ? t.err
        : t.accent;

  const chevron = canExpand ? (open ? "▼" : "▶") : waiting ? "…" : "";

  return (
    <Box
      ref={rootRef}
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
      width={Math.max(16, term.cols - 6)}
      flexShrink={0}
    >
      {/* ── 标题行：name + 目标 + reason + 耗时 ── */}
      <Box ref={headRef} flexDirection="column">
        <Box>
          <Text backgroundColor={headBg} color="#000" bold>{` ${tool.name} `}</Text>
          {targetShort ? (
            <Text color={t.muted}>{` ${targetShort} `}</Text>
          ) : null}
          <Text color={t.dim}>
            {`${callDur ? `(${callDur}) ` : ""}${chevron}`}
          </Text>
        </Box>
        {/* 收纳态也显示 reason（工具「做什么」） */}
        {reasonShort ? (
          <Text color={isHover ? t.accent : t.dim} wrap="truncate-end">
            {`  ${reasonShort}`}
          </Text>
        ) : null}
      </Box>

      {/* ── 展开：输入 + 输出，各自可再折叠 ── */}
      {open && (
        <Box flexDirection="column" marginTop={0}>
          <ArgsSection text={parsed.pretty} maxWidth={innerW} />
          {tool.result !== undefined && (
            <ResultSection
              result={String(tool.result)}
              isError={tool.isError}
              isDiff={isDiff}
            />
          )}
          {waiting && (
            <Text color={t.warn}>{"  … 执行中"}</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
