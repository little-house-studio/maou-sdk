/**
 * 会话级后台任务登记表：FIFO 结算、连续叫醒上限。
 */

export type JobStatus = "running" | "stopping" | "done" | "cancelled" | "failed";

export type SessionJob = {
  id: string;
  sessionId: string;
  status: JobStatus;
  kind: string;
  label?: string;
  createdAt: number;
  updatedAt: number;
  settledAt?: number;
};

export type JobLamp = {
  running: number;
  stopping: number;
  done: number;
  cancelled: number;
  failed: number;
  latest?: JobStatus;
};

export const DEFAULT_WAKE_STREAK_LIMIT = 3;

type SessionJobs = {
  jobs: Map<string, SessionJob>;
  fifo: string[];
  wakeStreak: number;
};

const sessions = new Map<string, SessionJobs>();

function bucket(sessionId: string): SessionJobs {
  let b = sessions.get(sessionId);
  if (!b) {
    b = { jobs: new Map(), fifo: [], wakeStreak: 0 };
    sessions.set(sessionId, b);
  }
  return b;
}

export function resetJobRegistryForTest(): void {
  sessions.clear();
}

export function registerJob(
  sessionId: string,
  id: string,
  extras?: { kind?: string; label?: string; status?: JobStatus },
): SessionJob {
  const b = bucket(sessionId);
  const now = Date.now();
  const existing = b.jobs.get(id);
  if (existing) {
    existing.updatedAt = now;
    if (extras?.label) existing.label = extras.label;
    return existing;
  }
  const job: SessionJob = {
    id,
    sessionId,
    status: extras?.status ?? "running",
    kind: extras?.kind ?? "terminal",
    label: extras?.label,
    createdAt: now,
    updatedAt: now,
  };
  b.jobs.set(id, job);
  b.fifo.push(id);
  return job;
}

export function completeJob(
  sessionId: string,
  id: string,
  status: Exclude<JobStatus, "running" | "stopping">,
): SessionJob | null {
  const b = sessions.get(sessionId);
  const job = b?.jobs.get(id);
  if (!job) return null;
  job.status = status;
  job.updatedAt = Date.now();
  job.settledAt = job.updatedAt;
  return job;
}

export function markJobStopping(sessionId: string, id: string): SessionJob | null {
  const b = sessions.get(sessionId);
  const job = b?.jobs.get(id);
  if (!job) return null;
  job.status = "stopping";
  job.updatedAt = Date.now();
  return job;
}

/** 取出该会话已完成、尚未结算的任务（FIFO）。 */
export function takeSettledJobs(sessionId: string): SessionJob[] {
  const b = sessions.get(sessionId);
  if (!b) return [];
  const ready: SessionJob[] = [];
  const remain: string[] = [];
  for (const id of b.fifo) {
    const job = b.jobs.get(id);
    if (!job) continue;
    if (job.status === "running" || job.status === "stopping") {
      remain.push(id);
      continue;
    }
    ready.push(job);
  }
  b.fifo = remain;
  return ready;
}

export function noteAutoWake(sessionId: string): { allowed: boolean; streak: number } {
  const b = bucket(sessionId);
  b.wakeStreak += 1;
  return { allowed: b.wakeStreak <= DEFAULT_WAKE_STREAK_LIMIT, streak: b.wakeStreak };
}

export function resetWakeStreak(sessionId: string): void {
  const b = sessions.get(sessionId);
  if (b) b.wakeStreak = 0;
}

export function jobLamp(sessionId: string): JobLamp {
  const b = sessions.get(sessionId);
  const lamp: JobLamp = { running: 0, stopping: 0, done: 0, cancelled: 0, failed: 0 };
  if (!b) return lamp;
  for (const job of b.jobs.values()) {
    lamp[job.status] += 1;
    lamp.latest = job.status;
  }
  return lamp;
}

export function listSessionJobs(sessionId: string): SessionJob[] {
  const b = sessions.get(sessionId);
  if (!b) return [];
  return [...b.jobs.values()].sort((a, c) => a.createdAt - c.createdAt);
}
