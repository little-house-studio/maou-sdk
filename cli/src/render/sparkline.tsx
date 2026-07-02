/**
 * Sparkline —— ▁▂▃▄▅▆▇█ 数据趋势。
 */

import React from "react";
import { Text } from "ink";
import { SPARKLINE_CHARS } from "../theme/tokens.js";
import { useTheme } from "../theme/theme-context.js";

export function Sparkline({ values, width = 12 }: { values: number[]; width?: number }) {
  const t = useTheme();
  if (values.length === 0) return <Text color={t.dim}>{"·".repeat(width)}</Text>;
  const recent = values.slice(-width);
  const max = Math.max(...recent, 1);
  const chars = recent.map(v => {
    const idx = Math.min(SPARKLINE_CHARS.length - 1, Math.floor((v / max) * SPARKLINE_CHARS.length));
    return SPARKLINE_CHARS[idx]!;
  });
  // 补齐宽度
  while (chars.length < width) chars.unshift("·");
  return <Text color={t.accent2}>{chars.join("")}</Text>;
}
