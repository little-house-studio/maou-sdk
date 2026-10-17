/**
 * 高占用 JSONL：2s 采样，热了才追加 ~/.maou/logs/perf/YYYY-MM-DD.jsonl。
 */

import { appendFile, mkdir } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import { resolveUserMaouRoot } from "./maou-paths.js";
import type { ProfileReport } from "./profiler.js";
import {
  PERF_THRESHOLDS,
  classifyOccupancy,
  perfLogMode,
  shouldWritePerfLog,
  type PerfLogKind,
  type PerfMark,
  type PerfOccupancySnap,
  type PerfProcess,
  type PerfProfileLite,
  type PerfReason,
} from "./perf-occupancy.js";

export type PerfLogEntry = {
  ts: string;
  process: PerfProcess;
  kind: PerfLogKind;
  reasons: PerfReason[];
  cpuPct?: number;
  rssMb?: number;
  heapMb?: number;
  loopLagMs?: number;
  load1?: number;
  fps?: number;
  longtaskMs?: number;
  marks?: PerfMark[];
  profile?: PerfProfileLite;
};

export type StartPerfLogOpts = {
  process: PerfProcess;
  maouRoot?: string;
  env?: NodeJS.ProcessEnv;
};

const MARK_RING = 64;
const TOP_MARKS = 8;
const SAMPLE_MS = PERF_THRESHOLDS.writeGapMs;

let active = false;
let processName: PerfProcess = "app-hub";
let maouRoot: string | undefined;
let timer: ReturnType<typeof setInterval> | null = null;
let lastCpu = process.cpuUsage();
let lastWall = Date.now();
let expectedTickAt = 0;
let lastWriteAt = 0;
let writing = false;
let pendingLine: string | null = null;
const marks: PerfMark[] = [];

export function resolvePerfLogDir(userRoot?: string): string {
  return join(userRoot ? resolve(userRoot) : resolveUserMaouRoot(), "logs", "perf");
}

export function resolvePerfLogPath(userRoot?: string, at = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return join(resolvePerfLogDir(userRoot), `${y}-${m}-${d}.jsonl`);
}

export function getPerfProcess(): PerfProcess {
  return processName;
}

export function notePerfMark(name: string, durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < PERF_THRESHOLDS.noteMarkMs) return;
  marks.push({ name, durationMs });
  while (marks.length > MARK_RING) marks.shift();
}

export function configurePerfLog(opts: { process?: PerfProcess; maouRoot?: string }): void {
  if (opts.process) processName = opts.process;
  if (opts.maouRoot) maouRoot = opts.maouRoot;
}

export function startPerfLog(opts: StartPerfLogOpts): void {
  const env = opts.env ?? process.env;
  if (perfLogMode(env.MAOU_PERF_LOG) === "off") return;
  configurePerfLog({ process: opts.process, maouRoot: opts.maouRoot });
  if (active) return;
  active = true;
  lastCpu = process.cpuUsage();
  lastWall = Date.now();
  expectedTickAt = 0;
  sampleOnce();
  expectedTickAt = Date.now() + SAMPLE_MS;
  timer = setInterval(sampleOnce, SAMPLE_MS);
  if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
}

