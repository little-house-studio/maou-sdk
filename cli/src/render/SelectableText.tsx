/**
 * SelectableText —— 可选中文本的 Text 包装（方案2：文字蓝底）。
 *
 * 用 <Box ref> 包裹 <Text>（Text 不 forward ref，Box 才能拿 yogaNode）。
 * 渲染后用 getAbsRect 拿屏幕矩形（累加 getComputedLeft/Top + 1，1-based），
 * 把文本按 code point + string-width 登记到 screenBuffer。
 *
 * 选区蓝底：订阅 store.selection，选区内字符渲染为蓝底白字（按视觉行拆段）。
 * 空格/边框不在 SelectableText，不蓝底但能被选区提取（extractSelection 未登记当空格）。
 *
 * soft-wrap：按 availWidth 算视觉行，每视觉行登记到对应 row + 拆段蓝底。
 */

import React, { useEffect, useRef, useMemo } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import { registerText, nextTextIdGen, inSelection } from "../input/screen-buffer.js";
import { useStore } from "../state/store.js";
import stringWidth from "string-width";

/** 累加父链 getComputedLeft/Top 得绝对坐标（0-based），+1 转 1-based */
function getAbsRect(node: DOMElement | null): { left: number; top: number; width: number; height: number } | null {
  if (!node) return null;
  let left = 0, top = 0, width = 0, height = 0, first = true;
  let cur: DOMElement | undefined = node;
  while (cur) {
    if (!cur.yogaNode) break;
    if (first) {
      width = cur.yogaNode.getComputedWidth();
      height = cur.yogaNode.getComputedHeight();
      first = false;
    }
    left += cur.yogaNode.getComputedLeft();
    top += cur.yogaNode.getComputedTop();
    cur = cur.parentNode ?? undefined;
  }
  return { left: left + 1, top: top + 1, width, height };
}

function charWidth(ch: string): number {
  return stringWidth(ch) || 1;
}

/** 按可用宽度把文本拆成视觉行，每视觉行 [[char, colOffset], ...] */
function wrapToVisualLines(text: string, availWidth: number): [string, number][][] {
  const chars = [...text];
  const lines: [string, number][][] = [];
  let buf: [string, number][] = [];
  let used = 0;
  for (const ch of chars) {
    if (ch === "\n") { lines.push(buf); buf = []; used = 0; continue; }
    const w = charWidth(ch);
    if (used + w > availWidth && used > 0) { lines.push(buf); buf = []; used = 0; }
    buf.push([ch, used]);
    used += w;
  }
  if (buf.length) lines.push(buf);
  return lines;
}

interface Props {
  children: string;
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
  backgroundColor?: string;
  wrap?: "wrap" | "truncate";
}

export function SelectableText({ children, color, bold, dimColor, backgroundColor, wrap }: Props) {
  const ref = useRef<DOMElement | null>(null);
  const textId = useMemo(() => nextTextIdGen(), []);
  const selection = useStore((s) => s.selection);

  useEffect(() => {
    if (!ref.current) return;
    const rect = getAbsRect(ref.current);
    if (!rect || rect.width <= 0) return;
    registerText(children, rect.left, rect.top, rect.width, textId);
  });

  // 按视觉行拆段渲染：选区内字符蓝底白字
  const text = String(children);
  const rect = ref.current ? getAbsRect(ref.current) : null;
  if (!rect) {
    return (
      <Box ref={ref}>
        <Text color={color} bold={bold} dimColor={dimColor} backgroundColor={backgroundColor} wrap={wrap}>
          {children}
        </Text>
      </Box>
    );
  }
  const visLines = wrapToVisualLines(text, rect.width);
  // 单视觉行：row 包 Text 段（可和其他 SelectableText 并排）
  // 多视觉行：column 包每行 Box
  if (visLines.length <= 1) {
    const line = visLines[0] ?? [];
    const marks: { style: "sel" | null; ch: string }[] = [];
    for (const [ch, colOffset] of line) {
      const w = charWidth(ch);
      let style: "sel" | null = null;
      for (let k = 0; k < w; k++) {
        const absCol = rect.left + colOffset + k;
        if (inSelection(rect.top, absCol, selection)) { style = "sel"; break; }
      }
      marks.push({ style, ch });
    }
    const segs: { style: "sel" | null; text: string }[] = [];
    let curStyle: "sel" | null = marks[0]?.style ?? null;
    let curText = marks[0] ? marks[0].ch : "";
    for (let i = 1; i < marks.length; i++) {
      if (marks[i].style === curStyle) curText += marks[i].ch;
      else { segs.push({ style: curStyle, text: curText }); curStyle = marks[i].style; curText = marks[i].ch; }
    }
    if (curText) segs.push({ style: curStyle, text: curText });
    return (
      <Box ref={ref}>
        {segs.length === 0
          ? <Text color={color} bold={bold} dimColor={dimColor} backgroundColor={backgroundColor} wrap={wrap}>{""}</Text>
          : segs.map((s, i) =>
              s.style === "sel"
                ? <Text key={i} backgroundColor="blue" color="white">{s.text}</Text>
                : <Text key={i} color={color} bold={bold} dimColor={dimColor} backgroundColor={backgroundColor} wrap={wrap}>{s.text}</Text>
            )}
      </Box>
    );
  }
  // 多视觉行（soft-wrap）：column 包每行
  return (
    <Box ref={ref} flexDirection="column">
      {visLines.map((line, li) => {
        const marks: { style: "sel" | null; ch: string }[] = [];
        for (const [ch, colOffset] of line) {
          const w = charWidth(ch);
          let style: "sel" | null = null;
          for (let k = 0; k < w; k++) {
            const absRow = rect.top + li;
            const absCol = rect.left + colOffset + k;
            if (inSelection(absRow, absCol, selection)) { style = "sel"; break; }
          }
          marks.push({ style, ch });
        }
        const segs: { style: "sel" | null; text: string }[] = [];
        let curStyle: "sel" | null = marks[0]?.style ?? null;
        let curText = marks[0] ? marks[0].ch : "";
        for (let i = 1; i < marks.length; i++) {
          if (marks[i].style === curStyle) curText += marks[i].ch;
          else { segs.push({ style: curStyle, text: curText }); curStyle = marks[i].style; curText = marks[i].ch; }
        }
        if (curText) segs.push({ style: curStyle, text: curText });
        return (
          <Box key={li}>
            {segs.map((s, i) =>
              s.style === "sel"
                ? <Text key={i} backgroundColor="blue" color="white">{s.text}</Text>
                : <Text key={i} color={color} bold={bold} dimColor={dimColor} backgroundColor={backgroundColor} wrap={wrap}>{s.text}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
