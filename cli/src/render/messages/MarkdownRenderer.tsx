/**
 * MarkdownRenderer —— marked lexer → Ink 节点（ESM，兼容 Ink 7 / yoga TLA）。
 *
 * - GFM 表格：框线 + 列分隔（┌─┬─┐ / │ │ / └──┘）
 * - maxLines：折叠预览时截断渲染行数（仍走 MD，不是原文管道符）
 * - 行内 code / strong / em / link 着色
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { marked, type Token } from "marked";
import stringWidth from "string-width";
import { useTheme } from "../../theme/theme-context.js";
import type { ThemeTokens } from "../../theme/tokens.js";
import { CodeBlock } from "./CodeBlock.js";
import { hr } from "../../layout/decorators.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";
import { chatBodyCols } from "../../layout/chat-width.js";

marked.setOptions({ breaks: true, gfm: true });

// ─── 行内 ─────────────────────────────────────────────────────────────────

function plainInline(token: Token): string {
  if ("text" in token && typeof (token as { text?: unknown }).text === "string") {
    const t = token as { text: string; tokens?: Token[] };
    if (t.tokens?.length) return t.tokens.map(plainInline).join("");
    return t.text;
  }
  if ("tokens" in token && Array.isArray((token as { tokens?: Token[] }).tokens)) {
    return ((token as { tokens: Token[] }).tokens).map(plainInline).join("");
  }
  if ("raw" in token && typeof (token as { raw?: string }).raw === "string") {
    return (token as { raw: string }).raw;
  }
  return "";
}

/** 行内 token → 带样式的 Text 片段 */
function inlineNodes(
  tokens: Token[] | undefined,
  fallback: string,
  t: ThemeTokens,
  keyPrefix: string,
): React.ReactNode {
  if (!tokens?.length) {
    return fallback;
  }
  return tokens.map((tok, i) => {
    const k = `${keyPrefix}-${i}`;
    switch (tok.type) {
      case "codespan": {
        const text = (tok as { text: string }).text;
        return (
          <Text key={k} color={t.mdCode}>
            {text}
          </Text>
        );
      }
      case "strong":
        return (
          <Text key={k} bold color={t.fg}>
            {inlineNodes((tok as { tokens?: Token[] }).tokens, plainInline(tok), t, k)}
          </Text>
        );
      case "em":
        return (
          <Text key={k} color={t.muted} italic>
            {inlineNodes((tok as { tokens?: Token[] }).tokens, plainInline(tok), t, k)}
          </Text>
        );
      case "link": {
        const label = plainInline(tok);
        const href = (tok as { href?: string }).href ?? "";
        return (
          <Text key={k} color={t.mdLink}>
            {label}
            {href && href !== label ? (
              <Text color={t.dim}>{` (${href})`}</Text>
            ) : null}
          </Text>
        );
      }
      case "del":
        return (
          <Text key={k} color={t.dim} strikethrough>
            {inlineNodes((tok as { tokens?: Token[] }).tokens, plainInline(tok), t, k)}
          </Text>
        );
      case "text":
      case "escape":
      case "html":
        return (
          <Text key={k} color={t.fg}>
            {plainInline(tok)}
          </Text>
        );
      default:
        if ("tokens" in tok && Array.isArray((tok as { tokens?: Token[] }).tokens)) {
          return (
            <Text key={k} color={t.fg}>
              {inlineNodes((tok as { tokens: Token[] }).tokens, plainInline(tok), t, k)}
            </Text>
          );
        }
        return (
          <Text key={k} color={t.fg}>
            {plainInline(tok)}
          </Text>
        );
    }
  });
}

// ─── 表格 ─────────────────────────────────────────────────────────────────

type TableCell = { text?: string; tokens?: Token[] };

function cellPlain(cell: TableCell | string | undefined): string {
  if (cell == null) return "";
  if (typeof cell === "string") return cell;
  // 去掉围栏反引号，表格里 codespan 用着色即可
  const raw = cell.tokens?.length
    ? cell.tokens.map(plainInline).join("")
    : (cell.text ?? "");
  return raw.replace(/^`+|`+$/g, "").replace(/\s+/g, " ").trim();
}

