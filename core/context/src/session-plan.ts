/**
 * 会话计划 sidecar。
 * 目录：`<sessionDir>/<sessionId>/plan/`
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionPlanPort, SessionPlanSnapshot, SessionPlanStatus } from "@little-house-studio/types";
import { appendLedgerEvent } from "./session-ledger.js";

export function sessionPlanDir(sessionDir: string, sessionId: string): string {
  return join(sessionDir, sessionId, "plan");
}

export function sessionPlanFile(sessionDir: string, sessionId: string): string {
  return join(sessionPlanDir(sessionDir, sessionId), "plan.md");
}

function statePath(dir: string): string {
  return join(dir, "state.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const STATUSES = new Set<SessionPlanStatus>(["idle", "planning", "review", "approved"]);

function decodeSnapshot(value: unknown): SessionPlanSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "string" || !value.id) return undefined;
  const status = value.status;
  if (typeof status !== "string" || !STATUSES.has(status as SessionPlanStatus)) return undefined;
  const num = (key: string, fallback = 0): number =>
    typeof value[key] === "number" && Number.isFinite(value[key]) ? (value[key] as number) : fallback;
  return {
    id: value.id,
    objective: typeof value.objective === "string" ? value.objective : "",
    status: status as SessionPlanStatus,
    active: value.active === true,
    planReady: value.planReady === true,
    revision: Math.max(0, num("revision")),
    createdAt: num("createdAt", Date.now()),
    updatedAt: num("updatedAt", Date.now()),
  };
}

function writeState(dir: string, snap: SessionPlanSnapshot): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(dir), `${JSON.stringify(snap, null, 2)}\n`, "utf-8");
}

function note(sessionDir: string, sessionId: string, operation: string, snap: SessionPlanSnapshot): void {
  appendLedgerEvent(sessionDir, sessionId, "plan/change", {
    operation,
    id: snap.id,
    status: snap.status,
    active: snap.active,
    objective: snap.objective,
  });
}

export class SessionPlanService {
  get(sessionDir: string, sessionId: string): SessionPlanSnapshot | undefined {
    return this.read(sessionDir, sessionId);
  }

  isActive(sessionDir: string, sessionId: string): boolean {
    return this.read(sessionDir, sessionId)?.active === true;
  }

  enter(sessionDir: string, sessionId: string, objective?: string): SessionPlanSnapshot {
    const current = this.read(sessionDir, sessionId);
    const now = Date.now();
    const trimmed = objective?.trim() ?? "";
    const snap: SessionPlanSnapshot = {
      id: current?.id ?? `plan-${randomUUID()}`,
      objective: trimmed || current?.objective || "",
      status: "planning",
      active: true,
      planReady: current?.planReady ?? false,
      revision: current?.revision ?? 0,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    writeState(sessionPlanDir(sessionDir, sessionId), snap);
    note(sessionDir, sessionId, "enter", snap);
    return snap;
  }

  writePlan(sessionDir: string, sessionId: string, markdown: string): SessionPlanSnapshot {
    const text = markdown.trim();
    if (!text.startsWith("#")) {
      throw new Error("plan markdown must start with a # heading");
    }
    const current = this.read(sessionDir, sessionId) ?? this.enter(sessionDir, sessionId);
    const dir = sessionPlanDir(sessionDir, sessionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(sessionPlanFile(sessionDir, sessionId), `${text}\n`, "utf-8");
    const snap: SessionPlanSnapshot = {
      ...current,
      active: true,
      planReady: true,
      status: "review",
      revision: current.revision + 1,
      updatedAt: Date.now(),
    };
    writeState(dir, snap);
    note(sessionDir, sessionId, "write", snap);
    return snap;
  }

  readPlan(sessionDir: string, sessionId: string): string | undefined {
    const file = sessionPlanFile(sessionDir, sessionId);
    if (!existsSync(file)) return undefined;
    try {
      return readFileSync(file, "utf-8");
    } catch {
      return undefined;
    }
  }

  approve(sessionDir: string, sessionId: string): SessionPlanSnapshot | undefined {
    const current = this.read(sessionDir, sessionId);
    if (!current) return undefined;
    const snap: SessionPlanSnapshot = {
      ...current,
      active: false,
      status: "approved",
      updatedAt: Date.now(),
    };
    writeState(sessionPlanDir(sessionDir, sessionId), snap);
    note(sessionDir, sessionId, "approve", snap);
    return snap;
  }

  off(sessionDir: string, sessionId: string): SessionPlanSnapshot | undefined {
    const current = this.read(sessionDir, sessionId);
    if (!current) return undefined;
    const snap: SessionPlanSnapshot = {
      ...current,
      active: false,
      status: current.planReady ? current.status : "idle",
      updatedAt: Date.now(),
    };
    writeState(sessionPlanDir(sessionDir, sessionId), snap);
    note(sessionDir, sessionId, "off", snap);
    return snap;
  }

  revise(sessionDir: string, sessionId: string): SessionPlanSnapshot {
    const current = this.read(sessionDir, sessionId) ?? this.enter(sessionDir, sessionId);
    const snap: SessionPlanSnapshot = {
      ...current,
      active: true,
      status: "planning",
      updatedAt: Date.now(),
    };
    writeState(sessionPlanDir(sessionDir, sessionId), snap);
    note(sessionDir, sessionId, "revise", snap);
    return snap;
  }

  clear(sessionDir: string, sessionId: string): boolean {
    const dir = sessionPlanDir(sessionDir, sessionId);
    const current = this.read(sessionDir, sessionId);
    if (!existsSync(dir) && !current) return false;
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    appendLedgerEvent(sessionDir, sessionId, "plan/change", {
      operation: "clear",
      id: current?.id,
    });
    return true;
  }

  private read(sessionDir: string, sessionId: string): SessionPlanSnapshot | undefined {
    const file = statePath(sessionPlanDir(sessionDir, sessionId));
    if (!existsSync(file)) return undefined;
    try {
      return decodeSnapshot(JSON.parse(readFileSync(file, "utf-8")));
    } catch {
      return undefined;
    }
  }
}

export const sessionPlan = new SessionPlanService();

export function bindSessionPlanPort(sessionDir: string, sessionId: string): SessionPlanPort {
  return {
    get: () => sessionPlan.get(sessionDir, sessionId),
    isActive: () => sessionPlan.isActive(sessionDir, sessionId),
    writePlan: (markdown) => sessionPlan.writePlan(sessionDir, sessionId, markdown),
    readPlan: () => sessionPlan.readPlan(sessionDir, sessionId),
    planFile: () => sessionPlanFile(sessionDir, sessionId),
    approve: () => sessionPlan.approve(sessionDir, sessionId),
  };
}

export function renderPlanPolicy(planFile: string, objective?: string): string {
  const goal = objective?.trim()
    ? `Objective: ${objective.trim()}\n`
    : "";
  return (
    `<plan_policy>\n` +
    `You are in plan mode. Investigate first. Do not implement product code.\n` +
    goal +
    `Only the session plan file may be written: ${planFile}\n` +
    `Read the workspace, settle every decision, then write a complete markdown plan that starts with a # heading.\n` +
    `Required sections: intent, decisions already made, steps, verification, non-goals, risks.\n` +
    `The plan must be decision-complete so another engineer can implement it without asking you what to choose.\n` +
    `When the plan is ready, call submit_plan with the full markdown. Do not ask "should I proceed?"\n` +
    `The user will /plan approve, /plan revise <notes>, or /plan off.\n` +
    `</plan_policy>`
  );
}

export function renderPlanKickoff(objective: string, planFile: string): string {
  return (
    `Draft a decision-complete implementation plan. Do not change product files.\n` +
    `Objective: ${objective}\n` +
    `Write the plan to ${planFile} and call submit_plan when it is ready.\n`
  );
}

export function renderPlanRevise(notes: string, planFile: string): string {
  return (
    `Revise the current plan. Stay in plan mode. Do not implement.\n` +
    `Revision notes: ${notes}\n` +
    `Update ${planFile} and call submit_plan with the full replacement.\n`
  );
}

export function renderPlanImplement(plan: string): string {
  return (
    `The user approved the plan. Implement it now. Do not reopen planning unless the plan is impossible.\n\n` +
    `<approved_plan>\n${plan.trim()}\n</approved_plan>\n`
  );
}
