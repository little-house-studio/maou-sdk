/**
 * 测量单个 scrollback 块高度，上报给虚拟列表 cache。
 * 仅宽高变化 setState（useBoxSize），滚动 marginTop 不触发。
 */

import React, { useEffect, useRef } from "react";
import { Box } from "ink";
import type { DOMElement } from "ink";
import { useBoxSize } from "../hooks/useBoxSize.js";

export function MeasuredBlock({
  id,
  measureKey,
  onHeight,
  width,
  children,
}: {
  id: string;
  /** 内容指纹：展开/流式变高时变 */
  measureKey: string | number;
  onHeight: (id: string, height: number) => void;
  width: number;
  children: React.ReactNode;
}) {
  const ref = useRef<DOMElement | null>(null);
  const size = useBoxSize(ref, [id, measureKey, width]);

  useEffect(() => {
    if (size.height > 0) onHeight(id, size.height);
  }, [id, size.height, onHeight]);

  return (
    <Box ref={ref} flexDirection="column" width={width} flexShrink={0}>
      {children}
    </Box>
  );
}
