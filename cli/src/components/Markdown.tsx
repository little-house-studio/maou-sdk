/** Markdown —— 把 Markdown + 轻量 HTML 渲染成终端富文本（卡片内容渲染） */
import React from "react";
import { Box, Text } from "ink";
import { currentTheme } from "../theme.js";

interface Seg { text: string; bold?: boolean; italic?: boolean; code?: boolean; strike?: boolean; link?: string }

/** 行内解析：**粗** *斜* `码` ~~删~~ [文](链) + <b><i><code><a><br><s> */
function parseInline(src: string): Seg[] {
  const s = src
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(strong|b)>/gi, "**")
    .replace(/<\/?(em|i)>/gi, "*")
    .replace(/<\/?(s|del|strike)>/gi, "~~")
    .replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<[^>]+>/g, ""); // 丢弃其余标签
  const segs: Seg[] = [];
  const push = (text: string, st: Partial<Seg> = {}) => { if (text) segs.push({ text, ...st }); };
  const re = /(\*\*|__)([\s\S]+?)\1|(\*|_)([\s\S]+?)\3|~~([\s\S]+?)~~|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) push(s.slice(last, m.index));
    if (m[1]) push(m[2]!, { bold: true });
    else if (m[3]) push(m[4]!, { italic: true });
    else if (m[5]) push(m[5], { strike: true });
    else if (m[6]) push(m[6], { code: true });
    else if (m[7]) push(m[7], { link: m[8] });
    last = re.lastIndex;
  }
  if (last < s.length) push(s.slice(last));
  return segs;
}

function Inline({ segs }: { segs: Seg[] }) {
  const t = currentTheme;
  return (
    <Text>
      {segs.map((s, i) => (
        <Text
          key={i}
          bold={s.bold}
          italic={s.italic}
          strikethrough={s.strike}
          underline={!!s.link}
          color={s.code ? t.role.tool : s.link ? t.role.user : t.fg}
          backgroundColor={s.code ? t.overlayBg : undefined}
        >
          {s.code ? ` ${s.text} ` : s.text}{s.link ? ` →${s.link}` : ""}
        </Text>
      ))}
    </Text>
  );
}

/** 块级解析：标题/代码块/引用/列表/分隔线/段落 */
export function Markdown({ source, width }: { source: string; width?: number }) {
  const t = currentTheme;
  const lines = source.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0, key = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // ``` 代码块
    if (/^\s*```/.test(line)) {
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) { buf.push(lines[i]!); i++; }
      i++;
      blocks.push(
        <Box key={key++} flexDirection="column" borderStyle="single" borderColor={t.border} paddingX={1}>
          {lang && <Text color={t.dim}>‹{lang}›</Text>}
          {buf.map((b, j) => <Text key={j} color={t.role.toolResult}>{b || " "}</Text>)}
        </Box>,
      );
      continue;
    }

    // # 标题
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      const lvl = h[1]!.length;
      const color = lvl === 1 ? t.accent : lvl === 2 ? t.role.assistant : t.role.user;
      blocks.push(
        <Box key={key++} marginTop={blocks.length ? 1 : 0}>
          <Text bold color={color} underline={lvl === 1}>{"▎"} {h[2]}</Text>
        </Box>,
      );
      i++; continue;
    }

    // --- 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<Text key={key++} color={t.border}>{"─".repeat(Math.max(8, (width ?? 32) - 2))}</Text>);
      i++; continue;
    }

    // > 引用
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) { buf.push(lines[i]!.replace(/^>\s?/, "")); i++; }
      blocks.push(
        <Box key={key++} borderStyle="single" borderColor={t.borderSoft} borderTop={false} borderRight={false} borderBottom={false} paddingLeft={1}>
          <Box flexDirection="column">
            {buf.map((b, j) => <Box key={j}><Text color={t.dim} italic><Inline segs={parseInline(b)} /></Text></Box>)}
          </Box>
        </Box>,
      );
      continue;
    }

    // 列表（-, *, +, 1.）
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/);
    if (li) {
      const items: { indent: number; bullet: string; text: string }[] = [];
      while (i < lines.length) {
        const mm = lines[i]!.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/);
        if (!mm) break;
        items.push({ indent: mm[1]!.length, bullet: /\d/.test(mm[2]!) ? mm[2]! : "•", text: mm[3]! });
        i++;
      }
      blocks.push(
        <Box key={key++} flexDirection="column">
          {items.map((it, j) => (
            <Box key={j} paddingLeft={1 + it.indent}>
              <Text color={t.accent}>{it.bullet} </Text>
              <Inline segs={parseInline(it.text)} />
            </Box>
          ))}
        </Box>,
      );
      continue;
    }

    // 空行
    if (line.trim() === "") { i++; continue; }

    // 段落（聚合到下一个空行/块标记）
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^\s*(#{1,3}\s|```|>|(-{3,}|\*{3,}|_{3,})\s*$|(\s*)([-*+]|\d+[.)])\s)/.test(lines[i]!)
    ) { buf.push(lines[i]!); i++; }
    blocks.push(<Box key={key++}><Inline segs={parseInline(buf.join(" "))} /></Box>);
  }

  return <Box flexDirection="column" width={width}>{blocks}</Box>;
}
