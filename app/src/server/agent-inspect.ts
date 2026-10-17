/**
 * 当前 Agent 只读快照：预览编译 + agent.json 已有字段。
 * 不另写提示词逻辑；preview / resolve 都走 @little-house-studio/agent。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  AgentRegistry,
  parseAgentSwitchId,
  previewAgentSystemPrompt,
  readAgentWorkspaceInstructions,
  resolveAgentConfig,
  resolveWorkspaceForSwitch,
} from "@little-house-studio/agent";

export type AgentInspectParams = {
  name?: string;
  displayName?: string;
  role?: string;
  scope?: string;
  roundLimit?: number;
  maxRetries?: number;
  terminalMode?: string;
  toolCompression?: string;
  thinkingContextMode?: string;
  thinkingLevel?: string;
  workspaceInstructions?: boolean;
  mcpToolStrategy?: string;
  workingDir?: string;
  tools?: string[];
};

export type AgentInspectSnapshot = {
  switchId: string;
  agentName: string;
  projectRoot: string;
  promptRoot: string;
  entrypoint: string;
  params: AgentInspectParams;
  prompt: {
    ok: boolean;
    text: string;
    charCount: number;
    lineCount: number;
    error?: string;
  };
};

export type InspectCurrentSlot = {
  agentName: string;
  projectRoot: string;
  switchId: string;
};

function asStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** 从 resolveAgentConfig 结果挑运行时已认识的键，不补默认值。 */
export function pickAgentInspectParams(config: Record<string, unknown>): AgentInspectParams {
  const tools = Array.isArray(config.tools)
    ? config.tools.filter((t): t is string => typeof t === "string")
    : undefined;
  const workspace = readAgentWorkspaceInstructions(config);
  return {
    name: asStr(config.name),
    displayName: asStr(config.display_name) ?? asStr(config.displayName),
    role: asStr(config.role),
    scope: asStr(config.scope),
    roundLimit: asNum(config.round_limit) ?? asNum(config.roundLimit),
    maxRetries: asNum(config.max_retries) ?? asNum(config.maxRetries),
    terminalMode: asStr(config.terminal_mode) ?? asStr(config.terminalMode),
    toolCompression: asStr(config.tool_compression) ?? asStr(config.toolCompression),
    thinkingContextMode: asStr(config.thinking_context_mode) ?? asStr(config.thinkingContextMode),
    thinkingLevel: asStr(config.thinking_level) ?? asStr(config.thinkingLevel),
    workspaceInstructions: workspace ?? undefined,
    mcpToolStrategy: asStr(config.mcp_tool_strategy) ?? asStr(config.mcpToolStrategy),
    workingDir: asStr(config.working_dir) ?? asStr(config.workingDir),
    tools: tools?.length ? tools : undefined,
  };
}

/** 可选 switchId → 与 setActiveAgent 同一套 parse + workspace；不切槽。 */
export function resolveInspectTarget(
  current: InspectCurrentSlot,
  opts: {
    maouRoot: string;
    bootProjectRoot: string;
    switchId?: string;
  },
): InspectCurrentSlot {
  const raw = (opts.switchId || "").trim();
  if (!raw) return current;
  const parsed = parseAgentSwitchId(raw);
  if (!parsed) {
    return {
      agentName: raw,
      projectRoot: current.projectRoot,
      switchId: raw.includes(":") ? raw : `system:${raw}`,
    };
  }
  const projectRoot = resolveWorkspaceForSwitch({
    maouRoot: opts.maouRoot,
    bootProjectRoot: opts.bootProjectRoot,
    kind: parsed.kind,
    agentName: parsed.agentName,
    projectPath: parsed.projectPath ?? null,
  });
  return {
    agentName: parsed.agentName,
    projectRoot,
    switchId:
      parsed.kind === "project" && parsed.projectPath
        ? `project:${parsed.projectPath}:${parsed.agentName}`
        : `system:${parsed.agentName}`,
  };
}

export function inspectAgentFromDisk(opts: {
  maouRoot: string;
  agentName: string;
  projectRoot: string;
  switchId: string;
}): AgentInspectSnapshot {
  const registry = new AgentRegistry(opts.maouRoot, opts.projectRoot);
  const existing = registry.resolveAgentDir(opts.agentName);
  const agentDir = existsSync(existing)
    ? existing
    : opts.projectRoot
      ? join(opts.projectRoot, ".maou", "agents", opts.agentName)
      : existing;
  const config = existsSync(agentDir) ? resolveAgentConfig(agentDir) : {};
  const preview = previewAgentSystemPrompt({
    agentName: opts.agentName,
    projectRoot: opts.projectRoot,
    maouRoot: opts.maouRoot,
    includeTools: false,
  });
  return {
    switchId: opts.switchId,
    agentName: opts.agentName,
    projectRoot: preview.projectRoot || opts.projectRoot,
    promptRoot: preview.promptRoot,
    entrypoint: preview.entrypoint,
    params: pickAgentInspectParams(config),
    prompt: {
      ok: preview.ok,
      text: preview.text,
      charCount: preview.charCount,
      lineCount: preview.lineCount,
      error: preview.error,
    },
  };
}