function padCell(
  text: string,
  width: number,
  align: "left" | "center" | "right" | null | undefined,
): string {
  let s = text;
  let tw = stringWidth(s);
  if (tw > width) {
    let out = "";
    let used = 0;
    const budget = Math.max(1, width - 1);
    for (const ch of s) {
      const w = stringWidth(ch) || 1;
      if (used + w > budget) break;
      out += ch;
      used += w;
    }
    s = out + "…";
    tw = stringWidth(s);
  }
  const pad = Math.max(0, width - tw);
  if (align === "right") return " ".repeat(pad) + s;
  if (align === "center") {
    const L = Math.floor(pad / 2);
    return " ".repeat(L) + s + " ".repeat(pad - L);
  }
  return s + " ".repeat(pad);
}

/**
 * 框线表格：
 *   ┌──────┬──────┐
 *   │ head │ head │
 *   ├──────┼──────┤
 *   │ cell │ cell │
 *   └──────┴──────┘
 */
function renderTable(
  tk: Token,
  maxWidth: number,
  t: ThemeTokens,
  keyBase: number,
  remainingLines: number,
): { node: React.ReactNode; lines: number } {
  const table = tk as {
    header?: TableCell[];
    rows?: TableCell[][];
    align?: Array<"left" | "center" | "right" | null>;
  };
  const header = (table.header ?? []).map(cellPlain);
  const allRows = (table.rows ?? []).map((r) => r.map(cellPlain));
  const align = table.align ?? [];
  const colCount = Math.max(header.length, ...allRows.map((r) => r.length), 0);
  if (colCount === 0) return { node: null, lines: 0 };

  // 剩余行：顶框1 + 头1 + 中框1 + 底框1 = 4 固定，其余给数据行
  const fixedChrome = 4;
  const maxDataRows = Math.max(0, remainingLines - fixedChrome);
  const rows =
    remainingLines < Infinity && allRows.length > maxDataRows
      ? allRows.slice(0, Math.max(1, maxDataRows - 1)) // 留 1 行给「…」
      : allRows;
  const truncated = rows.length < allRows.length;

  const widths = Array.from({ length: colCount }, (_, i) => {
    let w = stringWidth(header[i] ?? "") || 1;
    for (const row of allRows) {
      w = Math.max(w, stringWidth(row[i] ?? "") || 1);
    }
    return Math.min(Math.max(w, 2), 36);
  });

  // │ cell │ cell │ → 内容 + 每列两侧空格 + 列间竖线
  // total = sum(widths) + 2*colCount(空格) + (colCount+1)(竖线)
  const chromePerCol = 2; // 左右各一空格
  let inner =
    widths.reduce((a, b) => a + b, 0) +
    chromePerCol * colCount +
    (colCount + 1);
  const budget = Math.max(24, maxWidth);
  if (inner > budget) {
    const contentBudget =
      budget - chromePerCol * colCount - (colCount + 1);
    const contentSum = widths.reduce((a, b) => a + b, 0) || 1;
    const scale = Math.max(0.2, contentBudget / contentSum);
    for (let i = 0; i < widths.length; i++) {
      widths[i] = Math.max(3, Math.floor(widths[i]! * scale));
    }
    inner =
      widths.reduce((a, b) => a + b, 0) +
      chromePerCol * colCount +
      (colCount + 1);
  }

  const padArr = (arr: string[]) => {
    const out = [...arr];
    while (out.length < colCount) out.push("");
    return out.slice(0, colCount);
  };

  const makeBorder = (left: string, mid: string, right: string, fill: string) => {
    const segs = widths.map((w) => fill.repeat(w + chromePerCol));
    return left + segs.join(mid) + right;
  };

  const makeRow = (cells: string[]) => {
    const body = padArr(cells)
      .map((c, i) => ` ${padCell(c, widths[i] ?? 4, align[i])} `)
      .join("│");
    return `│${body}│`;
  };

  const top = makeBorder("┌", "┬", "┐", "─");
  const mid = makeBorder("├", "┼", "┤", "─");
  const bot = makeBorder("└", "┴", "┘", "─");

  const dataLines = truncated ? rows.length + 1 : rows.length;
  const lines = fixedChrome + dataLines;

  const node = (
    <Box key={keyBase} flexDirection="column" marginY={0}>
      <Text color={t.muted}>{top}</Text>
      <Text color={t.accent} bold>
        {makeRow(header)}
      </Text>
      <Text color={t.muted}>{mid}</Text>
      {rows.map((row, ri) => (
        <Text key={ri} color={t.fg}>
          {makeRow(row)}
        </Text>
      ))}
      {truncated ? (
        <Text color={t.dim}>
          {makeRow([`… 另有 ${allRows.length - rows.length} 行`, ...Array(colCount - 1).fill("")])}
        </Text>
      ) : null}
      <Text color={t.muted}>{bot}</Text>
    </Box>
  );

  return { node, lines };
}

