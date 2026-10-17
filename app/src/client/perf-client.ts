/**
 * 渲染进程占用：longtask + rAF 掉帧时 POST /api/perf/client。
 */

const POST_GAP_MS = 2000;
const FPS_FLOOR = 20;
const LONGTASK_MS = 50;

let lastPost = 0;
let rafId = 0;
let lastRaf = 0;
let observer: PerformanceObserver | null = null;

export function startPerfClient(): () => void {
  if (typeof window === "undefined" || typeof performance === "undefined") {
    return () => {};
  }
  lastRaf = performance.now();
  const loop = (now: number) => {
    const dt = now - lastRaf;
    lastRaf = now;
    if (dt > 0 && document.visibilityState === "visible") {
      const fps = 1000 / dt;
      if (fps < FPS_FLOOR && dt >= LONGTASK_MS) {
        void post({ fps, loopLagMs: dt });
      }
    }
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);

  if (typeof PerformanceObserver === "function") {
    try {
      observer = new PerformanceObserver((list) => {
        let worst = 0;
        for (const entry of list.getEntries()) {
          if (entry.duration > worst) worst = entry.duration;
        }
        if (worst >= LONGTASK_MS) void post({ longtaskMs: worst, loopLagMs: worst });
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      observer = null;
    }
  }

  return () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    observer?.disconnect();
    observer = null;
  };
}

async function post(snap: { fps?: number; loopLagMs?: number; longtaskMs?: number }): Promise<void> {
  const now = Date.now();
  if (now - lastPost < POST_GAP_MS) return;
  lastPost = now;
  try {
    await fetch("/api/perf/client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snap),
    });
  } catch {
    /* 日志通道失败不影响 UI */
  }
}
