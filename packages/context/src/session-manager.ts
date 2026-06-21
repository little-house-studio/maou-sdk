/**
 * 会话管理器 —— 多会话切换、暂停/恢复、滚动摘要持久化。
 * 坐在 SessionStore 之上，管理每个 agent 的活跃会话。
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import type { SessionStore, SessionListItem } from "./session-store.js";
import type { ActiveSession, SwitchResult } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = join(filePath, "..");
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, filePath);
}

interface ManagerState {
  active_sessions: Record<string, ActiveSession>;  // agentName -> ActiveSession
  rolling_summaries: Record<string, string>;        // sessionId -> summary
  updated_at: string;
}

export class SessionManager {
  private sessionStore: SessionStore;
  private managerDir: string;
  private activeSessions = new Map<string, ActiveSession>();
  private rollingSummaries = new Map<string, string>();

  constructor(sessionStore: SessionStore, maouRoot: string) {
    this.sessionStore = sessionStore;
    this.managerDir = join(maouRoot, "session-manager");
    mkdirSync(this.managerDir, { recursive: true });
  }

  // ─── 活跃会话 ──────────────────────────────────────────────────────────────

  /** 获取 agent 当前活跃会话 */
  getActiveSession(agentName: string): ActiveSession | null {
    return this.activeSessions.get(agentName) ?? null;
  }

  /** 切换到指定会话 */
  switchSession(agentName: string, targetSessionId: string): SwitchResult {
    // 暂停当前
    const prev = this.activeSessions.get(agentName) ?? {
      sessionId: "",
      agentName,
      status: "completed" as const,
    };

    if (prev.status === "active") {
      prev.status = "paused";
      prev.pausedAt = nowIso();
      // 快照当前滚动摘要
      prev.rollingSummary = this.rollingSummaries.get(prev.sessionId) ?? undefined;
    }

    // 激活目标
    const next: ActiveSession = {
      sessionId: targetSessionId,
      agentName,
      status: "active",
      rollingSummary: this.rollingSummaries.get(targetSessionId),
    };

    this.activeSessions.set(agentName, next);
    this.saveState();

    return { previousSession: prev, newSession: next };
  }

  /** 暂停当前会话 */
  pauseCurrent(agentName: string): ActiveSession | null {
    const current = this.activeSessions.get(agentName);
    if (!current || current.status !== "active") return null;

    current.status = "paused";
    current.pausedAt = nowIso();
    current.rollingSummary = this.rollingSummaries.get(current.sessionId) ?? undefined;

    this.saveState();
    return current;
  }

  /** 恢复指定会话 */
  resumeSession(agentName: string, sessionId: string): SwitchResult {
    return this.switchSession(agentName, sessionId);
  }

  /** 创建新会话并切换到它 */
  createAndSwitch(agentName: string, title?: string): ActiveSession {
    const session = this.sessionStore.create({ title, agentName });
    const active: ActiveSession = {
      sessionId: session.id,
      agentName,
      status: "active",
    };

    // 暂停当前
    const prev = this.activeSessions.get(agentName);
    if (prev && prev.status === "active") {
      prev.status = "paused";
      prev.pausedAt = nowIso();
      prev.rollingSummary = this.rollingSummaries.get(prev.sessionId) ?? undefined;
    }

    this.activeSessions.set(agentName, active);
    this.saveState();
    return active;
  }

  /** Fork 源会话并切换到新会话 */
  forkAndSwitch(agentName: string, sourceSessionId: string, newTitle?: string): SwitchResult {
    const newSession = this.sessionStore.forkSession(sourceSessionId, newTitle);
    return this.switchSession(agentName, newSession.id);
  }

  /** 设置 agent 活跃会话（不暂停之前的，用于初始化） */
  setActiveSession(agentName: string, sessionId: string): void {
    const current = this.activeSessions.get(agentName);
    if (current && current.sessionId === sessionId && current.status === "active") return;

    this.activeSessions.set(agentName, {
      sessionId,
      agentName,
      status: "active",
    });
    // 不立即 saveState，等运行时自然保存
  }

  // ─── 滚动摘要（持久化） ────────────────────────────────────────────────────

  getRollingSummary(sessionId: string): string {
    return this.rollingSummaries.get(sessionId) ?? "";
  }

  setRollingSummary(sessionId: string, summary: string): void {
    this.rollingSummaries.set(sessionId, summary);
  }

  // ─── 持久化 ────────────────────────────────────────────────────────────────

  /** 保存状态到磁盘 */
  saveState(): void {
    const state: ManagerState = {
      active_sessions: {},
      rolling_summaries: {},
      updated_at: nowIso(),
    };

    for (const [agent, session] of this.activeSessions) {
      state.active_sessions[agent] = session;
    }
    for (const [sid, summary] of this.rollingSummaries) {
      // 只持久化非空的摘要
      if (summary.trim()) {
        state.rolling_summaries[sid] = summary;
      }
    }

    atomicWriteJson(join(this.managerDir, "state.json"), state);
  }

  /** 从磁盘恢复状态 */
  loadState(): void {
    const stateFile = join(this.managerDir, "state.json");
    if (!existsSync(stateFile)) return;

    try {
      const data = JSON.parse(readFileSync(stateFile, "utf-8")) as ManagerState;

      // 恢复活跃会话
      if (data.active_sessions) {
        for (const [agent, session] of Object.entries(data.active_sessions)) {
          this.activeSessions.set(agent, session);
        }
      }

      // 恢复滚动摘要
      if (data.rolling_summaries) {
        for (const [sid, summary] of Object.entries(data.rolling_summaries)) {
          this.rollingSummaries.set(sid, summary);
        }
      }
    } catch {
      // 损坏的状态文件，忽略
    }
  }

  // ─── 列表 ──────────────────────────────────────────────────────────────────

  /** 列出指定 agent 的所有会话 */
  listSessionsByAgent(agentName: string): SessionListItem[] {
    return this.sessionStore.list().filter(s => {
      // 通过 meta 文件判断 agent
      const session = this.sessionStore.load(s.id);
      return session && session.agentName === agentName;
    });
  }
}
