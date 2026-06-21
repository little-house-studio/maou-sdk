/** 渐变组件 —— 逐字着色文本 / 横向渐变条 / 渐变填充块 */
import React from "react";
import { Box, Text } from "ink";
import { gradientStops } from "../color.js";
import { currentTheme } from "../theme.js";

/** 逐字符渐变着色 */
export function GradientText({ children, stops, bold }: { children: string; stops?: string[]; bold?: boolean }) {
  const t = currentTheme;
  const chars = [...children];
  const colors = gradientStops(stops ?? t.gradient, chars.length);
  return (
    <Text>
      {chars.map((ch, i) => (
        <Text key={i} color={colors[i]} bold={bold}>{ch}</Text>
      ))}
    </Text>
  );
}

/** 横向渐变填充条 */
export function GradientBar({ width, stops, char = "█" }: { width: number; stops?: string[]; char?: string }) {
  const t = currentTheme;
  const colors = gradientStops(stops ?? t.gradient, width);
  return (
    <Text>
      {colors.map((c, i) => <Text key={i} color={c}>{char}</Text>)}
    </Text>
  );
}

/** 垂直渐变填充块（多行，每行一色） */
export function GradientBlock({ width, height, stops, char = "█" }: { width: number; height: number; stops?: string[]; char?: string }) {
  const t = currentTheme;
  const colors = gradientStops(stops ?? t.gradient, height);
  return (
    <Box flexDirection="column">
      {colors.map((c, i) => <Text key={i} color={c}>{char.repeat(width)}</Text>)}
    </Box>
  );
}

/** 二维对角渐变块（左上→右下混合两组色站） */
export function GradientField({ width, height, stops, char = "█" }: { width: number; height: number; stops?: string[]; char?: string }) {
  const t = currentTheme;
  const base = stops ?? t.gradient;
  const rows: React.ReactNode[] = [];
  for (let y = 0; y < height; y++) {
    const line = gradientStops(base, width).map((c, x) => {
      // 行偏移让色相沿对角推进
      const shift = gradientStops(base, width)[(x + y) % width]!;
      return <Text key={x} color={shift}>{char}</Text>;
    });
    rows.push(<Text key={y}>{line}</Text>);
  }
  return <Box flexDirection="column">{rows}</Box>;
}
