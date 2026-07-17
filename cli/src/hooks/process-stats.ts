/**
 * 本进程 CPU / 内存 / 事件循环采样（TUI 右上角 PerfHud 用）。
 *
 * 帮助区分：
 *   - CLI 自身（ink/paint/grid 高、loopLag 低、load 不高）
 *   - 整机争用（load 高、loopLag 高、本进程 cpu 未必顶满）
 *   - agent 后端（ag 高）
 *
 * 采样：默认 2s 窗瞬时均值；另维护 ~10s 滚动均值与窗内峰值。
 * MAOU_PERF_HUD=0 可关闭。
 */

import os from "node:os";
import { resolvePerfHudDefault } from "../config/cli-ui-prefs.js";

/** HUD 上展示的 UI 阶段（events/sec） */
export const UI_PHASES = [
  "ink",
  "paint",
  "grid",
  "mouse",
  "stream",
  "scroll",
] as const;

export type UiPhase = (typeof UI_PHASES)[number];

export type UiPhaseRates = Record<UiPhase, number>;

/** 诊断标签：一眼看瓶颈在哪 */
export type PerfVerdict =
  | "idle"
  | "cli-ink"
  | "cli-paint"
  | "cli-scroll"
  | "cli-stream"
  | "cli-busy"
  | "agent"
  | "machine"
  | "mixed";

/** 单个采样窗（默认 2s）的快照 */
export type ProcessStatsSnap = {
  /** 本窗 CPU 均值 %（单核口径） */
  cpuPct: number;
  uiCpuPct: number;
  agentCpuPct: number;
  rssMb: number;
  heapMb: number;
  extMb: number;
  /** 本窗实际墙钟 ms（约 SAMPLE_MS） */
  windowMs: number;
  agentShare: number;
  /** 本窗 paint 帧率（含光标闪烁脏行） */
  fps: number;
  /** 本窗 Ink onRender 次数/秒 */
  inkFps: number;
  uiPhases: UiPhaseRates;
  uiTop: UiPhase | null;
  /**
   * 事件循环滞后 ms：timer 实际间隔 − 目标间隔。
   * 高（>30～50）→ 主线程被占满或整机卡；低 → 调度正常。
   */
  loopLagMs: number;
  /** 1 分钟 load average（macOS/Linux） */
  load1: number;
  cpuCount: number;
  loadPerCore: number;
  gridHitRate: number;
  scrollShare: number;
  native: boolean;
  verdict: PerfVerdict;
  verdictHint: string;
  ts: number;
  /**
   * ~10s 滚动：各 2s 窗 cpu/fps/ink 的均值与峰值。
   * 用于区分「一直 90%」vs「尖刺一下」。
   */
  avg10s: {
    windowMs: number;
    samples: number;
    cpuPct: number;
    uiCpuPct: number;
    fps: number;
    inkFps: number;
    maxCpuPct: number;
    maxFps: number;
    maxInkFps: number;
    maxLoopLagMs: number;
  };
};

const SAMPLE_MS = 2000;
/** 滚动统计保留的采样点数（5×2s ≈ 10s） */
const ROLL_SAMPLES = 5;

let lastCpu = process.cpuUsage();
let lastWall = Date.now();
let agentActiveMs = 0;
let sampleWallStart = Date.now();
let agentFlag = false;
let scrollActiveMs = 0;
let scrollFlag = false;
let scrollSampleStart = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
let enabled = true;

let paintFrameCount = 0;
let inkFrameCount = 0;
let gridMissCount = 0;
let gridHitCount = 0;

/** 期望下次 tick 的墙钟时间（测 event loop lag） */
let expectedTickAt = 0;

const phaseCounts: Record<UiPhase, number> = {
  ink: 0,
  paint: 0,
  grid: 0,
  mouse: 0,
  stream: 0,
  scroll: 0,
};

type RollPoint = {
  cpuPct: number;
  uiCpuPct: number;
  fps: number;
  inkFps: number;
  loopLagMs: number;
  dt: number;
};

const rollBuf: RollPoint[] = [];

function emptyPhases(): UiPhaseRates {
  return { ink: 0, paint: 0, grid: 0, mouse: 0, stream: 0, scroll: 0 };
}

function emptyAvg10(): ProcessStatsSnap["avg10s"] {
  return {
    windowMs: SAMPLE_MS * ROLL_SAMPLES,
    samples: 0,
    cpuPct: 0,
    uiCpuPct: 0,
    fps: 0,
    inkFps: 0,
    maxCpuPct: 0,
    maxFps: 0,
    maxInkFps: 0,
    maxLoopLagMs: 0,
  };
}

