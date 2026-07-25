/**
 * Agent 列表运行态 / 已读态。
 *
 * - 进程内 Map 做热路径
 * - 落盘 ~/.maou/run/agent-presence.json，多窗口 / 多进程共享状态灯
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type AgentPresenceStatus =
  | "idle"
  | "running"
  | "done_unread"
  | "done_read"
  | "blocked"
  | "needs_reply";

export interface AgentPresence {
  lastActiveAt: number;
  lastViewedAt: number;
  lastDoneAt: number;
  running: boolean;
  blocked: boolean;
  needsReply: boolean;
  /** 可选：子 agent 名列表（最近一次扫描） */
  children?: string[];
  /** 显示用概述缓存 */
  overview?: string;
}

const presence = new Map<string, AgentPresence>();
let loadedFromDisk = false;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function presencePath(): string {
  const root = process.env.MAOU_HOME?.trim() || join(homedir(), ".maou");
  return join(root, "run", "agent-presence.json");
}

function empty(): AgentPresence {
  return {
    lastActiveAt: 0,
    lastViewedAt: 0,
    lastDoneAt: 0,
    running: false,
    blocked: false,
    needsReply: false,
  };
}

export function agentPresenceKey(agentName: string, projectRoot?: string | null): string {
  return projectRoot ? `${projectRoot}::${agentName}` : `system::${agentName}`;
}

function ensureLoaded(): void {
  if (loadedFromDisk) return;
  loadedFromDisk = true;
  try {
    const p = presencePath();
    if (!existsSync(p)) return;
    const raw = JSON.parse(readFileSync(p, "utf-8")) as {
      agents?: Record<string, AgentPresence>;
    };
    if (raw?.agents && typeof raw.agents === "object") {
      for (const [k, v] of Object.entries(raw.agents)) {
        if (!v || typeof v !== "object") continue;
        presence.set(k, { ...empty(), ...v });
      }
    }
  } catch {
    /* ignore corrupt */
  }
}

function scheduleFlush(): void {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPresence();
  }, 200);
  // 不阻止进程退出
  if (typeof flushTimer === "object" && "unref" in flushTimer) {
    (flushTimer as NodeJS.Timeout).unref?.();
  }
}

/** 立即落盘（测试 / 退出时） */
export function flushPresence(): void {
  if (!dirty && loadedFromDisk) {
    // 仍允许强制写
  }
  try {
    const p = presencePath();
    mkdirSync(dirname(p), { recursive: true });
    const agents: Record<string, AgentPresence> = {};
    for (const [k, v] of presence) agents[k] = v;
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, agents, updatedAt: Date.now() }, null, 2));
    renameSync(tmp, p);
    dirty = false;
  } catch {
    /* ignore */
  }
}

/** 从磁盘重新拉取（多窗口刷新列表前调用） */
export function reloadPresenceFromDisk(): void {
  loadedFromDisk = false;
  presence.clear();
  ensureLoaded();
}

export function getAgentPresence(key: string): AgentPresence {
  ensureLoaded();
  return presence.get(key) ?? empty();
}

export function setAgentOverview(key: string, overview: string): void {
  ensureLoaded();
  const p = presence.get(key) ?? empty();
  p.overview = overview.trim().slice(0, 120);
  presence.set(key, p);
  scheduleFlush();
}

export function markAgentRunning(key: string): void {
  ensureLoaded();
  const p = presence.get(key) ?? empty();
  p.running = true;
  p.blocked = false;
  p.needsReply = false;
  p.lastActiveAt = Date.now();
  presence.set(key, p);
  scheduleFlush();
}

export function markAgentDone(key: string): void {
  ensureLoaded();
  const p = presence.get(key) ?? empty();
  p.running = false;
  p.blocked = false;
  p.lastDoneAt = Date.now();
  presence.set(key, p);
  scheduleFlush();
}

export function markAgentViewed(key: string): void {
  ensureLoaded();
  const p = presence.get(key) ?? empty();
  p.lastViewedAt = Date.now();
  if (!p.running && p.lastDoneAt > 0 && p.lastViewedAt >= p.lastDoneAt) {
    p.needsReply = true;
  }
  presence.set(key, p);
  scheduleFlush();
}

export function markAgentBlocked(key: string, blocked: boolean): void {
  ensureLoaded();
  const p = presence.get(key) ?? empty();
  p.blocked = blocked;
  if (blocked) p.running = true;
  presence.set(key, p);
  scheduleFlush();
}

export function markAgentReplied(key: string): void {
  ensureLoaded();
  const p = presence.get(key) ?? empty();
  p.needsReply = false;
  p.lastActiveAt = Date.now();
  presence.set(key, p);
  scheduleFlush();
}

/** 登记子 agent 运行（project 下的 explore 等） */
export function markChildRunning(
  parentKey: string,
  childName: string,
  running: boolean,
): void {
  ensureLoaded();
  const childKey = `${parentKey}::child::${childName}`;
  if (running) markAgentRunning(childKey);
  else markAgentDone(childKey);
  const parent = presence.get(parentKey) ?? empty();
  const set = new Set(parent.children ?? []);
  if (running) set.add(childName);
  else set.delete(childName);
  parent.children = [...set];
  presence.set(parentKey, parent);
  scheduleFlush();
}

export function resolvePresenceStatus(
  key: string,
  opts: {
    isCurrent: boolean;
    streaming?: boolean;
    agentBusy?: boolean;
    hasApproval?: boolean;
    stale?: boolean;
  },
): AgentPresenceStatus {
  if (opts.stale) return "idle";
  ensureLoaded();
  const p = getAgentPresence(key);

  if (opts.isCurrent) {
    if (opts.hasApproval) return "blocked";
    if (opts.streaming || opts.agentBusy || p.running) return "running";
    if (p.lastDoneAt > 0 && p.lastViewedAt < p.lastDoneAt) return "done_unread";
    if (p.needsReply) return "needs_reply";
    if (p.lastDoneAt > 0) return "done_read";
    return "idle";
  }

  if (p.blocked) return "blocked";
  if (p.running) return "running";
  if (p.lastDoneAt > 0 && p.lastViewedAt < p.lastDoneAt) return "done_unread";
  if (p.needsReply) return "needs_reply";
  if (p.lastDoneAt > 0) return "done_read";
  return "idle";
}
