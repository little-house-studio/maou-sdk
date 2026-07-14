/**
 * MdPaper —— AI 结构化 Markdown 区域标记。
 *
 * 截图问题（旧实现）：
 * - 固定 width + backgroundColor → 表格/短标题只占左侧，右侧大片空底
 * - Text wrap 把盒子撑满终端宽 → 看起来像整行涂色条，不是「一块文档」
 *
 * 现设计（Tau Ceti / Braun）：
 * - 仅左侧一条弱边框（borderLeft），贯穿整块高度，对齐用户气泡的 │ 语言
 * - **不**整块铺 backgroundColor，消灭右侧空填色
 * - 上下各空一行
 * - 内容列有最大宽度（折行/表格预算），不强制等宽于终端
 */

import React from "react";
import { Box } from "ink";
import { useTheme } from "../../theme/theme-context.js";

/** 左边框约占 1 列视觉 + 内边距 */
const EDGE = 2;

/**
 * 纸面几何：内容最大宽（折行/表格预算）。
 */
export function mdPaperLayout(availableWidth: number): {
  marginLeft: number;
  cardW: number;
  contentW: number;
} {
  const avail = Math.max(16, availableWidth);
  const contentW = Math.max(16, avail - EDGE - 1);
  return { marginLeft: 0, cardW: contentW + EDGE, contentW };
}

/** @deprecated */
export function mdPaperContentWidth(totalWidth: number, _indent = 0): number {
  return mdPaperLayout(totalWidth).contentW;
}

/**
 * MD 区域：仅左缘弱线 + 限宽内容，无整块背景。
 */
export function MdPaper({
  children,
  width,
}: {
  children: React.ReactNode;
  /** 父级可用宽度 → 内容折行上限 */
  width: number;
  /** @deprecated */
  indent?: number;
}) {
  const t = useTheme();
  const { contentW } = mdPaperLayout(width);

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      marginBottom={1}
      paddingLeft={1}
      width={contentW}
      flexShrink={0}
      alignSelf="flex-start"
      overflow="hidden"
      borderStyle="single"
      borderTop={false}
      borderBottom={false}
      borderRight={false}
      borderLeft
      borderLeftColor={t.dim}
    >
      {children}
    </Box>
  );
}
