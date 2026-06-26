/** 图形组件 —— Gauge / Sparkline / Wireframe3D / AsciiArt / Spinner */
import React from "react";
import { Box, Text } from "ink";
import { gaugeBar, sparkline, renderWireframe, CUBE, CRYSTAL, type WireModel } from "../canvas/primitives.js";
import { currentTheme } from "../theme.js";

// ── Gauge：血条/魔条（VFD 荧光分段风格 · 密集）─────────────────────────────
export function Gauge({ label, value, max, width = 16, color }: { label: string; value: number; max: number; width?: number; color?: string }) {
  const ratio = max > 0 ? value / max : 0;
  const t = currentTheme;
  const c = color ?? (ratio > 0.85 ? t.status.err : ratio > 0.6 ? t.status.warn : t.gauge[1]!);
  const pct = Math.round(ratio * 100);
  return (
    <Box>
      {/* 标签反色填色 —— VFD 七段数码风格 */}
      <Text backgroundColor={c} color={t.bg} bold> {label.padEnd(4)} </Text>
      <Text color={c}>{gaugeBar(ratio, width)}</Text>
      <Text color={t.dim}> {pct}%</Text>
    </Box>
  );
}

// ── Sparkline：彩色函数曲线 ──────────────────────────────────────────────────
export function Spark({ values, width = 20, height = 8, label }: { values: number[]; width?: number; height?: number; label?: string }) {
  const t = currentTheme;
  const lines = sparkline(values.length ? values : [0], width, height);
  return (
    <Box flexDirection="column">
      {label && <Text color={t.dim}>{label}</Text>}
      {lines.map((ln, i) => (
        <Text key={i} color={t.spark[Math.min(t.spark.length - 1, Math.floor((1 - i / lines.length) * t.spark.length))]!}>{ln}</Text>
      ))}
    </Box>
  );
}

// ── Wireframe3D：旋转 3D 线框 ────────────────────────────────────────────────
export function Wireframe({ angle, model = "crystal", width = 12, height = 6 }: { angle: number; model?: "cube" | "crystal"; width?: number; height?: number }) {
  const t = currentTheme;
  const m: WireModel = model === "cube" ? CUBE : CRYSTAL;
  const lines = renderWireframe(m, width, height, angle * 0.7, angle, angle * 0.3, 1);
  return (
    <Box flexDirection="column">
      {lines.map((ln, i) => (
        <Text key={i} color={t.accent}>{ln}</Text>
      ))}
    </Box>
  );
}

// ── AsciiArt：渲染字符画（可带逐行/逐字颜色）────────────────────────────────
export function AsciiArt({ lines, colors, color }: { lines: string[]; colors?: string[][]; color?: string }) {
  const t = currentTheme;
  if (colors) {
    return (
      <Box flexDirection="column">
        {lines.map((ln, r) => (
          <Text key={r}>
            {Array.from(ln).map((ch, c) => (
              <Text key={c} color={colors[r]?.[c] ?? t.fg}>{ch}</Text>
            ))}
          </Text>
        ))}
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      {lines.map((ln, i) => <Text key={i} color={color ?? t.accent}>{ln}</Text>)}
    </Box>
  );
}

// ── Spinner：动画 sprite ─────────────────────────────────────────────────────
const SPIN_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PULSE_FRAMES = ["✦", "✧", "✶", "✷", "✸", "✷", "✶", "✧"];
export function Spinner({ frame, kind = "spin", color }: { frame: number; kind?: "spin" | "pulse"; color?: string }) {
  const t = currentTheme;
  const frames = kind === "pulse" ? PULSE_FRAMES : SPIN_FRAMES;
  return <Text color={color ?? t.accent}>{frames[frame % frames.length]}</Text>;
}
