/**
 * 从 AgentRuntime 状态构建 ToolContext（含 runtimePorts 双写）。
 * 从 runtime.ts 抽出以降低上帝对象内聚问题；行为与原先内联构造一致。
 */

import type { ToolContext, ToolRuntimePorts } from "@little-house-studio/types";
import type { APIPreset } from "@little-house-studio/llm";
import type { AgentSkillOptions } from "../bootstrap/skills.js";
import { SUPERVISOR_MANAGER } from "./supervisor-manager.js";
import { MessageBus } from "./message-bus.js";
import { join } from "node:path";

export interface BuildToolContextInput {
  sessionId: string;
  projectRoot: string;
  promptRoot: string;
  maouRoot: string;
  sandboxMode: string;
  agentName: string;
  workingDir?: string;
  compressionLevel?: "off" | "normal" | "aggressive";
  pathGuard?: ToolContext["pathGuard"];
  skillOptions?: AgentSkillOptions;
  subagentExecutor?: ToolRuntimePorts["subagentExecutor"];
  callMainAgentFn?: (
    mainSessionId: string,
    message: string,
    abortSignal?: AbortSignal,
  ) => AsyncGenerator<import("@little-house-studio/types").StreamEvent, string>;
  auxModelCaller?: ToolRuntimePorts["auxModelCaller"];
  mainPreset?: unknown;
  resolveHelperPresetFn?: (agentName: string, mainPreset: unknown) => unknown;
  yieldResult?: ToolRuntimePorts["yieldResult"];
  currentPreset?: APIPreset;
}

/**
 * 构造工具上下文：`runtimePorts` 与顶层遗留字段双写，能力完全保留。
 */
export function buildToolContext(input: BuildToolContextInput): ToolContext {
  const sessionId = input.sessionId ?? "";
  const agentName = input.agentName;

  const subagentExecutor = input.subagentExecutor
    ? (Object.assign(input.subagentExecutor, { parentSessionId: sessionId }), input.subagentExecutor)
    : undefined;

  const callMainAgent = ((): ToolRuntimePorts["callMainAgent"] => {
    if (!input.callMainAgentFn) return undefined;
    const binding = SUPERVISOR_MANAGER.getBySupervisor(sessionId);
    if (!binding) return undefined;
    return (message: string, abortSignal?: AbortSignal) =>
      input.callMainAgentFn!(binding.mainSessionId, message, abortSignal);
  })();

  const isSupervisorSession = SUPERVISOR_MANAGER.isSupervisorSession(sessionId);
  const supervisorManager = SUPERVISOR_MANAGER;
  const messageBus = MessageBus.global();
  const auxModelCaller = input.auxModelCaller as ToolRuntimePorts["auxModelCaller"];
  const mainPreset = (input.currentPreset ?? input.mainPreset) as unknown;
  const resolveHelperPreset = input.resolveHelperPresetFn;
  const runtimeAgentName = agentName;
  const yieldResult = input.yieldResult;

  const runtimePorts: ToolRuntimePorts = {
    subagentExecutor,
    callMainAgent,
    isSupervisorSession,
    supervisorManager,
    auxModelCaller,
    mainPreset,
    resolveHelperPreset,
    runtimeAgentName,
    yieldResult,
    messageBus,
  };

  return {
    sessionId,
    projectRoot: input.projectRoot,
    promptRoot: input.promptRoot,
    sandboxRoot: join(input.maouRoot, "sandbox", sessionId),
    sandboxMode: input.sandboxMode,
    agentName,
    agentMode: "execute",
    pluginSettings: {},
    workingDir: input.workingDir ?? input.projectRoot,
    pathGuard: input.pathGuard,
    compressionLevel: input.compressionLevel,
    maouRoot: input.maouRoot,
    skillOptions: input.skillOptions,
    // 收口端口 + 顶层双写（旧工具仍可读 ctx.subagentExecutor 等）
    runtimePorts,
    subagentExecutor,
    callMainAgent,
    isSupervisorSession,
    supervisorManager,
    auxModelCaller,
    mainPreset,
    resolveHelperPreset,
    runtimeAgentName,
    yieldResult,
    messageBus,
  };
}