// ─── 主渲染 ───────────────────────────────────────────────────────────────

export function MarkdownRenderer({
  md,
  maxLines,
  contentWidth,
}: {
  md: string;
  /** 最多渲染多少「视觉行」（折叠预览用）；不传 = 全文 */
  maxLines?: number;
  /** 内容折行/表格预算宽；不传则按终端估算 */
  contentWidth?: number;
}) {
  const t = useTheme();
  const term = useTerminalSize();
  // lexer 很重：长会话里同一 md 反复 parse 是卡顿源；md 不变则复用 tokens
  const tokens = useMemo(() => (md ? marked.lexer(md) : []), [md]);
  if (!md) return null;
  const out: React.ReactNode[] = [];
  let key = 0;
  let used = 0;
  const limit = maxLines ?? Infinity;
  const contentW = Math.max(16, contentWidth ?? chatBodyCols(term.cols) - 4);

  const can = (need: number) => used + need <= limit || used === 0;
  const spend = (n: number) => {
    used += n;
  };

  for (const tk of tokens) {
    if (used >= limit) break;

    if (tk.type === "code") {
      const code = (tk as { text: string }).text;
      const lang = (tk as { lang?: string }).lang;
      const codeLines = Math.max(1, code.split("\n").length + 2); // 边框粗估
      if (!can(Math.min(codeLines, 4)) && used > 0) break;
      out.push(
        <CodeBlock key={key++} code={code} lang={lang} maxWidth={Math.min(contentW + 2, chatBodyCols(term.cols))} />,
      );
      spend(Math.min(codeLines, limit - used + codeLines));
    } else if (tk.type === "heading") {
      if (!can(1) && used > 0) break;
      const depth = (tk as { depth: number }).depth;
      const tokensIn = (tk as { tokens?: Token[] }).tokens;
      const color = depth <= 1 ? t.mdHeading : depth === 2 ? t.mdHeading2 : t.mdHeading3;
      out.push(
        <Text key={key++} color={color} bold>
          {inlineNodes(tokensIn, plainInline(tk), t, `h${key}`)}
        </Text>,
      );
      spend(1);
    } else if (tk.type === "list") {
      const items = (tk as { items: Token[] }).items ?? [];
      for (const it of items) {
        if (used >= limit) break;
        if (!can(1) && used > 0) break;
        const itTokens = (it as { tokens?: Token[] }).tokens;
        out.push(
          <Text key={key++} color={t.fg}>
            <Text color={t.mdListBullet}>{"· "}</Text>
            {inlineNodes(itTokens, plainInline(it), t, `li${key}`)}
          </Text>,
        );
        spend(1);
      }
    } else if (tk.type === "blockquote") {
      if (!can(1) && used > 0) break;
      const bqTokens = (tk as { tokens?: Token[] }).tokens;
      out.push(
        <Text key={key++} color={t.mdQuote}>
          <Text color={t.mdQuoteBorder}>{"│ "}</Text>
          {inlineNodes(bqTokens, plainInline(tk), t, `bq${key}`)}
        </Text>,
      );
      spend(1);
    } else if (tk.type === "hr") {
      if (!can(1) && used > 0) break;
      out.push(
        <Text key={key++} color={t.mdHr}>
          {hr(Math.min(term.cols, contentW))}
        </Text>,
      );
      spend(1);
    } else if (tk.type === "table") {
      const remain = limit === Infinity ? Infinity : Math.max(4, limit - used);
      const { node, lines } = renderTable(tk, contentW, t, key++, remain);
      if (node) {
        if (!can(Math.min(lines, 4)) && used > 0) {
          // 放不下完整表：至少给一行提示
          out.push(
            <Text key={key++} color={t.dim}>
              {"…（表格已折叠，点击展开查看）"}
            </Text>,
          );
          spend(1);
          break;
        }
        out.push(node);
        spend(lines);
      }
    } else if (tk.type === "paragraph" || tk.type === "text") {
      if (!can(1) && used > 0) break;
      const pTokens = (tk as { tokens?: Token[] }).tokens;
      const plain = plainInline(tk);
      if (plain) {
        // 粗算 wrap 行数
        const wrapLines = Math.max(1, Math.ceil(stringWidth(plain) / contentW));
        out.push(
          <Text key={key++} color={t.fg} wrap="wrap">
            {inlineNodes(pTokens, plain, t, `p${key}`)}
          </Text>,
        );
        spend(Math.min(wrapLines, limit === Infinity ? wrapLines : limit - used + wrapLines));
      }
    } else if (tk.type === "space") {
      continue;
    } else {
      const text = plainInline(tk);
      if (text.trim()) {
        if (!can(1) && used > 0) break;
        out.push(
          <Text key={key++} color={t.fg} wrap="wrap">
            {text}
          </Text>,
        );
        spend(1);
      }
    }
  }

  if (maxLines != null && used >= maxLines && tokens.length > 0) {
    // 截断标记由外层折叠条负责，这里不再重复
  }

  return <Box flexDirection="column">{out}</Box>;
}

