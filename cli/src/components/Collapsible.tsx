/** Collapsible —— 折叠/展开动画容器（宽或高方向，overflow 裁剪 + useTween 缓动） */
import React from "react";
import { Box } from "ink";
import { useTween } from "../hooks/useTween.js";

/**
 * open 切换时，尺寸在 0..size 间平滑动画；裁剪内容形成"滑入/滑出"。
 * axis="x" 折叠宽度（侧栏），axis="y" 折叠高度（面板）。
 */
export function Collapsible({
  open, size, axis = "x", children,
}: {
  open: boolean;
  size: number;
  axis?: "x" | "y";
  children: React.ReactNode;
}) {
  const v = Math.round(useTween(open ? size : 0, 0.3));
  if (v <= 0) return null;
  return (
    <Box
      width={axis === "x" ? v : undefined}
      height={axis === "y" ? v : undefined}
      overflow="hidden"
      flexShrink={0}
      flexDirection="column"
    >
      {children}
    </Box>
  );
}
