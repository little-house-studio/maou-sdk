/**
 * Overlay —— Ink 7 position="absolute" 基础 overlay。
 *
 * Ink 无 z-index，absolute 与下层重叠时背景不填空白格会透出下层文字（#929）。
 * 解法：Layout 在 overlay 开时清空 ChatPage 重叠区域，避免重叠（而非靠背景覆盖）。
 * 此组件本身用 Box border + backgroundColor，干净渲染。
 */

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/theme-context.js";

interface Props {
  title: string;
  top?: number;
  left?: number;
  width?: number;
  children: React.ReactNode;
  footer?: string;
}

export function Overlay({ title, top = 3, left = 2, width = 48, children, footer }: Props) {
  const t = useTheme();
  return (
    <Box
      position="absolute"
      top={top}
      left={left}
      width={width}
      flexDirection="column"
      borderStyle="round"
      borderColor={t.accent}
      backgroundColor={t.panelBg}
      paddingX={1}
    >
      <Text color={t.accent} bold>▸ {title}</Text>
      {children}
      {footer && <Text color={t.dim}>{footer}</Text>}
    </Box>
  );
}