function computeAvg10(): ProcessStatsSnap["avg10s"] {
  if (rollBuf.length === 0) return emptyAvg10();
  let sumCpu = 0;
  let sumUi = 0;
  let sumFps = 0;
  let sumInk = 0;
  let sumDt = 0;
  let maxCpu = 0;
  let maxFps = 0;
  let maxInk = 0;
  let maxLag = 0;
  for (const p of rollBuf) {
    sumCpu += p.cpuPct * p.dt;
    sumUi += p.uiCpuPct * p.dt;
    sumFps += p.fps * p.dt;
    sumInk += p.inkFps * p.dt;
    sumDt += p.dt;
    if (p.cpuPct > maxCpu) maxCpu = p.cpuPct;
    if (p.fps > maxFps) maxFps = p.fps;
    if (p.inkFps > maxInk) maxInk = p.inkFps;
    if (p.loopLagMs > maxLag) maxLag = p.loopLagMs;
  }
  const d = Math.max(1, sumDt);
  return {
    windowMs: Math.round(sumDt),
    samples: rollBuf.length,
    cpuPct: Math.round((sumCpu / d) * 10) / 10,
    uiCpuPct: Math.round((sumUi / d) * 10) / 10,
    fps: Math.round((sumFps / d) * 10) / 10,
    inkFps: Math.round((sumInk / d) * 10) / 10,
    maxCpuPct: Math.round(maxCpu * 10) / 10,
    maxFps: Math.round(maxFps * 10) / 10,
    maxInkFps: Math.round(maxInk * 10) / 10,
    maxLoopLagMs: Math.round(maxLag),
  };
}

let snap: ProcessStatsSnap = {
  cpuPct: 0,
  uiCpuPct: 0,
  agentCpuPct: 0,
  rssMb: 0,
  heapMb: 0,
  extMb: 0,
  windowMs: SAMPLE_MS,
  agentShare: 0,
  fps: 0,
  inkFps: 0,
  uiPhases: emptyPhases(),
  uiTop: null,
  loopLagMs: 0,
  load1: 0,
  cpuCount: os.cpus()?.length || 1,
  loadPerCore: 0,
  gridHitRate: 0,
  scrollShare: 0,
  native: false,
  verdict: "idle",
  verdictHint: "—",
  ts: Date.now(),
  avg10s: emptyAvg10(),
};

let nativeFlag = false;

export function setNativeRasterFlag(on: boolean): void {
  nativeFlag = on;
}

export function noteUiPhase(phase: UiPhase, n = 1): void {
  phaseCounts[phase] += n;
}

export function notePaintFrame(): void {
  paintFrameCount++;
  phaseCounts.paint++;
}

export function noteInkFrame(): void {
  inkFrameCount++;
  phaseCounts.ink++;
}

export function noteGridBuild(hit: boolean): void {
  if (hit) gridHitCount++;
  else {
    gridMissCount++;
    phaseCounts.grid++;
  }
}

