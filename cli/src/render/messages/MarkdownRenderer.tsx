/**
 * MarkdownRenderer —— marked lexer → Ink 节点（ESM，兼容 Ink 7 / yoga TLA）。
 *
 * 不用 ink-markdown：其为 CJS 且 require('ink')，在 Ink 7（ESM + yoga top-level await）
 * 下会炸 ERR_REQUIRE_ASYNC_MODULE / tsx TransformError。
 *
 * 代码块走 CodeBlock（cli-highlight）；其余 token 映射主题色。
 * 旧 ink-markdown 版亦在 git 历史；更早自研版见 legacy/pre-lib-migration。
 */

import React from "react";
import { Box, Text } from "ink";
import { marked, type Token } from "marked";
import { useTheme } from "../../theme/theme-context.js";
import { CodeBlock } from "./CodeBlock.js";
import { hr } from "../../layout/decorators.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";

marked.setOptions({ breaks: true, gfm: true });

function inlineText(token: Token): string {
  if ("text" in token && typeof (token as { text?: unknown }).text === "string") {
    const t = token as { text: string; tokens?: Token[] };
    if (t.tokens?.length) return t.tokens.map(inlineText).join("");
    return t.text;
  }
  if ("tokens" in token && Array.isArray((token as { tokens?: Token[] }).tokens)) {
    return ((token as { tokens: Token[] }).tokens).map(inlineText).join("");
  }
  if ("raw" in token && typeof (token as { raw?: string }).raw === "string") {
    return (token as { raw: string }).raw;
  }
  return "";
}

export function MarkdownRenderer({ md }: { md: string }) {
  const t = useTheme();
  const term = useTerminalSize();
  if (!md) return null;

  const tokens = marked.lexer(md);
  const out: React.ReactNode[] = [];
  let key = 0;

  for (const tk of tokens) {
    if (tk.type === "code") {
      const code = (tk as { text: string }).text;
      const lang = (tk as { lang?: string }).lang;
      out.push(<CodeBlock key={key++} code={code} lang={lang} />);
    } else if (tk.type === "heading") {
      const depth = (tk as { depth: number }).depth;
      const text = inlineText(tk);
      const color = depth <= 1 ? t.mdHeading : depth === 2 ? t.mdHeading2 : t.mdHeading3;
      out.push(
        <Text key={key++} color={color} bold>
          {text}
        </Text>,
      );
    } else if (tk.type === "list") {
      const items = (tk as { items: Token[] }).items ?? [];
      for (const it of items) {
        const text = inlineText(it);
        // 列表子弹在正文列内，用 · 不用 ▸，避免和主消息 logo 列 ▸ 混淆/错位
        out.push(
          <Text key={key++} color={t.fg}>
            <Text color={t.mdListBullet}>{"· "}</Text>
            {text}
          </Text>,
        );
      }
    } else if (tk.type === "blockquote") {
      const text = inlineText(tk);
      out.push(
        <Text key={key++} color={t.mdQuote}>
          <Text color={t.mdQuoteBorder}>{"│ "}</Text>
          {text}
        </Text>,
      );
    } else if (tk.type === "hr") {
      out.push(
        <Text key={key++} color={t.mdHr}>
          {hr(term.cols)}
        </Text>,
      );
    } else if (tk.type === "paragraph" || tk.type === "text" || tk.type === "space") {
      if (tk.type === "space") continue;
      const text = inlineText(tk);
      if (text) {
        out.push(
          <Text key={key++} color={t.fg} wrap="wrap">
            {text}
          </Text>,
        );
      }
    } else if (tk.type === "table") {
      // 简易表格：逐行拼 raw
      const raw = (tk as { raw?: string }).raw ?? inlineText(tk);
      if (raw) {
        out.push(
          <Text key={key++} color={t.fg} wrap="wrap">
            {raw}
          </Text>,
        );
      }
    }
  }

  return <Box flexDirection="column">{out}</Box>;
}
