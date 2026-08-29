/**
 * /goal 合同：账本 `goal/change` 为唯一真相；activation 只在进程里。
 * 本模块不调度续跑。
 */

import { randomUUID } from "node:crypto";
import type {
  CreateGoalRequest,
  EditGoalRequest,
  GoalActivation,
  GoalBlockReason,
  GoalMessageSource,
  GoalOperation,
  GoalRef,
  GoalSnapshot,
  GoalToolAuthority,
  GoalView,
  SessionGoalPort,
} from "@little-house-studio/types";
import {
  BLOCKED_AFTER_CONSECUTIVE_ROUNDS,
  DEFAULT_MAX_GOAL_ROUNDS,
  GOAL_CHANGE_VERSION,
  GoalError,
} from "@little-house-studio/types";
import { appendLedgerEvent, readLedgerRecords } from "./session-ledger.js";
import type { SessionLedgerEvent } from "@little-house-studio/types";

export type { GoalView, GoalRef, GoalSnapshot, GoalMessageSource };

interface GoalSnapshotChange {
  kind: "goal/change";
  version: 1;
  operation: Exclude<GoalOperation, "clear">;
  goal: GoalSnapshot;
  roundsStarted: number;
  createdAt: number;
  updatedAt: number;
}

interface GoalClearChange {
  kind: "goal/change";
  version: 1;
  operation: "clear";
  cleared: GoalRef;
  clearedAt: number;
}

export type GoalChangeMeta = GoalSnapshotChange | GoalClearChange;

export interface GoalFoldState {
  goal: GoalSnapshot | undefined;
  roundsStarted: number;
  createdAt: number | undefined;
  updatedAt: number | undefined;
  lastRef: GoalRef | undefined;
  seenGoalIds: Set<string>;
}

interface GoalCache {
  state: GoalFoldState;
  activation: GoalActivation;
  observedSeq: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveObjective(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GoalError("goal objective must be a non-empty string", "GOAL_INVALID_OBJECTIVE");
  }
  return value.trim();
}

function resolveMaxGoalRounds(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new GoalError("maxGoalRounds must be a positive safe integer", "GOAL_INVALID_MAX_ROUNDS");
  }
  return value;
}

function resolveBlockReason(reason: unknown): GoalBlockReason {
  const record = isRecord(reason) ? reason : undefined;
  const code = record?.["code"];
  const message = record?.["message"];
  if (
    typeof code !== "string" ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(code) ||
    typeof message !== "string" ||
    message.trim().length === 0
  ) {
    throw new GoalError(
      "goal block reason requires a lower-kebab-case code and a non-empty message",
      "GOAL_INVALID_BLOCK_REASON",
    );
  }
  return { code, message: message.trim() };
}

function decodeGoalSource(data: Record<string, unknown>): GoalMessageSource | undefined {
  const raw = isRecord(data.goalSource)
    ? data.goalSource
    : isRecord(data.source)
      ? data.source
      : undefined;
  if (!raw || raw.kind !== "goal") return undefined;
  if (
    typeof raw.goalId !== "string" ||
    raw.goalId.length === 0 ||
    !Number.isSafeInteger(raw.revision) ||
    (raw.revision as number) < 1 ||
    !Number.isSafeInteger(raw.round) ||
    (raw.round as number) < 1
  ) {
    throw new Error("goal message source is invalid");
  }
  return {
    kind: "goal",
    goalId: raw.goalId,
    revision: raw.revision as number,
    round: raw.round as number,
  };
}

export function emptyGoalFoldState(): GoalFoldState {
  return {
    goal: undefined,
    roundsStarted: 0,
    createdAt: undefined,
    updatedAt: undefined,
    lastRef: undefined,
    seenGoalIds: new Set(),
  };
}