export function stopPerfLog(): void {
  active = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function writePerfLog(
  entry: Omit<PerfLogEntry, "ts" | "process" | "reasons"> & {
    ts?: string;
    process?: PerfProcess;
    reasons?: PerfReason[];
    snap?: PerfOccupancySnap;
  },
  opts?: { maouRoot?: string; now?: number; env?: string; force?: boolean },
): Promise<void> {
  const now = opts?.now ?? Date.now();
  const snap = entry.snap ?? {
    cpuPct: entry.cpuPct,
    rssMb: entry.rssMb,
    heapMb: entry.heapMb,
    loopLagMs: entry.loopLagMs,
    load1: entry.load1,
    fps: entry.fps,
    longtaskMs: entry.longtaskMs,
  };
  const profile = entry.profile
    ? { totalMs: entry.profile.totalMs, maxSpanMs: entry.profile.maxSpanMs }
    : undefined;
  const marksForGate = entry.marks ?? peekMarks();
  const gate = shouldWritePerfLog({
    env: opts?.env,
    snap,
    marks: marksForGate,
    profile,
  });
  if (perfLogMode(opts?.env) === "off") return Promise.resolve();
  if (!opts?.force && !gate.write) return Promise.resolve();
  if (!opts?.force && entry.kind !== "profile" && now - lastWriteAt < PERF_THRESHOLDS.writeGapMs) {
    return Promise.resolve();
  }
  if (!entry.marks) takeMarks();
  lastWriteAt = now;
  const line = JSON.stringify({
    ts: entry.ts ?? new Date(now).toISOString(),
    process: entry.process ?? processName,
    kind: entry.kind,
    reasons: entry.reasons ?? gate.reasons,
    ...(snap.cpuPct != null ? { cpuPct: round1(snap.cpuPct) } : {}),
    ...(snap.rssMb != null ? { rssMb: round1(snap.rssMb) } : {}),
    ...(snap.heapMb != null ? { heapMb: round1(snap.heapMb) } : {}),
    ...(snap.loopLagMs != null ? { loopLagMs: Math.round(snap.loopLagMs) } : {}),
    ...(snap.load1 != null ? { load1: round2(snap.load1) } : {}),
    ...(snap.fps != null ? { fps: round1(snap.fps) } : {}),
    ...(snap.longtaskMs != null ? { longtaskMs: Math.round(snap.longtaskMs) } : {}),
    ...(marksForGate.length ? { marks: topMarks(marksForGate) } : {}),
    ...(entry.profile ? { profile: entry.profile } : {}),
  } satisfies PerfLogEntry);
  return enqueueLine(`${line}\n`, opts?.maouRoot ?? maouRoot, now);
}

export function writePerfProfile(report: ProfileReport, process = processName): Promise<void> {
  const maxSpanMs = report.spans.reduce((m, s) => Math.max(m, s.maxMs), 0);
  return writePerfLog({
    kind: "profile",
    process,
    profile: {
      label: report.label,
      totalMs: report.totalMs,
      maxSpanMs,
      spans: report.spans.slice(0, TOP_MARKS).map((s) => ({
        name: s.name,
        totalMs: s.totalMs,
        count: s.count,
        avgMs: s.avgMs,
        maxMs: s.maxMs,
      })),
    },
  });
}

export function resetPerfLogForTest(): void {
  stopPerfLog();
  marks.length = 0;
  lastWriteAt = 0;
  writing = false;
  pendingLine = null;
  processName = "app-hub";
  maouRoot = undefined;
}

function sampleOnce(): void {
  if (!active) return;
  const wall = Date.now();
  let loopLagMs = 0;
  if (expectedTickAt > 0) loopLagMs = Math.max(0, wall - expectedTickAt);
  expectedTickAt = wall + SAMPLE_MS;
  const dt = Math.max(1, wall - lastWall);
  const cpu = process.cpuUsage(lastCpu);
  lastCpu = process.cpuUsage();
  lastWall = wall;
  const cpuPct = ((cpu.user + cpu.system) / 1000 / dt) * 100;
  const mem = process.memoryUsage();
  const snap: PerfOccupancySnap = {
    cpuPct: Math.round(cpuPct * 10) / 10,
    rssMb: mem.rss / 1024 / 1024,
    heapMb: mem.heapUsed / 1024 / 1024,
    loopLagMs,
    load1: os.loadavg?.()[0] ?? 0,
  };
  const taken = peekMarks();
  const gate = shouldWritePerfLog({ snap, marks: taken });
  if (!gate.write) return;
  void writePerfLog({
    kind: "occupancy",
    snap,
    marks: takeMarks(),
    reasons: gate.reasons.length ? gate.reasons : classifyOccupancy(snap),
  });
}

function peekMarks(): PerfMark[] {
  return marks.slice();
}

function takeMarks(): PerfMark[] {
  if (!marks.length) return [];
  const out = marks.slice();
  marks.length = 0;
  return out;
}

function restoreMarks(list: readonly PerfMark[]): void {
  for (const m of list) marks.push(m);
  while (marks.length > MARK_RING) marks.shift();
}

function topMarks(list: readonly PerfMark[]): PerfMark[] {
  const byName = new Map<string, { count: number; maxMs: number; totalMs: number }>();
  for (const m of list) {
    const cur = byName.get(m.name) ?? { count: 0, maxMs: 0, totalMs: 0 };
    const dur = m.durationMs;
    cur.count += m.count ?? 1;
    cur.maxMs = Math.max(cur.maxMs, m.maxMs ?? dur);
    cur.totalMs += m.totalMs ?? dur;
    byName.set(m.name, cur);
  }
  return [...byName.entries()]
    .map(([name, v]) => ({
      name,
      durationMs: v.maxMs,
      count: v.count,
      maxMs: v.maxMs,
      totalMs: Math.round(v.totalMs),
    }))
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, TOP_MARKS);
}

function enqueueLine(line: string, root: string | undefined, now: number): Promise<void> {
  if (writing) {
    pendingLine = line;
    return Promise.resolve();
  }
  writing = true;
  return appendLine(line, root, now).finally(() => {
    writing = false;
    if (pendingLine) {
      const next = pendingLine;
      pendingLine = null;
      void enqueueLine(next, root, Date.now());
    }
  });
}

async function appendLine(line: string, root: string | undefined, now: number): Promise<void> {
  const dir = resolvePerfLogDir(root);
  const file = resolvePerfLogPath(root, new Date(now));
  try {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await appendFile(file, line, "utf8");
  } catch {
    try {
      mkdirSync(dir, { recursive: true });
      await appendFile(file, line, "utf8");
    } catch {
      /* 日志失败不影响主路径 */
    }
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