/** 由 store 同步 scrollActive，统计滚动占用墙钟 */
export function setScrollBusy(busy: boolean): void {
  const now = Date.now();
  if (busy === scrollFlag) return;
  if (scrollFlag) {
    scrollActiveMs += Math.max(0, now - scrollSampleStart);
  }
  scrollFlag = busy;
  scrollSampleStart = now;
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function pickTop(rates: UiPhaseRates): UiPhase | null {
  let top: UiPhase | null = null;
  let best = 0;
  for (const p of UI_PHASES) {
    const v = rates[p];
    if (v > best) {
      best = v;
      top = p;
    }
  }
  return best > 0 ? top : null;
}

function diagnose(s: {
  cpuPct: number;
  uiCpuPct: number;
  agentCpuPct: number;
  fps: number;
  inkFps: number;
  loopLagMs: number;
  loadPerCore: number;
  uiTop: UiPhase | null;
  uiPhases: UiPhaseRates;
  scrollShare: number;
}): { verdict: PerfVerdict; verdictHint: string } {
  const { cpuPct, uiCpuPct, agentCpuPct, fps, loopLagMs, loadPerCore, uiTop, uiPhases, scrollShare } =
    s;

  const machineHot = loadPerCore >= 0.85 || loopLagMs >= 80;
  const cliHot = uiCpuPct >= 35 || (fps > 0 && fps < 20 && uiCpuPct >= 20);
  const agentHot = agentCpuPct >= 25;

  if (cpuPct < 12 && fps < 3 && uiTop === null && loopLagMs < 20) {
    return { verdict: "idle", verdictHint: "空闲·正常（无滚动时 fps 低可忽略）" };
  }

  if (machineHot && !cliHot && !agentHot) {
    return {
      verdict: "machine",
      verdictHint: `整机忙 load/核=${loadPerCore.toFixed(2)} lag=${Math.round(loopLagMs)}ms·非本CLI独吞`,
    };
  }

  if (machineHot && (cliHot || agentHot)) {
    return {
      verdict: "mixed",
      verdictHint: `整机+本进程·load/核=${loadPerCore.toFixed(2)} ui${uiCpuPct.toFixed(0)}%`,
    };
  }

  if (agentHot && agentCpuPct >= uiCpuPct) {
    return { verdict: "agent", verdictHint: "agent/流式后端占 CPU·非纯滚动问题" };
  }

  if (scrollShare > 0.25 || uiTop === "scroll" || (uiPhases.scroll ?? 0) >= 5) {
    return {
      verdict: "cli-scroll",
      verdictHint: "CLI滚动管线·ink/layout+paint 重（非仅电脑）",
    };
  }

  if (uiTop === "ink" || (uiPhases.ink ?? 0) > (uiPhases.paint ?? 0) * 1.2) {
    return {
      verdict: "cli-ink",
      verdictHint: "CLI Ink/React 提交过密·布局重",
    };
  }

  if (uiTop === "paint" || uiTop === "grid") {
    return {
      verdict: "cli-paint",
      verdictHint: "CLI 写屏/grid 重建重·终端输出路径",
    };
  }

  if (uiTop === "stream" || (uiPhases.stream ?? 0) > 5) {
    return { verdict: "cli-stream", verdictHint: "CLI 流式 delta 刷新密" };
  }

  if (cliHot) {
    return { verdict: "cli-busy", verdictHint: "CLI 前端忙·看 ↑ 阶段定位" };
  }

  return { verdict: "idle", verdictHint: "相对正常" };
}

function tick(): void {
  if (!enabled) return;
  const wall = Date.now();

  // 事件循环 lag：实际 tick 时刻相对期望
  let loopLagMs = 0;
  if (expectedTickAt > 0) {
    loopLagMs = Math.max(0, wall - expectedTickAt);
  }
  expectedTickAt = wall + SAMPLE_MS;

  const dt = Math.max(1, wall - lastWall);
  if (agentFlag) {
    agentActiveMs += Math.max(0, wall - sampleWallStart);
  }
  if (scrollFlag) {
    scrollActiveMs += Math.max(0, wall - scrollSampleStart);
    scrollSampleStart = wall;
  }
  const share = Math.min(1, Math.max(0, agentActiveMs / dt));
  const scrollShare = Math.min(1, Math.max(0, scrollActiveMs / dt));

  const cpu = process.cpuUsage(lastCpu);
  lastCpu = process.cpuUsage();
  lastWall = wall;
  const cpuMs = (cpu.user + cpu.system) / 1000;
  const cpuPct = Math.round((cpuMs / dt) * 1000) / 10;
  const mem = process.memoryUsage();
  const sec = dt / 1000;
  const fps = Math.round((paintFrameCount / sec) * 10) / 10;
  const inkFps = Math.round((inkFrameCount / sec) * 10) / 10;
  paintFrameCount = 0;
  inkFrameCount = 0;

  const uiPhases = emptyPhases();
  for (const p of UI_PHASES) {
    uiPhases[p] = Math.round((phaseCounts[p] / sec) * 10) / 10;
    phaseCounts[p] = 0;
  }

  const gridTotal = gridHitCount + gridMissCount;
  const gridHitRate =
    gridTotal > 0 ? Math.round((gridHitCount / gridTotal) * 1000) / 1000 : 0;
  gridHitCount = 0;
  gridMissCount = 0;

  const loads = os.loadavg?.() ?? [0, 0, 0];
  const load1 = Math.round((loads[0] ?? 0) * 100) / 100;
  const cpuCount = Math.max(1, os.cpus()?.length || 1);
  const loadPerCore = Math.round((load1 / cpuCount) * 100) / 100;

  const uiTop = pickTop(uiPhases);
  const uiCpuPct = Math.round(cpuPct * (1 - share) * 10) / 10;
  const agentCpuPct = Math.round(cpuPct * share * 10) / 10;

  const { verdict, verdictHint } = diagnose({
    cpuPct,
    uiCpuPct,
    agentCpuPct,
    fps,
    inkFps,
    loopLagMs,
    loadPerCore,
    uiTop,
    uiPhases,
    scrollShare,
  });

  rollBuf.push({
    cpuPct,
    uiCpuPct,
    fps,
    inkFps,
    loopLagMs: Math.round(loopLagMs),
    dt,
  });
  while (rollBuf.length > ROLL_SAMPLES) rollBuf.shift();
  const avg10s = computeAvg10();

  snap = {
    cpuPct,
    uiCpuPct,
    agentCpuPct,
    rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
    heapMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
    extMb: Math.round((mem.external / 1024 / 1024) * 10) / 10,
    windowMs: dt,
    agentShare: Math.round(share * 100) / 100,
    fps,
    inkFps,
    uiPhases,
    uiTop,
    loopLagMs: Math.round(loopLagMs),
    load1,
    cpuCount,
    loadPerCore,
    gridHitRate,
    scrollShare: Math.round(scrollShare * 100) / 100,
    native: nativeFlag,
    verdict,
    verdictHint,
    ts: wall,
    avg10s,
  };

  agentActiveMs = 0;
  sampleWallStart = wall;
  scrollActiveMs = 0;
  emit();
}

function ensureTimer(): void {
  if (timer || !enabled) return;
  lastCpu = process.cpuUsage();
  lastWall = Date.now();
  sampleWallStart = lastWall;
  scrollSampleStart = lastWall;
  agentActiveMs = 0;
  scrollActiveMs = 0;
  // 先立刻采一帧，避免 HUD 长时间停在全 0 初值
  expectedTickAt = 0;
  tick();
  expectedTickAt = Date.now() + SAMPLE_MS;
  timer = setInterval(tick, SAMPLE_MS);
  // 保持 ref：unref 时若主线程只挂 pipe 读，部分环境 interval 会极不稳定 / 像停更
}

function stopTimerIfIdle(): void {
  if (listeners.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function setAgentBusy(busy: boolean): void {
  const now = Date.now();
  if (busy === agentFlag) return;
  if (agentFlag) {
    agentActiveMs += Math.max(0, now - sampleWallStart);
  }
  agentFlag = busy;
  sampleWallStart = now;
  ensureTimer();
}

export function getProcessStats(): ProcessStatsSnap {
  return snap;
}

/** 采样窗毫秒（供 HUD 标注） */
export function processStatsSampleMs(): number {
  return SAMPLE_MS;
}

/** 滚动统计窗约秒数 */
export function processStatsRollSec(): number {
  return Math.round((SAMPLE_MS * ROLL_SAMPLES) / 1000);
}

/** Runtime override from Settings; null = follow env MAOU_PERF_HUD. */
let hudUserEnabled: boolean | null = null;

function envPerfHudDefault(): boolean {
  return resolvePerfHudDefault();
}

/** Settings / store: turn right-top PerfHud sampling + display on/off at runtime. */
export function setProcessStatsHudEnabled(on: boolean): void {
  hudUserEnabled = on;
  if (!on) {
    enabled = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  } else {
    enabled = true;
    if (listeners.size > 0) {
      ensureTimer();
      if (snap.ts === 0 || Date.now() - snap.ts > SAMPLE_MS * 2) tick();
    }
  }
}

export function subscribeProcessStats(cb: () => void): () => void {
  listeners.add(cb);
  if (processStatsHudEnabled()) {
    enabled = true;
    ensureTimer(); // 内部会立即 tick 一次
  } else {
    enabled = false;
  }
  return () => {
    listeners.delete(cb);
    stopTimerIfIdle();
  };
}

export function processStatsHudEnabled(): boolean {
  if (hudUserEnabled !== null) return hudUserEnabled;
  return envPerfHudDefault();
}

export function formatMem(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}G`;
  if (mb >= 100) return `${Math.round(mb)}M`;
  return `${mb.toFixed(1)}M`;
}

export function formatCpu(pct: number): string {
  if (pct >= 100) return `${Math.round(pct)}%`;
  if (pct >= 10) return `${pct.toFixed(0)}%`;
  return `${pct.toFixed(1)}%`;
}

export function formatFps(fps: number): string {
  if (fps >= 100) return `${Math.round(fps)}`;
  if (fps >= 10) return fps.toFixed(0);
  return fps.toFixed(1);
}

export function formatPhaseRate(n: number): string {
  if (n >= 100) return `${Math.round(n)}`;
  if (n >= 10) return n.toFixed(0);
  if (n <= 0) return "0";
  return n.toFixed(1);
}