function decodeSnapshot(value: unknown): GoalSnapshot {
  if (!isRecord(value)) throw new Error("goal change goal must be a record");
  const phase = value.phase;
  if (phase !== "active" && phase !== "paused" && phase !== "blocked" && phase !== "complete") {
    throw new Error("goal change goal.phase is invalid");
  }
  if (typeof value.id !== "string" || !value.id) throw new Error("goal change goal.id must be a non-empty string");
  if (typeof value.objective !== "string" || value.objective.trim().length === 0) {
    throw new Error("goal change goal.objective must be non-empty");
  }
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) {
    throw new Error("goal change goal.revision must be a positive safe integer");
  }
  if (!Number.isSafeInteger(value.maxGoalRounds) || (value.maxGoalRounds as number) < 1) {
    throw new Error("goal change goal.maxGoalRounds must be a positive safe integer");
  }
  return {
    id: value.id,
    revision: value.revision as number,
    objective: value.objective,
    phase,
    maxGoalRounds: value.maxGoalRounds as number,
    ...(phase === "blocked" ? { blockedReason: resolveBlockReason(value.blockedReason) } : {}),
  };
}

export function decodeGoalChange(value: unknown): GoalChangeMeta | undefined {
  if (!isRecord(value) || value.kind !== "goal/change") return undefined;
  if (value.version !== GOAL_CHANGE_VERSION) {
    throw new Error(`unsupported goal change version ${String(value.version)}`);
  }
  if (value.operation === "clear") {
    const cleared = value.cleared;
    if (!isRecord(cleared) || typeof cleared.id !== "string" || !Number.isSafeInteger(cleared.revision)) {
      throw new Error("goal clear tombstone is invalid");
    }
    return {
      kind: "goal/change",
      version: GOAL_CHANGE_VERSION,
      operation: "clear",
      cleared: { id: cleared.id, revision: cleared.revision as number },
      clearedAt: value.clearedAt as number,
    };
  }
  const ops = new Set(["create", "edit", "pause", "resume", "complete", "block"]);
  if (typeof value.operation !== "string" || !ops.has(value.operation)) {
    throw new Error("goal change operation is invalid");
  }
  return {
    kind: "goal/change",
    version: GOAL_CHANGE_VERSION,
    operation: value.operation as Exclude<GoalOperation, "clear">,
    goal: decodeSnapshot(value.goal),
    roundsStarted: value.roundsStarted as number,
    createdAt: value.createdAt as number,
    updatedAt: value.updatedAt as number,
  };
}

export function applyGoalChange(state: GoalFoldState, change: GoalChangeMeta): void {
  if (change.operation === "clear") {
    const current = state.goal;
    if (!current) throw new Error("goal clear requires a current goal");
    if (change.cleared.id !== current.id || change.cleared.revision !== current.revision + 1) {
      throw new Error("goal clear must advance the current goal by one revision");
    }
    state.goal = undefined;
    state.roundsStarted = 0;
    state.createdAt = undefined;
    state.updatedAt = undefined;
    state.lastRef = change.cleared;
    return;
  }
  if (change.operation === "create") {
    if (
      change.goal.revision !== 1 ||
      change.goal.phase !== "active" ||
      change.roundsStarted !== 0 ||
      (state.goal !== undefined && state.goal.phase !== "complete") ||
      state.seenGoalIds.has(change.goal.id)
    ) {
      throw new Error("goal create requires a fresh active revision-one goal with zero rounds");
    }
    state.seenGoalIds.add(change.goal.id);
  } else {
    const current = state.goal;
    if (!current) throw new Error(`goal ${change.operation} requires a current goal`);
    if (change.goal.id !== current.id || change.goal.revision !== current.revision + 1) {
      throw new Error(`goal ${change.operation} must advance the current goal by one revision`);
    }
    if (change.roundsStarted !== state.roundsStarted) {
      throw new Error(`goal ${change.operation} does not preserve the current counters`);
    }
  }
  state.goal = change.goal;
  state.roundsStarted = change.roundsStarted;
  state.createdAt = change.createdAt;
  state.updatedAt = change.updatedAt;
  state.lastRef = { id: change.goal.id, revision: change.goal.revision };
}

