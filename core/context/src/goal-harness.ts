/**
 * 宿主编排长目标的 sidecar 状态。
 * 目录：`<sessionDir>/<sessionId>.goal/`
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  GoalHarnessPauseReason,
  GoalHarnessSnapshot,
  GoalHarnessStatus,
} from "@little-house-studio/types";
import {
  GOAL_HARNESS_CLASSIFIER_MAX,
  GOAL_HARNESS_STALL_THRESHOLD,
  goalHarnessIsOpen,
  goalHarnessIsPaused,
  pauseReasonToStatus,
} from "@little-house-studio/types";
import { appendLedgerEvent } from "./session-ledger.js";

export function goalHarnessDir(sessionDir: string, sessionId: string): string {
  return join(sessionDir, `${sessionId}.goal`);
}

function statePath(dir: string): string {
  return join(dir, "state.json");
}

export function planPath(sessionDir: string, sessionId: string): string {
  return join(goalHarnessDir(sessionDir, sessionId), "plan.md");
}

export function planBaselinePath(sessionDir: string, sessionId: string): string {
  return join(goalHarnessDir(sessionDir, sessionId), "plan.baseline.md");
}

export function scratchPath(sessionDir: string, sessionId: string): string {
  return join(goalHarnessDir(sessionDir, sessionId), "scratch");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const STATUSES = new Set<GoalHarnessStatus>([
  "active",
  "user_paused",
  "backoff_paused",
  "no_progress_paused",
  "infra_paused",
  "blocked",
  "budget_limited",
  "complete",
]);

function decodeSnapshot(value: unknown): GoalHarnessSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "string" || !value.id) return undefined;
  if (typeof value.objective !== "string" || !value.objective.trim()) return undefined;
  const status = value.status;
  if (typeof status !== "string" || !STATUSES.has(status as GoalHarnessStatus)) return undefined;
  const phase = value.phase;
  if (phase !== "idle" && phase !== "planning" && phase !== "executing") return undefined;
  const num = (key: string, fallback = 0): number =>
    typeof value[key] === "number" && Number.isFinite(value[key]) ? (value[key] as number) : fallback;
  const optStr = (key: string): string | undefined =>
    typeof value[key] === "string" && value[key] ? (value[key] as string) : undefined;
  const tokenBudget = num("tokenBudget", 0);
  return {
    id: value.id,
    objective: value.objective,
    status: status as GoalHarnessStatus,
    phase,
    ...(tokenBudget > 0 ? { tokenBudget } : {}),
    tokensUsed: Math.max(0, num("tokensUsed")),
    createdAt: num("createdAt", Date.now()),
    updatedAt: num("updatedAt", Date.now()),
    elapsedMs: Math.max(0, num("elapsedMs")),
    workerRounds: Math.max(0, num("workerRounds")),
    verifyRounds: Math.max(0, num("verifyRounds")),
    roundsSinceVerify: Math.max(0, num("roundsSinceVerify")),
    planReady: value.planReady === true,
    evaluatorBlockerKey: optStr("evaluatorBlockerKey"),
    evaluatorBlockedStreak: Math.max(0, num("evaluatorBlockedStreak")),
    classifierAttempts: Math.max(0, num("classifierAttempts")),
    classifierMax: Math.max(1, num("classifierMax", GOAL_HARNESS_CLASSIFIER_MAX)),
    lastGaps: optStr("lastGaps"),
    lastGapFingerprint: optStr("lastGapFingerprint"),
    stallCount: Math.max(0, num("stallCount")),
    consecutiveNotAchieved: Math.max(0, num("consecutiveNotAchieved")),
    lastStrategy: optStr("lastStrategy"),
    pauseMessage: optStr("pauseMessage"),
  };
}

function writeState(dir: string, snap: GoalHarnessSnapshot): void {
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "scratch"), { recursive: true });
  writeFileSync(statePath(dir), `${JSON.stringify(snap, null, 2)}\n`, "utf-8");
}

function note(sessionDir: string, sessionId: string, operation: string, snap: GoalHarnessSnapshot): void {
  appendLedgerEvent(sessionDir, sessionId, "harness/change", {
    operation,
    id: snap.id,
    status: snap.status,
    objective: snap.objective,
  });
}

export class GoalHarnessService {
  /** 本进程创建或 resume 过的 id；重启后为空，用来把落盘 Active 收成暂停。 */
  private readonly liveIds = new Set<string>();

  get(sessionDir: string, sessionId: string): GoalHarnessSnapshot | undefined {
    return this.read(sessionDir, sessionId);
  }

  /** 未完成即视为占用（与 /goal 互斥） */
  isOpen(sessionDir: string, sessionId: string): boolean {
    const snap = this.read(sessionDir, sessionId);
    return Boolean(snap && goalHarnessIsOpen(snap.status));
  }

  isActive(sessionDir: string, sessionId: string): boolean {
    return this.read(sessionDir, sessionId)?.status === "active";
  }

  create(
    sessionDir: string,
    sessionId: string,
    objective: string,
    tokenBudget?: number,
  ): GoalHarnessSnapshot {
    const trimmed = objective.trim();
    if (!trimmed) throw new Error("goal objective must be a non-empty string");
    if (tokenBudget !== undefined && (!Number.isSafeInteger(tokenBudget) || tokenBudget < 1)) {
      throw new Error("token budget must be a positive integer");
    }
    const existing = this.read(sessionDir, sessionId);
    if (existing && goalHarnessIsOpen(existing.status)) {
      throw new Error(`a goal is already ${existing.status}`);
    }
    const now = Date.now();
    const snap: GoalHarnessSnapshot = {
      id: `gh-${randomUUID()}`,
      objective: trimmed,
      status: "active",
      phase: "planning",
      ...(tokenBudget ? { tokenBudget } : {}),
      tokensUsed: 0,
      createdAt: now,
      updatedAt: now,
      elapsedMs: 0,
      workerRounds: 0,
      verifyRounds: 0,
      roundsSinceVerify: 0,
      planReady: false,
      evaluatorBlockedStreak: 0,
      classifierAttempts: 0,
      classifierMax: GOAL_HARNESS_CLASSIFIER_MAX,
      stallCount: 0,
      consecutiveNotAchieved: 0,
    };
    const dir = goalHarnessDir(sessionDir, sessionId);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    writeState(dir, snap);
    this.liveIds.add(snap.id);
    note(sessionDir, sessionId, "create", snap);
    return snap;
  }

  markPlanReady(sessionDir: string, sessionId: string): GoalHarnessSnapshot | undefined {
    return this.patch(sessionDir, sessionId, (s) => ({
      ...s,
      planReady: true,
      phase: "executing",
      updatedAt: Date.now(),
    }));
  }

  addTokens(sessionDir: string, sessionId: string, delta: number): GoalHarnessSnapshot | undefined {
    if (!Number.isFinite(delta) || delta <= 0) return this.get(sessionDir, sessionId);
    return this.patch(sessionDir, sessionId, (s) => ({
      ...s,
      tokensUsed: s.tokensUsed + Math.floor(delta),
      updatedAt: Date.now(),
    }));
  }

  budgetExceeded(sessionDir: string, sessionId: string): boolean {
    const s = this.read(sessionDir, sessionId);
    return Boolean(s?.tokenBudget && s.tokensUsed >= s.tokenBudget);
  }

  markBudgetLimited(sessionDir: string, sessionId: string): GoalHarnessSnapshot | undefined {
    const next = this.patch(sessionDir, sessionId, (s) => ({
      ...s,
      status: "budget_limited" as const,
      phase: "idle" as const,
      updatedAt: Date.now(),
      pauseMessage: undefined,
    }));
    if (next) note(sessionDir, sessionId, "budget_limit", next);
    return next;
  }

  incrementWorkerRound(sessionDir: string, sessionId: string): GoalHarnessSnapshot | undefined {
    return this.patch(sessionDir, sessionId, (s) => ({
      ...s,
      workerRounds: s.workerRounds + 1,
      roundsSinceVerify: s.roundsSinceVerify + 1,
      updatedAt: Date.now(),
    }));
  }

  recordEvaluatorBlocker(sessionDir: string, sessionId: string, key: string): number {
    let streak = 0;
    this.patch(sessionDir, sessionId, (s) => {
      const same = s.evaluatorBlockerKey === key;
      streak = same ? s.evaluatorBlockedStreak + 1 : 1;
      return {
        ...s,
        evaluatorBlockerKey: key,
        evaluatorBlockedStreak: streak,
        updatedAt: Date.now(),
      };
    });
    return streak;
  }

  resetEvaluatorBlocker(sessionDir: string, sessionId: string): void {
    this.patch(sessionDir, sessionId, (s) => ({
      ...s,
      evaluatorBlockerKey: undefined,
      evaluatorBlockedStreak: 0,
      updatedAt: Date.now(),
    }));
  }

  beginVerify(sessionDir: string, sessionId: string): number | undefined {
    let attempt: number | undefined;
    this.patch(sessionDir, sessionId, (s) => {
      attempt = s.classifierAttempts + 1;
      return {
        ...s,
        classifierAttempts: attempt,
        verifyRounds: s.verifyRounds + 1,
        roundsSinceVerify: 0,
        updatedAt: Date.now(),
      };
    });
    return attempt;
  }

  rollbackVerifyAttempt(sessionDir: string, sessionId: string): void {
    this.patch(sessionDir, sessionId, (s) => ({
      ...s,
      classifierAttempts: Math.max(0, s.classifierAttempts - 1),
      updatedAt: Date.now(),
    }));
  }

  recordNotAchieved(
    sessionDir: string,
    sessionId: string,
    gaps: string,
    fingerprint: string,
  ): { stalled: boolean; consecutive: number } {
    let stalled = false;
    let consecutive = 0;
    this.patch(sessionDir, sessionId, (s) => {
      const same = s.lastGapFingerprint === fingerprint && fingerprint.length > 0;
      const stallCount = same ? s.stallCount + 1 : 1;
      stalled = Boolean(fingerprint) && stallCount >= GOAL_HARNESS_STALL_THRESHOLD;
      consecutive = s.consecutiveNotAchieved + 1;
      return {
        ...s,
        lastGaps: gaps || undefined,
        lastGapFingerprint: fingerprint || s.lastGapFingerprint,
        stallCount,
        consecutiveNotAchieved: consecutive,
        updatedAt: Date.now(),
      };
    });
    return { stalled, consecutive };
  }

  setStrategy(sessionDir: string, sessionId: string, noteText: string): void {
    this.patch(sessionDir, sessionId, (s) => ({
      ...s,
      lastStrategy: noteText.trim() || undefined,
      updatedAt: Date.now(),
    }));
  }

  consumeStrategy(sessionDir: string, sessionId: string): void {
    this.patch(sessionDir, sessionId, (s) => ({
      ...s,
      lastStrategy: undefined,
      updatedAt: Date.now(),
    }));
  }

  pause(
    sessionDir: string,
    sessionId: string,
    reason: GoalHarnessPauseReason,
    message?: string,
  ): GoalHarnessSnapshot | undefined {
    const current = this.read(sessionDir, sessionId);
    if (!current || current.status !== "active") return current;
    const next = this.patch(sessionDir, sessionId, (s) => ({
      ...s,
      status: pauseReasonToStatus(reason),
      phase: "idle" as const,
      pauseMessage: message?.trim() || undefined,
      updatedAt: Date.now(),
    }));
    if (next) note(sessionDir, sessionId, `pause:${reason}`, next);
    return next;
  }

  resume(sessionDir: string, sessionId: string): GoalHarnessSnapshot | undefined {
    const current = this.read(sessionDir, sessionId);
    if (!current) return undefined;
    if (current.status === "complete" || current.status === "budget_limited") return current;
    if (current.status === "active") return current;
    const next = this.patch(sessionDir, sessionId, (s) => ({
      ...s,
      status: "active" as const,
      phase: s.planReady ? ("executing" as const) : ("planning" as const),
      pauseMessage: undefined,
      classifierAttempts: 0,
      roundsSinceVerify: 0,
      stallCount: 0,
      lastGapFingerprint: undefined,
      consecutiveNotAchieved: 0,
      lastStrategy: undefined,
      evaluatorBlockerKey: undefined,
      evaluatorBlockedStreak: 0,
      updatedAt: Date.now(),
    }));
    if (next) {
      this.liveIds.add(next.id);
      note(sessionDir, sessionId, "resume", next);
    }
    return next;
  }

  complete(sessionDir: string, sessionId: string): GoalHarnessSnapshot | undefined {
    const current = this.read(sessionDir, sessionId);
    if (!current) return undefined;
    if (current.status !== "active" && !goalHarnessIsPaused(current.status)) return current;
    const next = this.patch(sessionDir, sessionId, (s) => ({
      ...s,
      status: "complete" as const,
      phase: "idle" as const,
      lastGaps: undefined,
      lastStrategy: undefined,
      pauseMessage: undefined,
      consecutiveNotAchieved: 0,
      updatedAt: Date.now(),
    }));
    if (next) note(sessionDir, sessionId, "complete", next);
    return next;
  }

  clear(sessionDir: string, sessionId: string): boolean {
    const dir = goalHarnessDir(sessionDir, sessionId);
    const current = this.read(sessionDir, sessionId);
    if (!existsSync(dir) && !current) return false;
    if (current) this.liveIds.delete(current.id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    appendLedgerEvent(sessionDir, sessionId, "harness/change", {
      operation: "clear",
      id: current?.id,
    });
    return true;
  }

  /** 测试用 */
  resetForTests(): void {
    this.liveIds.clear();
  }

  private read(sessionDir: string, sessionId: string): GoalHarnessSnapshot | undefined {
    const file = statePath(goalHarnessDir(sessionDir, sessionId));
    if (!existsSync(file)) return undefined;
    try {
      const snap = decodeSnapshot(JSON.parse(readFileSync(file, "utf-8")));
      if (!snap) return undefined;
      if (snap.status === "active" && !this.liveIds.has(snap.id)) {
        const paused: GoalHarnessSnapshot = {
          ...snap,
          status: "user_paused",
          phase: "idle",
          pauseMessage: snap.pauseMessage ?? "restored after process restart",
          updatedAt: Date.now(),
        };
        writeState(goalHarnessDir(sessionDir, sessionId), paused);
        note(sessionDir, sessionId, "reconcile_pause", paused);
        return paused;
      }
      return snap;
    } catch {
      return undefined;
    }
  }

  private patch(
    sessionDir: string,
    sessionId: string,
    fn: (snap: GoalHarnessSnapshot) => GoalHarnessSnapshot,
  ): GoalHarnessSnapshot | undefined {
    const current = this.read(sessionDir, sessionId);
    if (!current) return undefined;
    const next = fn(current);
    writeState(goalHarnessDir(sessionDir, sessionId), next);
    return next;
  }
}

