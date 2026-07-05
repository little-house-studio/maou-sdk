/**
 * MarkdownRenderer —— marked lexer → Ink Text 元素。
 * 支持：代码块（CodeBlock 全彩）/ 标题 / 列表 / 引用 / hr / 段落。
 */

import React from "react";
import { Box, Text } from "ink";
import { marked } from "marked";
import { useTheme } from "../../theme/theme-context.js";
import { CodeBlock } from "./CodeBlock.js";
import { SelectableText } from "../SelectableText.js";
import { hr } from "../../layout/decorators.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";

marked.setOptions({ breaks: true, gfm: true });

export function MarkdownRenderer({ md }: { md: string }) {
  const t = useTheme();
  const term = useTerminalSize();
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
      const text = (tk as { text: string }).text;
      const color = depth <= 1 ? t.mdHeading : depth === 2 ? t.mdHeading2 : t.mdHeading3;
      out.push(<Text key={key++} color={color} bold>{text}</Text>);
    } else if (tk.type === "list") {
      const items = (tk as { items: { text: string }[] }).items;
      items.forEach((it, i) => out.push(
        <Text key={key++} color={t.fg}><Text color={t.mdListBullet}>  ▸ </Text>{it.text}</Text>
      ));
    } else if (tk.type === "blockquote") {
      const text = (tk as { text: string }).text;
      out.push(<Text key={key++} color={t.mdQuote}><Text color={t.mdQuoteBorder}>│ </Text>{text}</Text>);
    } else if (tk.type === "hr") {
      out.push(<Text key={key++} color={t.mdHr}>{hr(term.cols)}</Text>);
    } else if (tk.type === "paragraph" || tk.type === "text") {
      const text = "text" in tk ? String((tk as { text: unknown }).text) : "";
      if (text) out.push(<SelectableText key={key++} color={t.fg}>{text}</SelectableText>);
    }
  }
  return <>{out}</>;
}
