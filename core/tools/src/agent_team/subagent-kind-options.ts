/**
 * 从磁盘 agent.json 解析 ForkOptions 的 kind 相关字段。
 * agent_message / subagent_delegate / agent_manage 共用，避免三处漂移。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ForkOptions } from "@little-house-studio/types";

const VALID_KINDS = new Set(["fork", "helper", "task", "project"]);

export interface LoadSubagentKindOptionsArgs {
  maouRoot?: string;
  /** 母 agent 名（nested subagents 路径） */
  parentAgentName?: string;
  /** 子 agent / 队友名 */
  name: string;
  /**
   * 找不到 agent.json 时的默认 kind。
   * - subagent_delegate / agent_manage：默认 "task"
   * - 可传 "fork" 等覆盖
   */
  defaultKind?: NonNullable<ForkOptions["kind"]>;
}

/**
 * 候选路径（按优先级）：
 *   1. agents/<parent>/subagents/<name>/
 *   2. agents/<parent>/subagents/.tmp/<name>/
 *   3. agents/<name>/          （peer / 队友）
 *   4. agents/.shared/<name>/
 */
export function candidateAgentJsonPaths(
  maouRoot: string,
  parentAgentName: string,
  name: string,
): string[] {
  return [
    join(maouRoot, "agents", parentAgentName, "subagents", name, "agent.json"),
    join(maouRoot, "agents", parentAgentName, "subagents", ".tmp", name, "agent.json"),
    join(maouRoot, "agents", name, "agent.json"),
    join(maouRoot, "agents", ".shared", name, "agent.json"),
  ];
}

/** 从已解析的 agent.json 对象提取 ForkOptions 片段 */
export function forkOptionsFromAgentJson(
  data: Record<string, unknown>,
  defaultKind: NonNullable<ForkOptions["kind"]> = "task",
): Partial<ForkOptions> {
  const raw = String(data.subagent_kind ?? data.role ?? defaultKind).toLowerCase();
  const kind = (VALID_KINDS.has(raw) ? raw : defaultKind) as NonNullable<ForkOptions["kind"]>;

  const opts: Partial<ForkOptions> = { kind };

  if (typeof data.path === "string" && data.path.trim()) {
    opts.path = data.path.trim();
  }
  if (Array.isArray(data.audit_paths)) {
    opts.auditPaths = data.audit_paths.map(String);
  }
  if (typeof data.tool_preset === "string") {
    opts.toolPreset = data.tool_preset;
  }
  if (typeof data.persist_context === "boolean") {
    opts.persistContext = data.persist_context;
  }
  if (typeof data.enable_loop === "boolean") {
    opts.enableLoop = data.enable_loop;
  }
  if (Array.isArray(data.tools)) {
    opts.tools = data.tools.map(String);
  }
  if (typeof data.permission === "string") {
    opts.permission = data.permission;
  }
  if (typeof data.inherit_full_context === "boolean") {
    opts.inheritFullContext = data.inherit_full_context;
  }
  if (typeof data.round_limit === "number" && data.round_limit > 0) {
    opts.roundLimit = data.round_limit;
  }
  // role 不是四类之一时（explore/reviewer/tester），仍用 tools/round_limit，kind 已回落 task
  return opts;
}

/**
 * 按名加载子 agent / 队友的 kind 策略。
 * 无 maouRoot 或找不到文件 → 返回 { kind: defaultKind }。
 */
export function loadSubagentKindOptions(
  args: LoadSubagentKindOptionsArgs,
): Partial<ForkOptions> {
  const defaultKind = args.defaultKind ?? "task";
  const maouRoot = args.maouRoot?.trim();
  if (!maouRoot) return { kind: defaultKind };

  const parent = (args.parentAgentName || "coding").trim() || "coding";
  const name = args.name.trim();
  if (!name) return { kind: defaultKind };

  for (const p of candidateAgentJsonPaths(maouRoot, parent, name)) {
    if (!existsSync(p)) continue;
    try {
      const data = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
      return forkOptionsFromAgentJson(data, defaultKind);
    } catch {
      /* try next */
    }
  }
  return { kind: defaultKind };
}

/**
 * 从 ToolContext 风格对象加载（delegate / manage 共用）。
 */
export function loadSubagentKindOptionsFromCtx(
  ctx: {
    maouRoot?: string;
    agentName?: string;
    runtimeAgentName?: string;
  },
  subagentName: string,
  defaultKind: NonNullable<ForkOptions["kind"]> = "task",
): Partial<ForkOptions> {
  return loadSubagentKindOptions({
    maouRoot: ctx.maouRoot,
    parentAgentName: ctx.agentName || ctx.runtimeAgentName || "coding",
    name: subagentName,
    defaultKind,
  });
}
