/**
 * CLI 运行时性能探针。
 *
 * 启用：`MAOU_PERF=1 maou` 或 `MAOU_PERF=1 tsx src/index.tsx`
 * 每 ~2s 向 stderr 打一行 JSON 摘要（不污染 TUI 备用屏主输出）。
 *
 * 指标：
 *  - paintFull / paintSel：vram 全量 / 脏行绘制次数
 *  - inkRender：Ink onRender 回调次数
 *  - streamFlush：流式 delta 批处理次数
 *  - hoverSet：hoverId 变更次数
 *  - animTick：全局动画时钟 tick
 *  - mouseMotion：鼠标 motion 事件（节流前）
 *  - rssMb / cpuMs：进程内存与 CPU 时间（delta）
 */

export type PerfCounters = {
  paintFull: number;
  paintSel: number;
  inkRender: number;
  streamFlush: number;
  hoverSet: number;
  animTick: number;
  mouseMotion: number;
  mouseDown: number;
  buildGrid: number;
  buildGridCacheHit: number;
};

const counters: PerfCounters = {
  paintFull: 0,
  paintSel: 0,
  inkRender: 0,
  streamFlush: 0,
  hoverSet: 0,
  animTick: 0,
  mouseMotion: 0,
  mouseDown: 0,
  buildGrid: 0,
  buildGridCacheHit: 0,
};

let enabled = false;
let reportTimer: ReturnType<typeof setInterval> | null = null;
let lastCpu: NodeJS.CpuUsage | null = null;
let lastWall = 0;

export function perfEnabled(): boolean {
  return enabled;
}

export function enablePerf(on = true): void {
  enabled = on;
  if (on && !reportTimer) {
    lastCpu = process.cpuUsage();
    lastWall = Date.now();
    reportTimer = setInterval(report, 2000);
    if (typeof reportTimer === "object" && "unref" in reportTimer) {
      reportTimer.unref();
    }
    process.stderr.write("[maou-perf] enabled — reporting every 2s to stderr\n");
  }
  if (!on && reportTimer) {
    clearInterval(reportTimer);
    reportTimer = null;
  }
}

/** 启动时若环境变量打开则自动启用 */
export function autoEnablePerfFromEnv(): void {
  if (process.env.MAOU_PERF === "1" || process.env.MAOU_PERF === "true") {
    enablePerf(true);
  }
}

export function perfInc(key: keyof PerfCounters, n = 1): void {
  if (!enabled) return;
  counters[key] += n;
}

export function getPerfCounters(): Readonly<PerfCounters> {
  return counters;
}

function report(): void {
  if (!enabled) return;
  const wall = Date.now();
  const dt = Math.max(1, wall - lastWall);
  const cpu = process.cpuUsage(lastCpu ?? undefined);
  lastCpu = process.cpuUsage();
  lastWall = wall;
  const cpuMs = (cpu.user + cpu.system) / 1000;
  const cpuPct = Math.round((cpuMs / dt) * 1000) / 10; // % of one core
  const mem = process.memoryUsage();
  const snap = { ...counters };
  // reset window counters
  for (const k of Object.keys(counters) as (keyof PerfCounters)[]) {
    counters[k] = 0;
  }
  const line = JSON.stringify({
    t: new Date().toISOString().slice(11, 19),
    windowMs: dt,
    cpuPct,
    rssMb: Math.round(mem.rss / 1024 / 1024),
    heapMb: Math.round(mem.heapUsed / 1024 / 1024),
    extMb: Math.round(mem.external / 1024 / 1024),
    ...snap,
    paintsPerSec: Math.round(((snap.paintFull + snap.paintSel) / dt) * 1000 * 10) / 10,
  });
  process.stderr.write(`[maou-perf] ${line}\n`);
}