export function applyGoalEvent(state: GoalFoldState, event: SessionLedgerEvent): void {
  if (event.type === "goal/change") {
    const change = decodeGoalChange(event.data);
    if (!change) throw new Error(`goal change at seq ${event.seq} has an invalid kind`);
    applyGoalChange(state, change);
    return;
  }
  if (event.type === "user/message" || event.type === "runtime/control") {
    const source = decodeGoalSource(event.data);
    if (!source) return;
    const current = state.goal;
    if (
      !current ||
      current.phase !== "active" ||
      source.goalId !== current.id ||
      source.revision !== current.revision ||
      source.round !== state.roundsStarted + 1 ||
      source.round > current.maxGoalRounds
    ) {
      throw new Error(`goal round at seq ${event.seq} is not the next admitted round of the active goal`);
    }
    state.roundsStarted = source.round;
  }
}

export function foldGoal(events: readonly SessionLedgerEvent[]): GoalFoldState {
  const state = emptyGoalFoldState();
  for (const event of events) applyGoalEvent(state, event);
  return state;
}

function cacheKey(sessionDir: string, sessionId: string): string {
  return `${sessionDir}\0${sessionId}`;
}

function viewOf(cache: GoalCache): GoalView | undefined {
  const goal = cache.state.goal;
  if (!goal || cache.state.createdAt === undefined || cache.state.updatedAt === undefined) return undefined;
  return {
    ...goal,
    roundsStarted: cache.state.roundsStarted,
    createdAt: cache.state.createdAt,
    updatedAt: cache.state.updatedAt,
    activation: cache.activation,
  };
}

function withPhase(current: GoalSnapshot, phase: GoalSnapshot["phase"]): GoalSnapshot {
  return {
    id: current.id,
    revision: current.revision + 1,
    objective: current.objective,
    phase,
    maxGoalRounds: current.maxGoalRounds,
  };
}

export class SessionGoalService {
  private readonly caches = new Map<string, GoalCache>();
  private readonly defaultMaxGoalRounds: number;

  constructor(defaultMaxGoalRounds = DEFAULT_MAX_GOAL_ROUNDS) {
    this.defaultMaxGoalRounds = resolveMaxGoalRounds(defaultMaxGoalRounds);
  }

  /** 测试用 */
  resetForTests(): void {
    this.caches.clear();
  }

  get(sessionDir: string, sessionId: string): GoalView | undefined {
    return viewOf(this.sync(sessionDir, sessionId));
  }

  disarm(sessionDir: string, sessionId: string): GoalView | undefined {
    const cache = this.sync(sessionDir, sessionId);
    cache.activation = "disarmed";
    return viewOf(cache);
  }

  create(sessionDir: string, sessionId: string, request: CreateGoalRequest): GoalView {
    const cache = this.sync(sessionDir, sessionId);
    const current = cache.state.goal;
    if (current && current.phase !== "complete") {
      throw new GoalError(`goal "${current.id}" already exists with phase "${current.phase}"`, "GOAL_ALREADY_EXISTS");
    }
    const now = Date.now();
    const goal: GoalSnapshot = {
      id: `goal-${randomUUID()}`,
      revision: 1,
      objective: resolveObjective(request.objective),
      phase: "active",
      maxGoalRounds: resolveMaxGoalRounds(request.maxGoalRounds ?? this.defaultMaxGoalRounds),
    };
    return this.commitSnapshot(sessionDir, sessionId, cache, "create", goal, 0, now, now, "armed");
  }

  edit(sessionDir: string, sessionId: string, ref: GoalRef, request: EditGoalRequest): GoalView {
    const cache = this.sync(sessionDir, sessionId);
    const current = this.expectCurrent(cache, ref);
    if (request.objective === undefined && request.maxGoalRounds === undefined) {
      throw new GoalError("goal edit requires objective and/or maxGoalRounds", "GOAL_INVALID_EDIT");
    }
    const goal: GoalSnapshot = {
      ...current,
      revision: current.revision + 1,
      ...(request.objective === undefined ? {} : { objective: resolveObjective(request.objective) }),
      ...(request.maxGoalRounds === undefined ? {} : { maxGoalRounds: resolveMaxGoalRounds(request.maxGoalRounds) }),
    };
    return this.commitCurrent(sessionDir, sessionId, cache, "edit", goal, cache.activation);
  }

