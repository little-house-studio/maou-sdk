/**
 * Format Ink-equivalent PerfHud lines for Ratatui chrome.
 * Reuses process-stats sampling (CPU/mem/load/verdict).
 */

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
import { isLiteMode, LITE_HISTORY_BASE } from "../config/lite-mode.js";

/** 阶段短标签：ink 是「UI 提交」计数桶名，不是 TUI 后端（Ratatui 下也会有 ui/pnt） */
const PHASE_LABEL: Record<UiPhase, string> = {
  ink: "ui",
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

export type PerfHudPayload = {
  lines: string[];
  /** hot | warm | ok — for Ratatui coloring */
  heat: "hot" | "warm" | "ok";
};

/**
 * Keep process-stats sampler alive for Ratatui chrome.
 * Always subscribe so a later Settings toggle can start the timer;
 * buildPerfHudPayload still no-ops when HUD is disabled.
 */
export function ensurePerfHudSampler(onTick?: () => void): () => void {
  return subscribeProcessStats(() => {
    if (!processStatsHudEnabled()) return;
    onTick?.();
  });
}

export function buildPerfHudPayload(
  msgN: number,
  agentBusy: boolean,
): PerfHudPayload | null {
  if (!processStatsHudEnabled()) return null;
  setAgentBusy(agentBusy);
  const s = getProcessStats();
  const winSec = Math.max(1, Math.round((s.windowMs || processStatsSampleMs()) / 1000));
  const rollSec = Math.max(1, Math.round((s.avg10s.windowMs || processStatsRollSec() * 1000) / 1000));
  const a = s.avg10s;
  const liteTag = isLiteMode() ? ` ·LITE≤${LITE_HISTORY_BASE}` : "";
  const nativeTag = s.native ? " ·rs" : " ·js";

  // inkFps = noteInkFrame（仅 Ink 路径）；Ratatui 下通常为 0，勿显示以免误以为在跑 Ink
  const inkPart =
    s.inkFps > 0 ? `/${formatFps(s.inkFps)}ink` : "";
  const line1 =
    `⚡ ${formatFps(s.fps)}fps` +
    inkPart +
    ` · cpu ${formatCpu(s.cpuPct)}` +
    `(ui${formatCpu(s.uiCpuPct)} ag${formatCpu(s.agentCpuPct)})` +
    ` · ${formatMem(s.rssMb)}/${formatMem(s.heapMb)}` +
    nativeTag +
    liteTag +
    ` ·${winSec}s avg` +
    ` ·rt`; // 标明本 HUD 给 Ratatui 壳用（Node 采样）

  const line2 =
    a.samples > 0
      ? `  ~${rollSec}s avg cpu${formatCpu(a.cpuPct)} fps${formatFps(a.fps)}` +
        (a.inkFps > 0 ? `/${formatFps(a.inkFps)}ink` : "") +
        ` · peak cpu${formatCpu(a.maxCpuPct)} fps${formatFps(a.maxFps)}` +
        (a.maxInkFps > 0 ? ` ink${formatFps(a.maxInkFps)}` : "") +
        (a.maxLoopLagMs > 0 ? ` lag${a.maxLoopLagMs}` : "")
      : `  ~${rollSec}s …采样中`;

  const top = s.uiTop;
  const phaseBody = UI_PHASES.map((p) => {
    const rate = s.uiPhases[p] ?? 0;
    const mark = top === p && rate > 0 ? "*" : "";
    return `${mark}${PHASE_LABEL[p]}${formatPhaseRate(rate)}`;
  }).join(" ");
  const line3 =
    `  ${phaseBody}` + (top ? ` ·↑${PHASE_LABEL[top]}` : " ·—");

  const gridPct = Math.round((s.gridHitRate ?? 0) * 100);
  const scrPct = Math.round((s.scrollShare ?? 0) * 100);
  const gHitNote = scrPct >= 40 ? `gMiss~${100 - gridPct}%*` : `gHit${gridPct}%`;
  const line4 =
    `  lag${s.loopLagMs}ms` +
    ` · load${s.load1.toFixed(2)}/${s.cpuCount}c(${s.loadPerCore.toFixed(2)})` +
    ` · ${gHitNote}` +
    ` · scr${scrPct}%` +
    ` · msg${msgN}`;

  const tag = VERDICT_TAG[s.verdict] ?? s.verdict;
  const line5 = `  [${tag}] ${s.verdictHint}`;

  const cpuForColor = Math.max(s.cpuPct, a.samples >= 2 ? a.cpuPct : 0);
  const heat: PerfHudPayload["heat"] =
    cpuForColor >= 80 || s.rssMb >= 800 || s.loopLagMs >= 80
      ? "hot"
      : cpuForColor >= 40 || s.rssMb >= 400 || s.loadPerCore >= 0.7
        ? "warm"
        : "ok";

  return {
    lines: [line1, line2, line3, line4, line5],
    heat,
  };
}
