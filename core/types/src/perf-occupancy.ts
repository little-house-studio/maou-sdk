/** 高占用判定：纯函数，渲染进程与 Node 共用。 */

export type PerfProcess = "app-hub" | "cli" | "app-renderer";

export type PerfLogKind = "occupancy" | "mark" | "profile";

export type PerfReason =
  | "loopLag"
  | "cpu"
  | "rss"
  | "heap"
  | "mark"
  | "profile"
  | "fps"
  | "longtask";

export const PERF_THRESHOLDS = {
  loopLagMs: 50,
  cpuPct: 80,
  rssMb: 1500,
  heapMb: 800,
  markMs: 80,
  noteMarkMs: 16,
  profileTotalMs: 8000,
  profileSpanMaxMs: 2000,
  fps: 20,
  longtaskMs: 50,
  writeGapMs: 2000,
} as const;

export type PerfOccupancySnap = {
  cpuPct?: number;
  rssMb?: number;
  heapMb?: number;
  loopLagMs?: number;
  load1?: number;
  fps?: number;
  longtaskMs?: number;
};

export type PerfMark = {
  name: string;
  durationMs: number;
  count?: number;
  maxMs?: number;
  totalMs?: number;
};

export type PerfProfileLite = {
  label: string;
  totalMs: number;
  maxSpanMs: number;
  spans: Array<{ name: string; totalMs: number; count: number; avgMs: number; maxMs: number }>;
};

export function perfLogMode(env = processEnv("MAOU_PERF_LOG")): "off" | "force" | "hot" {
  const v = (env ?? "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return "off";
  if (v === "1" || v === "true" || v === "on") return "force";
  return "hot";
}

export function classifyOccupancy(snap: PerfOccupancySnap): PerfReason[] {
  const reasons: PerfReason[] = [];
  if ((snap.loopLagMs ?? 0) >= PERF_THRESHOLDS.loopLagMs) reasons.push("loopLag");
  if ((snap.cpuPct ?? 0) >= PERF_THRESHOLDS.cpuPct) reasons.push("cpu");
  if ((snap.rssMb ?? 0) >= PERF_THRESHOLDS.rssMb) reasons.push("rss");
  if ((snap.heapMb ?? 0) >= PERF_THRESHOLDS.heapMb) reasons.push("heap");
  if (snap.fps != null && snap.fps > 0 && snap.fps < PERF_THRESHOLDS.fps) reasons.push("fps");
  if ((snap.longtaskMs ?? 0) >= PERF_THRESHOLDS.longtaskMs) reasons.push("longtask");
  return reasons;
}

export function classifyMarks(marks: readonly PerfMark[] | undefined): boolean {
  if (!marks?.length) return false;
  return marks.some((m) => {
    const dur = m.maxMs ?? m.durationMs;
    return dur >= PERF_THRESHOLDS.markMs;
  });
}

export function classifyProfile(profile: { totalMs: number; maxSpanMs: number } | undefined): boolean {
  if (!profile) return false;
  return (
    profile.totalMs >= PERF_THRESHOLDS.profileTotalMs
    || profile.maxSpanMs >= PERF_THRESHOLDS.profileSpanMaxMs
  );
}

export function shouldWritePerfLog(opts: {
  env?: string;
  snap?: PerfOccupancySnap;
  marks?: readonly PerfMark[];
  profile?: { totalMs: number; maxSpanMs: number };
}): { write: boolean; reasons: PerfReason[] } {
  const mode = perfLogMode(opts.env ?? processEnv("MAOU_PERF_LOG"));
  if (mode === "off") return { write: false, reasons: [] };
  const reasons = classifyOccupancy(opts.snap ?? {});
  if (classifyMarks(opts.marks)) reasons.push("mark");
  if (classifyProfile(opts.profile)) reasons.push("profile");
  if (mode === "force") return { write: true, reasons };
  return { write: reasons.length > 0, reasons };
}

function processEnv(key: string): string | undefined {
  try {
    return typeof process !== "undefined" ? process.env[key] : undefined;
  } catch {
    return undefined;
  }
}
