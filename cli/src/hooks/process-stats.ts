/**
 * 本进程 CPU / 内存采样（TUI 右上角 PerfHud 用）。
 *
 * 单进程内「前端 / 后端」按活跃态分摊 CPU：
 *   - agent（后端）：streaming 或工具执行中
 *   - ui（前端）：其余时间（Ink 布局 / 绘制 / 输入）
 *
 * UI 阶段计数（本窗 events/sec，相对谁最忙）：
 *   ink    — React/Ink onRender
 *   paint  — vram 写出（full / 脏行）
 *   grid   — buildGrid 未命中缓存（扫 cell）
 *   mouse  — 鼠标 motion / hover 变更
 *   stream — 流式 delta 批 flush
 *   scroll — 对话区滚轮步进
 *
 * MAOU_PERF_HUD=0 可关闭采样与 HUD。
 */

/** HUD 上展示的 UI 阶段（少而可对照） */
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

export type ProcessStatsSnap = {
  /** 单核占用 %（本采样窗） */
  cpuPct: number;
  /** 分摊到 UI 的 cpu% */
  uiCpuPct: number;
  /** 分摊到 agent 的 cpu% */
  agentCpuPct: number;
  /** RSS MB */
  rssMb: number;
  /** heapUsed MB */
  heapMb: number;
  /** 采样窗口 ms */
  windowMs: number;
  /** 本窗 agent 活跃占比 0–1 */
  agentShare: number;
  /**
   * 实际写出帧率（vram paintFull+paintSel / 秒）
   * 比 ink 更接近「屏幕刷新」
   */
  fps: number;
  /** Ink onRender 次数/秒（React 提交，可能 > 实际 paint） */
  inkFps: number;
  /** 各 UI 阶段 events/sec（相对负载） */
  uiPhases: UiPhaseRates;
  /** 本窗相对最忙的 UI 阶段（并列取列表顺序靠前） */
  uiTop: UiPhase | null;
  ts: number;
};

/** 2s 采样：HUD 刷新本身会触发 Ink，不必 1Hz */
const SAMPLE_MS = 2000;

let lastCpu = process.cpuUsage();
let lastWall = Date.now();
let agentActiveMs = 0;
let sampleWallStart = Date.now();
let agentFlag = false;
let timer: ReturnType<typeof setInterval> | null = null;
let enabled = true;

/** 本采样窗帧计数（始终累加，不依赖 MAOU_PERF） */
let paintFrameCount = 0;
let inkFrameCount = 0;

const phaseCounts: Record<UiPhase, number> = {
  ink: 0,
  paint: 0,
  grid: 0,
  mouse: 0,
  stream: 0,
  scroll: 0,
};

function emptyPhases(): UiPhaseRates {
  return { ink: 0, paint: 0, grid: 0, mouse: 0, stream: 0, scroll: 0 };
}

let snap: ProcessStatsSnap = {
  cpuPct: 0,
  uiCpuPct: 0,
  agentCpuPct: 0,
  rssMb: 0,
  heapMb: 0,
  windowMs: SAMPLE_MS,
  agentShare: 0,
  fps: 0,
  inkFps: 0,
  uiPhases: emptyPhases(),
  uiTop: null,
  ts: Date.now(),
};

/** 任意 UI 阶段事件（HUD 始终统计） */
export function noteUiPhase(phase: UiPhase, n = 1): void {
  phaseCounts[phase] += n;
}

/** vram 实际写出一帧（full 或脏行） */
export function notePaintFrame(): void {
  paintFrameCount++;
  phaseCounts.paint++;
}

/** Ink onRender 一次 */
export function noteInkFrame(): void {
  inkFrameCount++;
  phaseCounts.ink++;
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

function tick(): void {
  if (!enabled) return;
  const wall = Date.now();
  const dt = Math.max(1, wall - lastWall);
  // 本窗末若仍 active，补齐
  if (agentFlag) {
    agentActiveMs += Math.max(0, wall - sampleWallStart);
  }
  const share = Math.min(1, Math.max(0, agentActiveMs / dt));

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

  snap = {
    cpuPct,
    uiCpuPct: Math.round(cpuPct * (1 - share) * 10) / 10,
    agentCpuPct: Math.round(cpuPct * share * 10) / 10,
    rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
    heapMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
    windowMs: dt,
    agentShare: Math.round(share * 100) / 100,
    fps,
    inkFps,
    uiPhases,
    uiTop: pickTop(uiPhases),
    ts: wall,
  };

  agentActiveMs = 0;
  sampleWallStart = wall;
  emit();
}

function ensureTimer(): void {
  if (timer || !enabled) return;
  lastCpu = process.cpuUsage();
  lastWall = Date.now();
  sampleWallStart = lastWall;
  agentActiveMs = 0;
  timer = setInterval(tick, SAMPLE_MS);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}

function stopTimerIfIdle(): void {
  if (listeners.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** agent 忙闲（streaming / tool_pending）— 由 UI 或 store 订阅驱动 */
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

export function subscribeProcessStats(cb: () => void): () => void {
  if (process.env.MAOU_PERF_HUD === "0" || process.env.MAOU_PERF_HUD === "false") {
    enabled = false;
    return () => {};
  }
  enabled = true;
  listeners.add(cb);
  ensureTimer();
  // 立刻采一次，避免 HUD 空白
  if (snap.ts === 0 || Date.now() - snap.ts > SAMPLE_MS * 2) tick();
  return () => {
    listeners.delete(cb);
    stopTimerIfIdle();
  };
}

export function processStatsHudEnabled(): boolean {
  return process.env.MAOU_PERF_HUD !== "0" && process.env.MAOU_PERF_HUD !== "false";
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

/** 帧率显示：整数优先，过高截断 */
export function formatFps(fps: number): string {
  if (fps >= 100) return `${Math.round(fps)}`;
  if (fps >= 10) return fps.toFixed(0);
  return fps.toFixed(1);
}

/** 阶段速率：紧凑数字 */
export function formatPhaseRate(n: number): string {
  if (n >= 100) return `${Math.round(n)}`;
  if (n >= 10) return n.toFixed(0);
  if (n <= 0) return "0";
  return n.toFixed(1);
}