  pause(sessionDir: string, sessionId: string, ref: GoalRef): GoalView {
    return this.transition(sessionDir, sessionId, ref, "pause", ["active"], "paused", "disarmed");
  }

  resume(sessionDir: string, sessionId: string, ref: GoalRef): GoalView {
    const cache = this.sync(sessionDir, sessionId);
    const current = this.expectCurrent(cache, ref);
    if (current.phase !== "active" && current.phase !== "paused" && current.phase !== "blocked") {
      throw new GoalError(
        `cannot resume goal "${current.id}" from phase "${current.phase}"`,
        "GOAL_INVALID_TRANSITION",
      );
    }
    if (current.phase === "active" && cache.activation === "armed") {
      throw new GoalError(`goal "${current.id}" is already active and armed`, "GOAL_INVALID_TRANSITION");
    }
    if (cache.state.roundsStarted >= current.maxGoalRounds) {
      throw new GoalError(
        `goal "${current.id}" exhausted ${current.maxGoalRounds} goal rounds; increase maxGoalRounds before resuming`,
        "GOAL_INVALID_TRANSITION",
      );
    }
    return this.commitCurrent(sessionDir, sessionId, cache, "resume", withPhase(current, "active"), "armed");
  }

  complete(sessionDir: string, sessionId: string, ref: GoalRef): GoalView {
    return this.transition(
      sessionDir,
      sessionId,
      ref,
      "complete",
      ["active", "paused", "blocked"],
      "complete",
      "disarmed",
    );
  }

  block(
    sessionDir: string,
    sessionId: string,
    ref: GoalRef,
    reason: GoalBlockReason,
    opts?: { skipRoundFloor?: boolean },
  ): GoalView {
    const cache = this.sync(sessionDir, sessionId);
    const current = this.expectCurrent(cache, ref);
    if (current.phase !== "active") {
      throw new GoalError(
        `cannot block goal "${current.id}" from phase "${current.phase}"`,
        "GOAL_INVALID_TRANSITION",
      );
    }
    if (!opts?.skipRoundFloor && cache.state.roundsStarted < BLOCKED_AFTER_CONSECUTIVE_ROUNDS) {
      throw new GoalError(
        `cannot block goal "${current.id}" before ${BLOCKED_AFTER_CONSECUTIVE_ROUNDS} rounds (now ${cache.state.roundsStarted})`,
        "GOAL_BLOCK_TOO_EARLY",
      );
    }
    return this.commitCurrent(
      sessionDir,
      sessionId,
      cache,
      "block",
      { ...withPhase(current, "blocked"), blockedReason: resolveBlockReason(reason) },
      "disarmed",
    );
  }

  clear(sessionDir: string, sessionId: string, ref: GoalRef): GoalRef {
    const cache = this.sync(sessionDir, sessionId);
    const current = this.expectCurrent(cache, ref);
    const tombstone: GoalRef = { id: current.id, revision: current.revision + 1 };
    const updatedAt = cache.state.updatedAt ?? Date.now();
    const change: GoalClearChange = {
      kind: "goal/change",
      version: GOAL_CHANGE_VERSION,
      operation: "clear",
      cleared: tombstone,
      clearedAt: Math.max(Date.now(), updatedAt),
    };
    this.write(sessionDir, sessionId, change);
    cache.activation = "disarmed";
    this.sync(sessionDir, sessionId);
    return tombstone;
  }

  private transition(
    sessionDir: string,
    sessionId: string,
    ref: GoalRef,
    operation: Exclude<GoalOperation, "create" | "edit" | "clear">,
    allowed: readonly GoalSnapshot["phase"][],
    phase: GoalSnapshot["phase"],
    activation: GoalActivation,
  ): GoalView {
    const cache = this.sync(sessionDir, sessionId);
    const current = this.expectCurrent(cache, ref);
    if (!allowed.includes(current.phase)) {
      throw new GoalError(
        `cannot ${operation} goal "${current.id}" from phase "${current.phase}"`,
        "GOAL_INVALID_TRANSITION",
      );
    }
    return this.commitCurrent(sessionDir, sessionId, cache, operation, withPhase(current, phase), activation);
  }

