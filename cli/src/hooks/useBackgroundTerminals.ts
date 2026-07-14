/**
 * useBackgroundTerminals —— 轮询本 agent 后台终端状态（listTerminals）。
 *
 * 模块级单例 poller，多组件订阅不重复 setInterval。
 * native 引擎不可用时静默返回空列表。
 *
 * 性能：历史 ToolCard 应 enabled=false，避免 20 轮 × N 卡 每 700ms 全量 setState。
 * 签名忽略 elapsedMs，仅 state/progress 变化时通知。
 */

import { useEffect, useState, useRef } from "react";
import { listTerminals } from "@little-house-studio/tools";
import { useStore } from "../state/store.js";
import { isLiteNoBgPoll } from "../config/lite-mode.js";

export interface BgTerminalInfo {
  id: string;
  description: string;
  state: string;
  command: string;
  exitCode?: number | null;
  createdAt?: string;
  elapsedMs: number;
  progressPct: number | null;
}

/**
 * 轮询间隔。
 * 过短（如 300ms）会在有 listener 时反复 snapshot；过长则进度滞后。
 * 700ms 对 LIVE 卡够用；EventBlock 仅看 state 变化，签名不变不 setState。
 */
const POLL_MS = 1500;

/** 从命令输出/描述里抠 `12%` / `progress: 0.12` */
export function extractProgressPct(...texts: string[]): number | null {
  for (const t of texts) {
    if (!t) continue;
    const m1 = t.match(/(?:^|[^\d])(\d{1,3})\s*%/);
    if (m1) {
      const n = Number(m1[1]);
      if (n >= 0 && n <= 100) return n;
    }
    const m2 = t.match(/(?:progress|pct|percent)[:=\s]+(\d+(?:\.\d+)?)/i);
    if (m2) {
      let n = Number(m2[1]);
      if (n <= 1) n *= 100;
      if (n >= 0 && n <= 100) return Math.round(n);
    }
  }
  return null;
}

function mapTerm(t: {
  id: string;
  description?: string;
  state?: string;
  command?: string;
  exitCode?: number | null;
  createdAt?: string;
}): BgTerminalInfo {
  const createdAt = t.createdAt;
  let elapsedMs = 0;
  if (createdAt) {
    const ts = Date.parse(createdAt);
    if (!Number.isNaN(ts)) elapsedMs = Math.max(0, Date.now() - ts);
  }
  const description = t.description ?? "";
  const command = t.command ?? "";
  return {
    id: t.id,
    description,
    state: t.state ?? "unknown",
    command,
    exitCode: t.exitCode ?? null,
    createdAt,
    elapsedMs,
    progressPct: extractProgressPct(description, command),
  };
}

// ─── 模块级单例 ──────────────────────────────────────────────
type Listener = (list: BgTerminalInfo[]) => void;
const listeners = new Set<Listener>();
let cached: BgTerminalInfo[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let polledAgent = "";

function snapshot(agentName: string): BgTerminalInfo[] {
  try {
    const list = listTerminals(agentName) as Array<{
      id: string;
      description?: string;
      state?: string;
      command?: string;
      exitCode?: number | null;
      createdAt?: string;
    }>;
    return (list ?? []).map(mapTerm);
  } catch {
    return [];
  }
}

function ensurePoller(agentName: string): void {
  if (timer && polledAgent === agentName) return;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  polledAgent = agentName;
  const tick = () => {
    cached = snapshot(polledAgent);
    for (const l of listeners) l(cached);
  };
  tick();
  timer = setInterval(tick, POLL_MS);
}

function stopPollerIfIdle(): void {
  if (listeners.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
    polledAgent = "";
  }
}

function listSignature(list: BgTerminalInfo[]): string {
  // 忽略 elapsedMs 抖动：否则每 700ms 全 ToolCard setState → 长会话卡顿
  return list
    .map((t) => `${t.id}|${t.state}|${t.exitCode ?? ""}|${t.progressPct ?? ""}`)
    .join(";");
}

export function useBackgroundTerminals(opts?: {
  /** false 时不订阅轮询（历史 ToolCard 默认关闭） */
  enabled?: boolean;
}): {
  terminals: BgTerminalInfo[];
  running: BgTerminalInfo[];
} {
  // LITE：彻底不订轮询，避免 1.5s 循环 + 偶发 setState
  const enabled = opts?.enabled !== false && !isLiteNoBgPoll();
  const agentName = useStore((s) => s.agentName);
  const [terminals, setTerminals] = useState<BgTerminalInfo[]>(() =>
    enabled ? cached : [],
  );
  const sigRef = useRef(listSignature(cached));

  useEffect(() => {
    if (!enabled) {
      setTerminals([]);
      return;
    }
    const listener: Listener = (list) => {
      const sig = listSignature(list);
      if (sig === sigRef.current) return;
      sigRef.current = sig;
      setTerminals(list);
    };
    listeners.add(listener);
    ensurePoller(agentName);
    const snap = snapshot(agentName);
    sigRef.current = listSignature(snap);
    setTerminals(snap);
    return () => {
      listeners.delete(listener);
      stopPollerIfIdle();
    };
  }, [agentName, enabled]);

  const running = terminals.filter((t) => t.state === "running");
  return { terminals, running };
}

const RING = ["◐", "◓", "◑", "◒", "◐", "◓", "◑", "◒"] as const;

export function ringChar(frame: number): string {
  return RING[Math.abs(frame) % RING.length]!;
}

export function pctBar(pct: number | null, width = 8, frame = 0): string {
  if (pct == null) {
    const pos = frame % Math.max(1, width);
    return "░".repeat(pos) + "█" + "░".repeat(Math.max(0, width - pos - 1));
  }
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p / 100) * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m${rs.toString().padStart(2, "0")}s`;
}
