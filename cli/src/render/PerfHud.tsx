/**
 * PerfHud —— 右上角性能诊断条
 *
 * 行1：2s 窗均值 fps/cpu/mem + 窗标注
 * 行2：~10s 均值 · 窗内峰值（区分尖刺 vs 持续忙）
 * 行3：阶段 rates + ↑top
 * 行4：loopLag · load · gridHit · scroll% · msg
 * 行5：判定短句
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
  processStatsRollSec,
  processStatsSampleMs,
  setAgentBusy,
  subscribeProcessStats,
  UI_PHASES,
  type UiPhase,
  type PerfVerdict,
} from "../hooks/process-stats.js";
import { isNativeRasterLoaded } from "./native-raster.js";
import { isLiteMode, LITE_HISTORY_BASE } from "../config/lite-mode.js";

function useProcessStats() {
  return useSyncExternalStore(subscribeProcessStats, getProcessStats, getProcessStats);
}

const PHASE_LABEL: Record<UiPhase, string> = {
  ink: "ink",
  paint: "pnt",
  grid: "grd",
  mouse: "mse",
  stream: "str",
  scroll: "scr",
};

const VERDICT_TAG: Record<PerfVerdict, string> = {
  idle: "IDLE",
  "cli-ink": "CLI·INK",
  "cli-paint": "CLI·PNT",
  "cli-scroll": "CLI·SCR",
  "cli-stream": "CLI·STR",
  "cli-busy": "CLI",
  agent: "AGENT",
  machine: "HOST",
  mixed: "MIX",
};

export function PerfHud() {
  const t = useTheme();
  const streaming = useStore((s) => s.streaming);
  const aborting = useStore((s) => s.aborting);
  const mode = useStore((s) => s.eventBlock.mode);
  const msgN = useStore((s) => s.messages.length);

  const agentBusy =
    (streaming && !aborting) ||
    mode === "tool_pending" ||
    mode === "thinking" ||
    mode === "generating" ||
    mode === "retrying";

  useEffect(() => {
    setAgentBusy(agentBusy);
  }, [agentBusy]);

  useEffect(() => {
    void isNativeRasterLoaded();
  }, []);

  const s = useProcessStats();

  if (!processStatsHudEnabled()) return null;

  const winSec = Math.max(1, Math.round((s.windowMs || processStatsSampleMs()) / 1000));
  const rollSec = Math.max(1, Math.round((s.avg10s.windowMs || processStatsRollSec() * 1000) / 1000));
  const a = s.avg10s;

  // 颜色按 2s 窗 + 10s 均值综合，避免单窗尖刺一直红
  const cpuForColor = Math.max(s.cpuPct, a.samples >= 2 ? a.cpuPct : 0);
  const hot = cpuForColor >= 80 || s.rssMb >= 800 || s.loopLagMs >= 80;
  const warm = cpuForColor >= 40 || s.rssMb >= 400 || s.loadPerCore >= 0.7;
  const color = hot ? t.err : warm ? t.warn : t.accent2 ?? t.accent;
  const dim = t.dim;
  const topColor = t.warn ?? t.accent;
  const bg = t.panelBg ?? t.bg;

  const nativeTag = s.native || isNativeRasterLoaded() ? " ·rs" : " ·js";
  const liteTag = isLiteMode() ? ` ·LITE≤${LITE_HISTORY_BASE}` : "";
  // 行1：本窗（~2s）均值 —— 明确标注 avg
  const line1 =
    `⚡ ${formatFps(s.fps)}fps` +
    (s.inkFps > 0 ? `/${formatFps(s.inkFps)}ink` : "") +
    ` · cpu ${formatCpu(s.cpuPct)}` +
    `(ui${formatCpu(s.uiCpuPct)} ag${formatCpu(s.agentCpuPct)})` +
    ` · ${formatMem(s.rssMb)}/${formatMem(s.heapMb)}` +
    nativeTag +
    liteTag +
    ` ·${winSec}s avg`;

  // 行2：~10s 滚动均值 + 峰值（尖刺 vs 持续）
  const line2 =
    a.samples > 0
      ? `  ~${rollSec}s avg cpu${formatCpu(a.cpuPct)} fps${formatFps(a.fps)}/${formatFps(a.inkFps)}ink` +
        ` · peak cpu${formatCpu(a.maxCpuPct)} fps${formatFps(a.maxFps)} ink${formatFps(a.maxInkFps)}` +
        (a.maxLoopLagMs > 0 ? ` lag${a.maxLoopLagMs}` : "")
      : `  ~${rollSec}s …采样中`;

  const top = s.uiTop;
  const phaseParts = UI_PHASES.map((p) => {
    const rate = s.uiPhases[p] ?? 0;
    return {
      phase: p,
      body: `${PHASE_LABEL[p]}${formatPhaseRate(rate)}`,
      rate,
      isTop: top === p && rate > 0,
    };
  });

  const gridPct = Math.round((s.gridHitRate ?? 0) * 100);
  const scrPct = Math.round((s.scrollShare ?? 0) * 100);
  const gHitNote = scrPct >= 40 ? `gMiss~${100 - gridPct}%*` : `gHit${gridPct}%`;
  const line4 =
    `lag${s.loopLagMs}ms` +
    ` · load${s.load1.toFixed(2)}/${s.cpuCount}c(${s.loadPerCore.toFixed(2)})` +
    ` · ${gHitNote}` +
    ` · scr${scrPct}%` +
    ` · msg${msgN}`;

  const tag = VERDICT_TAG[s.verdict] ?? s.verdict;
  const line5 = `[${tag}] ${s.verdictHint}`;

  const verdictColor =
    s.verdict === "machine" || s.verdict === "mixed"
      ? t.err
      : s.verdict === "idle"
        ? dim
        : s.verdict.startsWith("cli")
          ? topColor
          : t.accent;

  return (
    <Box
      flexShrink={0}
      width="100%"
      flexDirection="column"
      alignItems="flex-end"
      paddingX={1}
    >
      <Text color={color} backgroundColor={bg} bold>
        {line1}
      </Text>
      <Text color={dim} backgroundColor={bg}>
        {line2}
      </Text>
      <Box flexDirection="row" flexShrink={0}>
        <Text color={dim} backgroundColor={bg}>
          {"  "}
        </Text>
        {phaseParts.map((p, i) => (
          <Text
            key={p.phase}
            color={p.isTop ? topColor : dim}
            backgroundColor={bg}
            bold={p.isTop}
          >
            {i > 0 ? " " : ""}
            {p.body}
          </Text>
        ))}
        {top ? (
          <Text color={topColor} backgroundColor={bg} bold>
            {` ·↑${PHASE_LABEL[top]}`}
          </Text>
        ) : (
          <Text color={dim} backgroundColor={bg}>
            {" ·—"}
          </Text>
        )}
      </Box>
      <Text color={dim} backgroundColor={bg}>
        {`  ${line4}`}
      </Text>
      <Text color={verdictColor} backgroundColor={bg} bold>
        {`  ${line5}`}
      </Text>
    </Box>
  );
}