export const goalHarness = new GoalHarnessService();

export function gapFingerprint(parts: readonly string[]): string {
  const norm = parts
    .map((p) => p.trim().toLowerCase().replace(/\s+/g, " "))
    .filter(Boolean)
    .sort()
    .join("|");
  if (!norm) return "";
  return createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

export function firstUncheckedPlanItem(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  let inChecklist = false;
  let checklistLevel = 0;
  const hasChecklist = lines.some((l) => /^#{1,6}\s+task checklist\s*$/i.test(l.trim()));
  let skip = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const header = line.match(/^(#{1,6})\s+(.*)$/);
    if (header) {
      const title = header[2].trim();
      const level = header[1].length;
      if (title.toLowerCase() === "task checklist") {
        inChecklist = true;
        checklistLevel = level;
        skip = false;
        continue;
      }
      if (inChecklist && level <= checklistLevel) return undefined;
      skip = /^(non-goals|deviations)$/i.test(title);
      if (!hasChecklist) inChecklist = false;
      continue;
    }
    if (hasChecklist && !inChecklist) continue;
    if (skip) continue;
    const item = line.trim().match(/^[-*+]\s+\[\s\]\s+(.+)$/);
    if (item?.[1]) return item[1].trim();
  }
  return undefined;
}

export function renderPlanMarkdown(plan: {
  headline: string;
  kind: string;
  criteria: string[];
  verification: { tag: string; step: string }[];
  nonGoals: string[];
  assumedScope: string;
  approach?: string;
  checklist?: string[];
  risks?: string[];
}): string {
  const lines = [
    `# Plan: ${plan.headline.trim()}`,
    "",
    "## Goal kind",
    plan.kind,
    "",
    "## Acceptance criteria",
    ...plan.criteria.map((c, i) => `${i + 1}. ${c}`),
    "",
    "## Verification plan",
    ...plan.verification.map((v, i) => `${i + 1}. ${v.tag}: ${v.step}`),
    "",
    "## Non-goals",
    ...(plan.nonGoals.length ? plan.nonGoals.map((n) => `- ${n}`) : ["- none stated"]),
    "",
    "## Assumed scope",
    plan.assumedScope.trim() || "(unspecified)",
  ];
  if (plan.kind === "code-change") {
    lines.push("", "## Implementation approach", (plan.approach ?? "").trim() || "(none)", "", "## Task checklist");
    const checks = plan.checklist?.length ? plan.checklist : ["Inspect the current workspace", "Implement the change", "Capture verification evidence"];
    for (const c of checks) lines.push(`- [ ] ${c}`);
  }
  if (plan.risks?.length) {
    lines.push("", "## Risks / Contradictions", ...plan.risks.map((r) => `- ${r}`));
  }
  return `${lines.join("\n")}\n`;
}

export function renderWorkerRules(objective: string, planFile: string, scratchDir: string): string {
  return (
    `<system-reminder>\n` +
    `A goal has been set: ${objective}\n\n` +
    `You are working directly on this goal across multiple turns. Deliver everything the user asked for yourself.\n\n` +
    `A structured plan is on disk — the source of truth for "done". Read it first.\n` +
    `Plan: ${planFile}\n\n` +
    `- Work the task checklist in order and flip each \`- [ ]\` to \`- [x]\` as you finish it.\n` +
    `- Tests must drive the shipped code on the real path. Do not hard-code expected values or start past the unit under test.\n` +
    `- Save captured run output under ${scratchDir}. The host audits this evidence instead of rebuilding it.\n` +
    `- Do not stop merely to announce completion. The host evaluates after every model round and continues with concrete gaps.\n` +
    `</system-reminder>\n\nStart now.\n`
  );
}

export function renderContinuation(input: {
  objective: string;
  tokens: number;
  nextStep: string;
  gaps?: string;
  strategy?: string;
  scratchDir: string;
  reverify?: string;
}): string {
  const gaps = input.gaps
    ? `Verification rejected the prior completion candidate. Fix every gap below before claiming completion again:\n${input.gaps}\n\n`
    : "";
  const strategy = input.strategy
    ? `A structural change of approach is recommended (advisory; it does not change the acceptance criteria):\n${input.strategy}\n\n`
    : "";
  return (
    `<system-reminder>\n` +
    `<goal-state>\n` +
    `Objective: ${input.objective}\n` +
    `Status: Active\n` +
    `Tokens: ${input.tokens}\n` +
    `</goal-state>\n\n` +
    `${gaps}${strategy}${input.reverify ?? ""}` +
    `Goal NOT complete — continue working. Next step:\n${input.nextStep}\n\n` +
    `Keep a current todo list. Run targeted tests after every change. Use scratch ${input.scratchDir} only for captured output.\n` +
    `The host evaluates completion automatically after this round.\n` +
    `</system-reminder>`
  );
}
