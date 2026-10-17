/** 后台派发的 Coding 会话：running / 完成后短时保留。 */

export type ActivityAgentStatus = "running" | "done" | "failed";

export type ActivityAgentRecord = {
  id: string;
  switchId: string;
  agent: string;
  displayName: string;
  sessionId: string;
  projectPath: string;
  projectName: string;
  parentSessionId: string;
  status: ActivityAgentStatus;
  startedAt: number;
  endedAt?: number;
  summary?: string;
};

export type ActivityAgentDto = {
  id: string;
  switchId: string;
  agent: string;
  displayName: string;
  sessionId: string;
  projectPath: string;
  projectName: string;
  parentSessionId: string;
  status: ActivityAgentStatus;
  startedAt: number;
  endedAt?: number;
};

export const ACTIVITY_RETAIN_MS = 30 * 60 * 1000;

export class ActivityAgentStore {
  private readonly items = new Map<string, ActivityAgentRecord>();

  upsert(rec: ActivityAgentRecord): ActivityAgentRecord {
    this.items.set(rec.id, rec);
    return rec;
  }

  get(id: string): ActivityAgentRecord | undefined {
    return this.items.get(id);
  }

  findBySession(sessionId: string): ActivityAgentRecord | undefined {
    for (const rec of this.items.values()) {
      if (rec.sessionId === sessionId) return rec;
    }
    return undefined;
  }

  complete(
    idOrSessionId: string,
    status: "done" | "failed",
    summary?: string,
    now = Date.now(),
  ): ActivityAgentRecord | null {
    const rec = this.items.get(idOrSessionId) ?? this.findBySession(idOrSessionId);
    if (!rec) return null;
    rec.status = status;
    rec.endedAt = now;
    if (summary) rec.summary = summary;
    this.items.set(rec.id, rec);
    return rec;
  }

  list(now = Date.now()): ActivityAgentDto[] {
    const out: ActivityAgentDto[] = [];
    for (const rec of this.items.values()) {
      if (rec.status !== "running" && rec.endedAt && now - rec.endedAt > ACTIVITY_RETAIN_MS) {
        this.items.delete(rec.id);
        continue;
      }
      out.push({
        id: rec.id,
        switchId: rec.switchId,
        agent: rec.agent,
        displayName: rec.displayName,
        sessionId: rec.sessionId,
        projectPath: rec.projectPath,
        projectName: rec.projectName,
        parentSessionId: rec.parentSessionId,
        status: rec.status,
        startedAt: rec.startedAt,
        endedAt: rec.endedAt,
      });
    }
    out.sort((a, b) => a.startedAt - b.startedAt);
    return out;
  }
}
