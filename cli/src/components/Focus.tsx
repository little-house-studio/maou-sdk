/** Focus —— 聚焦高亮框：聚焦时边框颜色沿渐变流动（呼吸/流光效果） */
import React from "react";
import { Box, Text } from "ink";
import { currentTheme } from "../theme.js";
import { gradientStops } from "../color.js";

export function FocusFrame({
  focused, frame, title, icon, children, width, height, flexGrow,
}: {
  focused: boolean;
  frame: number;
  title?: string;
  icon?: string;
  children?: React.ReactNode;
  width?: number | string;
  height?: number | string;
  flexGrow?: number;
}) {
  const t = currentTheme;
  // 聚焦时边框色在 accent↔accent2↔borderSoft 间循环 → 流光感
  const ring = gradientStops([t.accent, t.accent2, t.borderSoft, t.accent], 16);
  const bc = focused ? ring[frame % ring.length]! : t.border;
  return (
    <Box
      flexDirection="column"
      borderStyle={focused ? "double" : "round"}
      borderColor={bc}
      paddingX={1}
      width={width as any}
      height={height as any}
      flexGrow={flexGrow}
    >
      {title !== undefined && (
        <Box marginTop={-1}>
          <Text color={bc} bold>{focused ? "◆ " : icon ? `${icon} ` : ""}{title}</Text>
        </Box>
      )}
      {children}
    </Box>
  );
}