  private expectCurrent(cache: GoalCache, ref: GoalRef): GoalSnapshot {
    const current = cache.state.goal;
    if (!current) throw new GoalError("no current goal", "GOAL_NOT_FOUND");
    if (ref.id !== current.id || ref.revision !== current.revision) {
      throw new GoalError(
        `stale goal ref "${ref.id}" revision ${ref.revision}; current is "${current.id}" revision ${current.revision}`,
        "GOAL_STALE_REVISION",
      );
    }
    return current;
  }

  private sync(sessionDir: string, sessionId: string): GoalCache {
    const key = cacheKey(sessionDir, sessionId);
    let cache = this.caches.get(key);
    const events = readLedgerRecords(sessionDir, sessionId);
    if (!cache) {
      const state = emptyGoalFoldState();
      for (const event of events) applyGoalEvent(state, event);
      cache = { state, activation: "disarmed", observedSeq: events.at(-1)?.seq ?? 0 };
      this.caches.set(key, cache);
      return cache;
    }
    for (const event of events) {
      if (event.seq <= cache.observedSeq) continue;
      applyGoalEvent(cache.state, event);
      if (event.type === "goal/change") {
        /* 外来写入（另一进程）不当成自己的 arm */
      }
      cache.observedSeq = event.seq;
    }
    return cache;
  }

  private commitCurrent(
    sessionDir: string,
    sessionId: string,
    cache: GoalCache,
    operation: Exclude<GoalOperation, "create" | "clear">,
    goal: GoalSnapshot,
    activation: GoalActivation,
  ): GoalView {
    const createdAt = cache.state.createdAt;
    if (createdAt === undefined) throw new Error("current goal cache lacks createdAt");
    return this.commitSnapshot(
      sessionDir,
      sessionId,
      cache,
      operation,
      goal,
      cache.state.roundsStarted,
      createdAt,
      Math.max(Date.now(), cache.state.updatedAt ?? 0),
      activation,
    );
  }

  private commitSnapshot(
    sessionDir: string,
    sessionId: string,
    cache: GoalCache,
    operation: Exclude<GoalOperation, "clear">,
    goal: GoalSnapshot,
    roundsStarted: number,
    createdAt: number,
    updatedAt: number,
    activation: GoalActivation,
  ): GoalView {
    const change: GoalSnapshotChange = {
      kind: "goal/change",
      version: GOAL_CHANGE_VERSION,
      operation,
      goal,
      roundsStarted,
      createdAt,
      updatedAt,
    };
    this.write(sessionDir, sessionId, change);
    cache.activation = activation;
    this.sync(sessionDir, sessionId);
    const view = viewOf(cache);
    if (!view) throw new Error("snapshot commit cleared the goal unexpectedly");
    cache.activation = activation;
    return view;
  }

  private write(sessionDir: string, sessionId: string, change: GoalChangeMeta): void {
    const result = appendLedgerEvent(sessionDir, sessionId, "goal/change", change as unknown as Record<string, unknown>);
    if ("error" in result) throw new Error(result.error);
  }
}

export const sessionGoals = new SessionGoalService();

export function bindSessionGoalPort(
  sessionDir: string,
  sessionId: string,
  extras?: { isRootAgent?: boolean; authority?: GoalToolAuthority },
): SessionGoalPort {
  return {
    get: () => sessionGoals.get(sessionDir, sessionId),
    create: (request) => sessionGoals.create(sessionDir, sessionId, request),
    edit: (ref, request) => sessionGoals.edit(sessionDir, sessionId, ref, request),
    pause: (ref) => sessionGoals.pause(sessionDir, sessionId, ref),
    resume: (ref) => sessionGoals.resume(sessionDir, sessionId, ref),
    complete: (ref) => sessionGoals.complete(sessionDir, sessionId, ref),
    block: (ref, reason) => sessionGoals.block(sessionDir, sessionId, ref, reason),
    clear: (ref) => sessionGoals.clear(sessionDir, sessionId, ref),
    disarm: () => sessionGoals.disarm(sessionDir, sessionId),
    isRootAgent: extras?.isRootAgent ?? true,
    authority: extras?.authority ?? { kind: "none" },
  };
}

