/** Scrollable —— 滚轮/方向键可滚动视口（overflow:hidden + 负 marginTop）+ 滚动条 */
import React from "react";
import { Box, Text } from "ink";
import { currentTheme } from "../theme.js";

/**
 * 固定高度视口，内容超出部分裁剪；右侧绘制滚动条滑块。
 * offset 受控（行数），由 useScroll + 滚轮/方向键驱动。
 */
export function ScrollView({
  children, height, offset, contentHeight, width, showBar = true,
}: {
  children: React.ReactNode;
  height: number;
  offset: number;
  contentHeight: number;
  width?: number;
  showBar?: boolean;
}) {
  const t = currentTheme;
  const max = Math.max(0, contentHeight - height);
  const off = Math.max(0, Math.min(max, offset));
  // 滑块尺寸/位置
  const thumb = Math.max(1, Math.round((height / Math.max(contentHeight, 1)) * height));
  const thumbPos = max === 0 ? 0 : Math.round((off / max) * (height - thumb));
  const canUp = off > 0, canDown = off < max;
  return (
    <Box>
      <Box height={height} width={width} overflow="hidden" flexDirection="column" flexShrink={0}>
        <Box flexDirection="column" marginTop={-off} flexShrink={0}>{children}</Box>
      </Box>
      {showBar && (
        <Box flexDirection="column" marginLeft={1} flexShrink={0}>
          {Array.from({ length: height }, (_, i) => {
            const onThumb = i >= thumbPos && i < thumbPos + thumb;
            const glyph = i === 0 && canUp ? "▲" : i === height - 1 && canDown ? "▼" : onThumb ? "█" : "░";
            return <Text key={i} color={onThumb ? t.accent : t.dim}>{glyph}</Text>;
          })}
        </Box>
      )}
    </Box>
  );
}
