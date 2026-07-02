/**
 * VuMeter —— token 用量 VU 表（磁带录音电平表风格）。
 * 显示最近 N 轮 token 趋势的立体电平条。
 */

import React from "react";
import { Text } from "ink";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";

export function VuMeter({ width = 10 }: { width?: number }) {
  const t = useTheme();
  const rounds = useStore((s) => s.rounds);
  if (rounds.length === 0) return null;

  const recent = rounds.slice(-width);
  const max = Math.max(...recent.map(r => r.total ?? (r.input + r.output)), 1);

  // 电平表：每个位置根据该轮 token 占比点亮
  const bars = recent.map(r => {
    const ratio = (r.total ?? (r.input + r.output)) / max;
    const level = Math.round(ratio * 8); // 0-8 级
    return level;
  });
  // 补齐
  while (bars.length < width) bars.unshift(0);

  return (
    <Text>
      <Text color={t.dim}>VU</Text>
      {bars.map((lvl, i) => {
        const char = lvl >= 7 ? "█" : lvl >= 5 ? "▆" : lvl >= 3 ? "▃" : lvl >= 1 ? "▁" : "·";
        const color = lvl >= 7 ? t.err : lvl >= 5 ? t.warn : lvl >= 1 ? t.accent : t.dim;
        return <Text key={i} color={color}>{char}</Text>;
      })}
    </Text>
  );
}
