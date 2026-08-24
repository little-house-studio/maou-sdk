/**
 * /ultragoal 宿主侧：写计划、暗厢评审、验审、续跑指令。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  firstUncheckedPlanItem,
  gapFingerprint,
  goalHarness,
  planBaselinePath,
  planPath,
  renderContinuation,
  renderPlanMarkdown,
  renderWorkerRules,
  scratchPath,
} from "@little-house-studio/context";
import {
  GOAL_HARNESS_BLOCKED_STREAK,
  GOAL_HARNESS_REVERIFY_AFTER,
  GOAL_HARNESS_STRATEGIST_EVERY,
} from "@little-house-studio/types";

export type HarnessAux = {
  callJson(
    params: {
      preset: unknown;
      systemPrompt: string;
      userPrompt: string;
      abortSignal?: AbortSignal;
      context?: { sessionId?: string; tag?: string };
    },
    fallback?: unknown,
  ): Promise<{ ok: boolean; json: Record<string, unknown> | null; content: string; error?: string }>;
  callText(
    params: {
      preset: unknown;
      systemPrompt: string;
      userPrompt: string;
      abortSignal?: AbortSignal;
      context?: { sessionId?: string; tag?: string };
    },
    fallback?: unknown,
  ): Promise<{ ok: boolean; content: string; error?: string }>;
};

export type HarnessRoundDecision =
  | { action: "continue"; directive: string }
  | { action: "complete"; summary: string }
  | { action: "pause"; message: string }
  | { action: "end" };

const PLANNER_SYSTEM = `You write a short completion contract for a coding goal.
Return one JSON object only:
{"headline":"one sentence","kind":"code-change|analysis|research","criteria":["observable outcome"],"verification":[{"tag":"gating|evidence","step":"action + required observation"}],"nonGoals":["out of scope"],"assumedScope":"files or modules","approach":"optional how","checklist":["optional concrete step"],"risks":["optional"]}
Rules: freeze observable outcomes, never file/class names or architecture. Keep 3-5 gating criteria. Do not invent unrequested scope.`;

const EVALUATOR_SYSTEM = `You are the hidden completion evaluator for an autonomous coding goal. You are not the coding agent.
Return one JSON object only:
{"decision":"continue|candidate_complete|blocked","evidence":"...","next_step":"...","blocker_key":""}
- continue: meaningful work remains. blocker_key must be empty.
- candidate_complete: the deliverable appears complete enough for adversarial review. blocker_key must be empty.
- blocked: progress needs a user action or missing external prerequisite. blocker_key is stable lowercase snake_case.
Be conservative. A confident-sounding final response is not proof. Pending tasks, missing verification, or described-but-untested work require continue.`;

const VERIFIER_SYSTEM = `You are an adversarial verifier. Your job is to refute that the objective has been met. Default to refuted=true if uncertain.
AUDIT the supplied evidence; do not invent a parallel test suite.
Return one JSON object only:
{"refuted":true,"findings":[{"kind":"bug|gap|todo","location":"where","detail":"one line"}],"evidence":"one-line citation","confidence":"high|medium|low","blocking":"none|contradiction|unverifiable"}
Refute for unmet criteria, dishonest/missing tests, or weakened plan criteria. Do not invent extra scope. When every gating criterion holds, return refuted=false.`;

const STRATEGIST_SYSTEM = `The implementer is not converging. Diagnose WHY and recommend ONE structural change of HOW, never of WHAT.
Return one JSON object only: {"diagnosis":"...","steps":["small mechanical step"],"why":"how this converges"}`;

const SUMMARIZER_SYSTEM = `The goal is already verified complete. Write the closing user message: what was delivered and how to use it. At most 80 words. No preamble.`;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}

export function parsePlannerJson(json: Record<string, unknown> | null): ReturnType<typeof renderPlanMarkdown> | undefined {
  if (!json) return undefined;
  const kindRaw = String(json.kind ?? "code-change").trim();
  const kind = kindRaw === "analysis" || kindRaw === "research" ? kindRaw : "code-change";
  const criteria = asStringArray(json.criteria);
  const verificationRaw = Array.isArray(json.verification) ? json.verification : [];
  const verification = verificationRaw
    .map((row) => {
      if (typeof row !== "object" || row === null) return undefined;
      const rec = row as Record<string, unknown>;
      const step = String(rec.step ?? "").trim();
      if (!step) return undefined;
      const tag = String(rec.tag ?? "gating").trim() === "evidence" ? "evidence" : "gating";
      return { tag, step };
    })
    .filter((v): v is { tag: string; step: string } => Boolean(v));
  if (criteria.length === 0 || verification.length === 0) return undefined;
  return renderPlanMarkdown({
    headline: String(json.headline ?? "Goal").trim() || "Goal",
    kind,
    criteria,
    verification,
    nonGoals: asStringArray(json.nonGoals),
    assumedScope: String(json.assumedScope ?? "").trim(),
    approach: String(json.approach ?? "").trim() || undefined,
    checklist: asStringArray(json.checklist),
    risks: asStringArray(json.risks),
  });
}

export function parseEvaluatorJson(json: Record<string, unknown> | null): {
  decision: "continue" | "candidate_complete" | "blocked";
  evidence: string;
  nextStep: string;
  blockerKey: string;
} | undefined {
  if (!json) return undefined;
  const decision = String(json.decision ?? "");
  const evidence = String(json.evidence ?? "").trim();
  const nextStep = String(json.next_step ?? json.nextStep ?? "").trim();
  const blockerKey = String(json.blocker_key ?? json.blockerKey ?? "").trim();
  if (!evidence || !nextStep) return undefined;
  if (decision === "blocked") {
    if (!blockerKey || !/^[a-z][a-z0-9_]*$/.test(blockerKey)) return undefined;
    return { decision, evidence, nextStep, blockerKey };
  }
  if (decision === "continue" || decision === "candidate_complete") {
    if (blockerKey) return undefined;
    return { decision, evidence, nextStep, blockerKey: "" };
  }
  return undefined;
}

export type VerifierFinding = { kind: string; location: string; detail: string };

export function parseVerifierJson(json: Record<string, unknown> | null): {
  refuted: boolean;
  findings: VerifierFinding[];
  evidence: string;
  confidence: "high" | "medium" | "low";
  blocking: "none" | "contradiction" | "unverifiable";
} | undefined {
  if (!json) return undefined;
  const refuted = json.refuted !== false;
  const findings = Array.isArray(json.findings)
    ? json.findings.flatMap((row) => {
        if (typeof row !== "object" || row === null) return [];
        const rec = row as Record<string, unknown>;
        const detail = String(rec.detail ?? "").trim();
        if (!detail) return [];
        return [{
          kind: String(rec.kind ?? "gap"),
          location: String(rec.location ?? ""),
          detail,
        }];
      })
    : [];
  const confidenceRaw = String(json.confidence ?? "medium");
  const confidence = confidenceRaw === "high" || confidenceRaw === "low" ? confidenceRaw : "medium";
  const blockingRaw = String(json.blocking ?? "none");
  const blocking =
    blockingRaw === "contradiction" || blockingRaw === "unverifiable" ? blockingRaw : "none";
  return {
    refuted,
    findings,
    evidence: String(json.evidence ?? "").trim(),
    confidence,
    blocking,
  };
}

export function aggregateVerifiers(
  panel: readonly NonNullable<ReturnType<typeof parseVerifierJson>>[],
): { achieved: boolean; blocked: boolean; gaps: string; fingerprint: string } {
  if (panel.length === 0) {
    return { achieved: false, blocked: false, gaps: "no verifier verdict", fingerprint: "empty" };
  }
  const decisive = panel[0] && panel[0].refuted && panel[0].confidence === "high";
  const notRefuted = panel.filter((p) => !p.refuted).length;
  const needed = panel.length <= 1 ? 1 : Math.floor((panel.length - (panel.length > 1 ? 1 : 0)) / 2) + 1;
  const coldNotRefuted = panel.length <= 1
    ? notRefuted
    : panel.filter((p, i) => i >= 1 && !p.refuted).length;
  const quorum = panel.length <= 1 ? notRefuted >= needed : coldNotRefuted >= needed;
  const achieved = quorum && !decisive;
  const refuters = panel.filter((p) => p.refuted);
  const blocked = refuters.length > 0 && refuters.every((p) => p.blocking !== "none");
  const gaps = refuters
    .flatMap((p) => p.findings.map((f) => `- ${f.kind} @ ${f.location || "?"}: ${f.detail}`))
    .join("\n") || (achieved ? "" : "refuted with no structured findings");
  const fingerprint = gapFingerprint(refuters.flatMap((p) => p.findings.map((f) => f.detail)));
  return { achieved, blocked, gaps, fingerprint };
}

function readCapped(path: string, max = 16_384): string {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf-8").slice(0, max);
  } catch {
    return "";
  }
}

export function collectGitEvidence(cwd: string): string {
  try {
    const stat = execFileSync("git", ["diff", "--stat"], {
      cwd,
      timeout: 8000,
      maxBuffer: 64_000,
      encoding: "utf8",
    });
    const diff = execFileSync("git", ["diff"], {
      cwd,
      timeout: 8000,
      maxBuffer: 64_000,
      encoding: "utf8",
    });
    return `${stat}\n${diff}`.trim().slice(0, 16_000) || "(clean worktree)";
  } catch {
    return "(no git diff available)";
  }
}

export async function planHarnessGoal(input: {
  sessionDir: string;
  sessionId: string;
  aux?: HarnessAux;
  preset: unknown;
  fallbackPreset?: unknown;
  abortSignal?: AbortSignal;
}): Promise<{ ok: true; prompt: string } | { ok: false; message: string }> {
  const snap = goalHarness.get(input.sessionDir, input.sessionId);
  if (!snap || snap.status !== "active") return { ok: false, message: "goal is not active" };
  if (snap.planReady && existsSync(planPath(input.sessionDir, input.sessionId))) {
    return {
      ok: true,
      prompt: renderWorkerRules(
        snap.objective,
        planPath(input.sessionDir, input.sessionId),
        scratchPath(input.sessionDir, input.sessionId),
      ),
    };
  }
  if (!input.aux) {
    goalHarness.pause(input.sessionDir, input.sessionId, "infra", "Planning failed; resume with /ultragoal to retry.");
    return { ok: false, message: "Planning failed; resume with /ultragoal to retry." };
  }
  const result = await input.aux.callJson(
    {
      preset: input.preset,
      systemPrompt: PLANNER_SYSTEM,
      userPrompt: `OBJECTIVE:\n${snap.objective}\n`,
      abortSignal: input.abortSignal,
      context: { sessionId: input.sessionId, tag: "goal_planner" },
    },
    input.fallbackPreset,
  );
  const markdown = parsePlannerJson(result.json);
  if (!result.ok || !markdown) {
    goalHarness.pause(input.sessionDir, input.sessionId, "infra", "Planning failed; resume with /ultragoal to retry.");
    return { ok: false, message: "Planning failed; resume with /ultragoal to retry." };
  }
  const planFile = planPath(input.sessionDir, input.sessionId);
  const baseline = planBaselinePath(input.sessionDir, input.sessionId);
  writeFileSync(planFile, markdown, "utf-8");
  writeFileSync(baseline, markdown, "utf-8");
  goalHarness.markPlanReady(input.sessionDir, input.sessionId);
  return {
    ok: true,
    prompt: renderWorkerRules(snap.objective, planFile, scratchPath(input.sessionDir, input.sessionId)),
  };
}

function buildDirective(
  sessionDir: string,
  sessionId: string,
  nextStep: string,
): string {
  const snap = goalHarness.get(sessionDir, sessionId);
  if (!snap) return nextStep;
  const plan = readCapped(planPath(sessionDir, sessionId));
  const mined = firstUncheckedPlanItem(plan);
  const reverify =
    snap.consecutiveNotAchieved >= 1 && snap.roundsSinceVerify >= GOAL_HARNESS_REVERIFY_AFTER
      ? `Re-run the verification plan before continuing. You have run ${snap.roundsSinceVerify} rounds since the last rejection.\n\n`
      : "";
  return renderContinuation({
    objective: snap.objective,
    tokens: snap.tokensUsed,
    nextStep: mined || nextStep,
    gaps: snap.lastGaps,
    strategy: snap.lastStrategy,
    scratchDir: scratchPath(sessionDir, sessionId),
    reverify,
  });
}

export async function decideHarnessRound(input: {
  sessionDir: string;
  sessionId: string;
  lastAssistant: string;
  tokensDelta: number;
  cwd: string;
  aux?: HarnessAux;
  preset: unknown;
  fallbackPreset?: unknown;
  abortSignal?: AbortSignal;
  queuedUser: boolean;
}): Promise<HarnessRoundDecision> {
  const sessionDir = input.sessionDir;
  const sessionId = input.sessionId;
  if (input.tokensDelta > 0) goalHarness.addTokens(sessionDir, sessionId, input.tokensDelta);
  if (goalHarness.budgetExceeded(sessionDir, sessionId)) {
    const limited = goalHarness.markBudgetLimited(sessionDir, sessionId);
    return { action: "pause", message: limited ? "Goal token budget exhausted." : "Goal ended." };
  }
  const snap = goalHarness.get(sessionDir, sessionId);
  if (!snap || snap.status !== "active") return { action: "end" };
  if (input.queuedUser) return { action: "end" };
  goalHarness.incrementWorkerRound(sessionDir, sessionId);

  if (!input.aux) {
    goalHarness.pause(sessionDir, sessionId, "infra", "Goal evaluation is unavailable.");
    return { action: "pause", message: "Goal evaluation is unavailable. Resume with /ultragoal after enabling the helper model." };
  }

  const plan = readCapped(planPath(sessionDir, sessionId));
  const evalResult = await input.aux.callJson(
    {
      preset: input.preset,
      systemPrompt: EVALUATOR_SYSTEM,
      userPrompt: JSON.stringify({
        objective: snap.objective,
        plan: plan || "(no plan available)",
        transcript: input.lastAssistant.slice(0, 12_000),
      }),
      abortSignal: input.abortSignal,
      context: { sessionId, tag: "goal_evaluator" },
    },
    input.fallbackPreset,
  );
  const verdict = parseEvaluatorJson(evalResult.json);
  if (!evalResult.ok || !verdict) {
    goalHarness.pause(
      sessionDir,
      sessionId,
      "infra",
      "Goal evaluation failed after a bounded retry. Use /ultragoal resume to retry.",
    );
    return { action: "pause", message: "Goal evaluation failed. Use /ultragoal resume to retry." };
  }

  if (verdict.decision === "blocked") {
    const streak = goalHarness.recordEvaluatorBlocker(sessionDir, sessionId, verdict.blockerKey);
    if (streak >= GOAL_HARNESS_BLOCKED_STREAK) {
      goalHarness.pause(
        sessionDir,
        sessionId,
        "blocked",
        `${verdict.evidence}\nNext user action: ${verdict.nextStep}`,
      );
      return {
        action: "pause",
        message: `Goal paused — blocked.\nReason: ${verdict.evidence}\n\n${verdict.nextStep}\n\nType /ultragoal resume after addressing it.`,
      };
    }
    return { action: "continue", directive: `${buildDirective(sessionDir, sessionId, verdict.nextStep)}\nEvaluator next step: ${verdict.nextStep}\n` };
  }

  goalHarness.resetEvaluatorBlocker(sessionDir, sessionId);

  if (verdict.decision === "continue") {
    return { action: "continue", directive: `${buildDirective(sessionDir, sessionId, verdict.nextStep)}\nEvaluator next step: ${verdict.nextStep}\n` };
  }

  const attempt = goalHarness.beginVerify(sessionDir, sessionId);
  const live = goalHarness.get(sessionDir, sessionId);
  if (!attempt || !live) return { action: "end" };
  if (attempt > live.classifierMax) {
    goalHarness.rollbackVerifyAttempt(sessionDir, sessionId);
    goalHarness.pause(sessionDir, sessionId, "backoff", `Verification rejected completion ${attempt} times.`);
    return { action: "pause", message: "Goal auto-paused after too many verification attempts. Use /ultragoal resume." };
  }

  const changes = collectGitEvidence(input.cwd);
  const planChanges = (() => {
    const current = readCapped(planPath(sessionDir, sessionId));
    const baseline = readCapped(planBaselinePath(sessionDir, sessionId));
    if (current && baseline && current !== baseline) return "PLAN_CHANGES: the plan file differs from the original baseline.";
    return "PLAN_CHANGES: (none)";
  })();
  const priorGaps = live.lastGaps ?? "(none)";
  const verifyPrompt = [
    `OBJECTIVE: ${snap.objective}`,
    plan ? `PLAN:\n${plan}` : "PLAN: (unavailable)",
    planChanges,
    `CHANGES:\n${changes}`,
    `FINAL_RESPONSE:\n${input.lastAssistant.slice(0, 8000)}`,
    `PRIOR_GAPS:\n${priorGaps}`,
  ].join("\n\n");

  const panel = [];
  for (let i = 0; i < 2; i++) {
    const raw = await input.aux.callJson(
      {
        preset: input.preset,
        systemPrompt: VERIFIER_SYSTEM,
        userPrompt: verifyPrompt,
        abortSignal: input.abortSignal,
        context: { sessionId, tag: `goal_verifier_${i}` },
      },
      input.fallbackPreset,
    );
    const parsed = parseVerifierJson(raw.ok ? raw.json : { refuted: true, findings: [{ kind: "gap", location: "verifier", detail: raw.error || "no verdict" }], evidence: "infra", confidence: "high", blocking: "none" });
    panel.push(parsed ?? {
      refuted: true,
      findings: [{ kind: "gap", location: "verifier", detail: "malformed verdict" }],
      evidence: "malformed",
      confidence: "high" as const,
      blocking: "none" as const,
    });
  }

  const agg = aggregateVerifiers(panel);
  if (agg.achieved) {
    goalHarness.complete(sessionDir, sessionId);
    let summary = "Goal verified complete.";
    const spoken = await input.aux.callText(
      {
        preset: input.preset,
        systemPrompt: SUMMARIZER_SYSTEM,
        userPrompt: `OBJECTIVE: ${snap.objective}\nPLAN:\n${plan}\nFINAL_RESPONSE:\n${input.lastAssistant.slice(0, 4000)}`,
        abortSignal: input.abortSignal,
        context: { sessionId, tag: "goal_summarizer" },
      },
      input.fallbackPreset,
    );
    if (spoken.ok && spoken.content.trim()) summary = spoken.content.trim();
    return { action: "complete", summary };
  }

  if (agg.blocked) {
    goalHarness.rollbackVerifyAttempt(sessionDir, sessionId);
    goalHarness.pause(sessionDir, sessionId, "blocked", agg.gaps);
    return {
      action: "pause",
      message: `Goal verification found no model-fixable path — paused for your decision.\n${agg.gaps}\n\nType /ultragoal resume after addressing it.`,
    };
  }

  const { stalled, consecutive } = goalHarness.recordNotAchieved(sessionDir, sessionId, agg.gaps, agg.fingerprint);
  if (stalled) {
    goalHarness.pause(sessionDir, sessionId, "no_progress", agg.gaps);
    return {
      action: "pause",
      message: `Goal verification flagged the same gaps with no progress — auto-paused.\n${agg.gaps}\n\nType /ultragoal resume to continue.`,
    };
  }
  if (consecutive > 0 && consecutive % GOAL_HARNESS_STRATEGIST_EVERY === 0) {
    const strat = await input.aux.callJson(
      {
        preset: input.preset,
        systemPrompt: STRATEGIST_SYSTEM,
        userPrompt: `OBJECTIVE: ${snap.objective}\nGAPS:\n${agg.gaps}\nPLAN:\n${plan}`,
        abortSignal: input.abortSignal,
        context: { sessionId, tag: "goal_strategist" },
      },
      input.fallbackPreset,
    );
    const diagnosis = String(strat.json?.diagnosis ?? "").trim();
    const steps = asStringArray(strat.json?.steps);
    if (diagnosis) {
      goalHarness.setStrategy(
        sessionDir,
        sessionId,
        [diagnosis, ...steps.map((s) => `- ${s}`)].join("\n"),
      );
    }
  }
  return {
    action: "continue",
    directive: `${buildDirective(sessionDir, sessionId, verdict.nextStep)}\nEvaluator next step: ${verdict.nextStep}\n`,
  };
}