/**
 * 是否包含「结构化 Markdown」块（标题/列表/代码块/表格/引用/分隔线）。
 * 仅有普通段落/纯文本 → false（应走纯文本渲染，不套 MD 纸面）。
 */
export function hasStructuredMarkdown(md: string): boolean {
  if (!md || !md.trim()) return false;
  // 快速启发式（避免每帧 lexer）；命中再 lexer 确认
  const quick =
    /```[\s\S]*?```/.test(md) ||
    /^\s{0,3}#{1,6}\s+\S/m.test(md) ||
    /^\s{0,3}([-*+]|\d+\.)\s+\S/m.test(md) ||
    /^\s{0,3}>\s?\S/m.test(md) ||
    /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/m.test(md) ||
    /\|.+\|/.test(md);
  if (!quick) return false;
  try {
    const tokens = marked.lexer(md);
    for (const tk of tokens) {
      switch (tk.type) {
        case "heading":
        case "list":
        case "code":
        case "table":
        case "blockquote":
        case "hr":
        case "html":
          return true;
        default:
          break;
      }
    }
    return false;
  } catch {
    return quick;
  }
}

/**
 * 估算 markdown 渲染后大约多少视觉行（用于是否折叠，比纯 split\\n 更准）
 */
export function estimateMarkdownLines(md: string, colWidth: number): number {
  if (!md) return 0;
  const w = Math.max(8, colWidth);
  try {
    const tokens = marked.lexer(md);
    let lines = 0;
    for (const tk of tokens) {
      if (tk.type === "space") continue;
      if (tk.type === "table") {
        const rows = ((tk as { rows?: unknown[] }).rows ?? []).length;
        lines += 4 + rows; // 框线 + 头 + 数据
      } else if (tk.type === "code") {
        lines += Math.max(1, ((tk as { text: string }).text ?? "").split("\n").length + 2);
      } else if (tk.type === "list") {
        lines += ((tk as { items?: unknown[] }).items ?? []).length || 1;
      } else if (tk.type === "hr" || tk.type === "heading") {
        lines += 1;
      } else {
        const text = plainInline(tk);
        lines += Math.max(1, Math.ceil((stringWidth(text) || 1) / w));
      }
    }
    return Math.max(1, lines);
  } catch {
    return Math.max(1, md.split("\n").length);
  }
}