export function renderGoalRoundPrompt(
  goal: GoalView,
  round: number,
  extras?: {
    progressPercent?: number;
    kind?: "continue" | "summary" | "forced-close";
  },
): string {
  const heading =
    "<goal_round>\n" +
    "你当前处于 goal 目标模式。\n" +
    `目标：${JSON.stringify(goal.objective)}\n` +
    `轮次：${round}/${goal.maxGoalRounds}\n`;
  if (extras?.kind === "summary") {
    return (
      heading +
      "工作循环已经结束。请列点总结刚刚做了哪些事情，以及最后的结果。不要再展开新工作。\n" +
      "</goal_round>"
    );
  }
  if (extras?.kind === "forced-close") {
    return (
      heading +
      "请直接收尾：列点总结已经完成的工作和最后结果。不要再展开新工作。\n" +
      "</goal_round>"
    );
  }
  const progressLine =
    extras?.progressPercent !== undefined
      ? `当前进度为 ${extras.progressPercent}%。继续完成目标。\n`
      : "继续完成目标。\n";
  return (
    heading +
    progressLine +
    "以当前工作区、工具结果和会话状态为准，不要假设先前叙述仍成立。" +
    "做出可验证的进展。" +
    "本轮工作结束后，用 <task_completion>数字%</task_completion> 汇报整体完成度；" +
    "若已反复尝试仍无法完成、必须放弃，则输出 <task_completion>failed</task_completion>。\n" +
    "</goal_round>"
  );
}

export function renderGoalWrapup(objective: string, blockedReason?: string): string {
  const heading = `Objective: ${JSON.stringify(objective)}\n`;
  const grounding =
    "Report only what earlier rounds and tool results in this session actually establish; " +
    "when a detail is not in the session, say so instead of inventing it. ";
  if (blockedReason === undefined) {
    return (
      "<goal_complete>\n" +
      heading +
      "The goal is marked complete and this autonomous run is ending. Write the closing " +
      "message to the user now: state the outcome, summarize what was done and how it was " +
      "verified, and point to the concrete results (files, commits, or other artifacts). " +
      grounding +
      "Note anything the user should review or do next. Address the user directly. Do not " +
      "call any more tools in this run; further work waits for the user's next instruction.\n" +
      "</goal_complete>"
    );
  }
  return (
    "<goal_blocked>\n" +
    heading +
    `Blocked: ${JSON.stringify(blockedReason)}\n` +
    "The goal is marked blocked and this autonomous run is ending. Write the closing " +
    "message to the user now: state what has been completed so far, describe the concrete " +
    "blocking condition and what you tried, and say exactly what you need from the user to " +
    "continue. " +
    grounding +
    "Address the user directly. Do not call any more tools in this run; further work " +
    "waits for the user's next instruction.\n" +
    "</goal_blocked>"
  );
}

export function renderGoalToolGuidance(blockedAfter = 3): string {
  return (
    "Use goal tools for one long-running completion objective in the current session. " +
    "create_goal may infer goal intent from a direct human request in any language; do not " +
    "create a goal for routine single-turn work. Call get_goal before update_goal and copy its " +
    "exact goal_id and revision. After session resume or fork, an active goal is disarmed: when " +
    "a human asks to continue or resume in any wording or language, use update_goal action " +
    "resume to rearm it. During a goal-mode round, report progress with " +
    "<task_completion>N%</task_completion> or <task_completion>failed</task_completion> " +
    "instead of update_goal complete/blocked. Mark blocked from a direct human turn only after " +
    `the same blocking condition persists for at least ${blockedAfter} consecutive goal rounds, ` +
    "and report that concrete condition in blocked_reason; difficulty, uncertainty, " +
    "or useful remaining work is not blocked."
  );
}
