/**
 * SelectableText —— 可选中文本的 Text 包装。
 *
 * 用 <Box ref> 包裹 <Text>（Text 不 forward ref，Box 才能拿 yogaNode）。
 * 渲染后用 getElementRect 拿屏幕矩形，把文本按 code point + string-width
 * 登记到 screenBuffer，供鼠标选区提取。
 *
 * 选区反色：接收 selection prop（{start,end}|null），若该 Text 的矩形与选区相交，
 * 把文本拆成"选区外/选区内"多段，选区内段加 inverse 样式。
 *
 * soft-wrap：registerText 内部按 availWidth 算视觉行登记。
 */

import React, { useEffect, useRef, useMemo } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import { getElementRect } from "../input/click-target.js";
import { registerText, nextTextIdGen } from "../input/screen-buffer.js";
import stringWidth from "string-width";

interface Props {
  children: string;
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
  backgroundColor?: string;
  wrap?: "wrap" | "truncate";
  /** 选区 {start,end} 1-based 屏幕坐标，用于反色 */
  selection?: { start: { row: number; col: number }; end: { row: number; col: number } } | null;
}

export function SelectableText({ children, color, bold, dimColor, backgroundColor, wrap, selection }: Props) {
  const ref = useRef<DOMElement | null>(null);
  const textId = useMemo(() => nextTextIdGen(), []);

  useEffect(() => {
    if (!ref.current) return;
    const rect = getElementRect(ref.current);
    if (!rect || rect.width <= 0) return;
    // availWidth = rect.width（Box 的计算宽度），登记到 screenBuffer
    registerText(children, rect.left, rect.top, rect.width, textId);
  });

  // 选区反色：若 selection 与本 Text 矩形相交，拆段渲染
  // 简化：暂不拆段字符级反色（性能 + 复杂度），仅整段不反色。
  // 选区视觉反馈由外层覆盖层提供（ScrollHistory 画反色 Box 覆盖选区）
  void selection;

  return (
    <Box ref={ref}>
      <Text color={color} bold={bold} dimColor={dimColor} backgroundColor={backgroundColor} wrap={wrap}>
        {children}
      </Text>
    </Box>
  );
}

// re-export stringWidth 供外部复用（避免重复依赖）
export { stringWidth };
