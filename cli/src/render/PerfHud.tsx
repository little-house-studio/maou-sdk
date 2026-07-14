/**
 * PerfHud —— 对话区右上角本进程性能条。
 *
 * 行 1：fps / cpu / ui·ag / rss·heap
 * 行 2：UI 阶段 events/sec（ink·paint·grid·mouse·stream·scroll）+ 最忙阶段
 *
 * 关闭：MAOU_PERF_HUD=0
 */

import React, { useEffect, useSyncExternalStore } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import {
  formatCpu,
  formatFps,
  formatMem,
  formatPhaseRate,
  getProcessStats,
  processStatsHudEnabled,
  setAgentBusy,
  subscribeProcessStats,
  UI_PHASES,
  type UiPhase,
} from "../hooks/process-stats.js";
import { isNativeRasterLoaded } from "./native-raster.js";

function useProcessStats() {
  return useSyncExternalStore(subscribeProcessStats, getProcessStats, getProcessStats);
}

/** 阶段短标签（HUD 一行能放下） */
const PHASE_LABEL: Record<UiPhase, string> = {
  ink: "ink",
  paint: "pnt",
  grid: "grd",
  mouse: "mse",
  stream: "str",
  scroll: "scr",
};

export function PerfHud() {
  const t = useTheme();
  const streaming = useStore((s) => s.streaming);
  const aborting = useStore((s) => s.aborting);
  const mode = useStore((s) => s.eventBlock.mode);

  // 后端活跃：流式 / 工具中 / 重试
  const agentBusy =
    (streaming && !aborting) ||
    mode === "tool_pending" ||
    mode === "thinking" ||
    mode === "generating" ||
    mode === "retrying";

  useEffect(() => {
    setAgentBusy(agentBusy);
  }, [agentBusy]);

  const s = useProcessStats();

  if (!processStatsHudEnabled()) return null;

  const hot = s.cpuPct >= 80 || s.rssMb >= 800;
  const warm = s.cpuPct >= 40 || s.rssMb >= 400;
  // 常态用 accent 保证可见（dim 贴黑底几乎看不见）
  const color = hot ? t.err : warm ? t.warn : t.accent2 ?? t.accent;
  const dim = t.dim;
  const topColor = t.warn ?? t.accent;

  // fps=实际写出；ink= React 提交（可高于 fps）
  // ag=0 且空闲正常；ui 高说明前端忙
  const nativeTag = isNativeRasterLoaded() ? " ·rs" : "";
  const line1 =
    `⚡ ${formatFps(s.fps)}fps` +
    (s.inkFps > 0 && Math.abs(s.inkFps - s.fps) >= 0.5
      ? `/${formatFps(s.inkFps)}ink`
      : "") +
    ` · cpu ${formatCpu(s.cpuPct)}` +
    ` · ui ${formatCpu(s.uiCpuPct)}` +
    ` · ag ${formatCpu(s.agentCpuPct)}` +
    ` · ${formatMem(s.rssMb)}` +
    `/${formatMem(s.heapMb)}` +
    nativeTag;

  const top = s.uiTop;
  const phaseParts = UI_PHASES.map((p) => {
    const rate = s.uiPhases[p] ?? 0;
    const label = PHASE_LABEL[p];
    const body = `${label}${formatPhaseRate(rate)}`;
    return { phase: p, body, rate, isTop: top === p && rate > 0 };
  });

  return (
    <Box
      flexShrink={0}
      width="100%"
      flexDirection="column"
      alignItems="flex-end"
      paddingX={1}
    >
      <Text color={color} backgroundColor={t.panelBg ?? t.bg} bold>
        {line1}
      </Text>
      <Box flexDirection="row" flexShrink={0}>
        <Text color={dim} backgroundColor={t.panelBg ?? t.bg}>
          {"  "}
        </Text>
        {phaseParts.map((p, i) => (
          <Text
            key={p.phase}
            color={p.isTop ? topColor : dim}
            backgroundColor={t.panelBg ?? t.bg}
            bold={p.isTop}
          >
            {i > 0 ? " " : ""}
            {p.body}
          </Text>
        ))}
        {top ? (
          <Text color={topColor} backgroundColor={t.panelBg ?? t.bg} bold>
            {` ·↑${PHASE_LABEL[top]}`}
          </Text>
        ) : (
          <Text color={dim} backgroundColor={t.panelBg ?? t.bg}>
            {" ·—"}
          </Text>
        )}
      </Box>
    </Box>
  );
}
