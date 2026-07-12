/**
 * @little-house-studio/coding-agent — 编程 Agent 实例
 *
 * 仅保留 coding 特化：模板物化、工具白名单、轮次/名称常量。
 * 通用能力在 @little-house-studio/agent 的 bootstrap / Runtime：
 *   - createCallMainAgent / setSupervisorAbortSignal
 *   - createStandardAgentDeps / installTerminalReviewer
 *   - loadPresetsFromMaouConfig / listAgentsForCli
 *   - runAgentCli / createAgentFromTemplate
 */

import {
  Runtime,
  createAgentFromTemplate,
  createCallMainAgent,
  getDefaultPresetFromConfigStore,
} from "@little-house-studio/agent";
import type { AgentHandle } from "@little-house-studio/agent";
import type { Summarizer } from "@little-house-studio/context";
import type { SessionStore } from "@little-house-studio/context";
import type { ToolRegistry } from "@little-house-studio/tools";
import type { LLMClient } from "@little-house-studio/llm";
import type { ConfigStore } from "@little-house-studio/types";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * 解析包内 coding 模板目录的绝对路径。
 * dist/index.js → 回溯到包根的 templates/coding/。
 */
function resolveCodingTemplateDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "templates", "coding");
}

/**
 * 编程场景默认工具白名单。
 * 工具名对齐 @little-house-studio/tools 内置 name。
 */
export const CODING_TOOL_WHITELIST = [
  "reader",
  "write_file",
  "edit_file",
  "glob",
  "grep",
  "find_code",
  "use_terminal",
  "search_internet",
  "use_skill",
  "find_skill",
  "todo_manage",
  "todo_finish",
] as const;

/** coding agent 默认名称（即 agents/<name>/）。 */
export const DEFAULT_CODING_AGENT_NAME = "coding";

/** coding agent 默认轮次上限。 */
export const DEFAULT_CODING_ROUND_LIMIT = 50;

export interface CodingAgentOptions {
  name?: string;
  projectRoot?: string;
  maouRoot?: string;
  roundLimit?: number;
  toolWhitelist?: readonly string[];
  forceMaterialize?: boolean;
  toolCompression?: "off" | "normal" | "aggressive";
  enableCompression?: boolean;
  summarizer?: Summarizer;
  log?: (level: string, message: string) => void;
  enablePostLogger?: boolean;
  configStore: ConfigStore;
  sessionStore: SessionStore;
  toolRegistry: ToolRegistry;
  llmClient: LLMClient;
}

export type CodingAgent = AgentHandle;

/**
 * 创建绑定到项目目录的编程 Agent（引用模板物化 + Runtime）。
 */
export function createCodingAgent(opts: CodingAgentOptions): CodingAgent {
  const name = opts.name ?? DEFAULT_CODING_AGENT_NAME;
  const projectRoot = opts.projectRoot ?? process.cwd();
  const maouRoot = opts.maouRoot ?? join(process.env.HOME ?? "", ".maou");
  const toolWhitelist = opts.toolWhitelist ?? CODING_TOOL_WHITELIST;

  const targetDir = join(projectRoot, ".maou", "agents", name);
  createAgentFromTemplate(name, maouRoot, {
    templateDir: resolveCodingTemplateDir(),
    targetDir,
    displayName: "Coding Agent",
    role: "coding",
    tools: toolWhitelist,
    roundLimit: opts.roundLimit ?? DEFAULT_CODING_ROUND_LIMIT,
    force: opts.forceMaterialize,
    noCustomConfig: true,
  });

  const runtimeContainer: { ref: Runtime | null } = { ref: null };

  const runtime = new Runtime({
    configStore: opts.configStore,
    sessionStore: opts.sessionStore,
    toolRegistry: opts.toolRegistry,
    llmClient: opts.llmClient,
    maouRoot,
    projectRoot,
    enableCompression: opts.enableCompression,
    agentName: name,
    summarizer: opts.summarizer,
    log:
      opts.log ??
      ((level, msg) =>
        console[level === "error" ? "error" : "log"](`[Runtime] ${msg}`)),
    enablePostLogger: opts.enablePostLogger ?? true,
    // 监督 callMainAgent：agent 层通用实现
    callMainAgent: createCallMainAgent({
      getRuntime: () => runtimeContainer.ref,
      getDefaultPreset: () => getDefaultPresetFromConfigStore(opts.configStore),
      sandboxMode: "yolo",
    }),
  });
  runtimeContainer.ref = runtime;

  return {
    runtime,
    agentName: name,
    projectRoot,
    toolWhitelist,
    startSession: (title?: string) => runtime.startSession(name, title),
  };
}

// 透传通用能力（含监督 abort，供 CLI 使用；权威在 agent 层）
export {
  Runtime,
  runAgentCli,
  setSupervisorAbortSignal,
  getSupervisorAbortSignal,
  createCallMainAgent,
  createStandardAgentDeps,
  installTerminalReviewer,
  listAgentsForCli,
  resolvePresetForCli,
  listProvidersForCli,
  listModelsForCli,
  loadPresetsFromMaouConfig,
} from "@little-house-studio/agent";
export type {
  AppRuntimeOptions,
  AgentHandle,
  AgentCliOptions,
  CreateCallMainAgentOptions,
  StandardAgentDeps,
} from "@little-house-studio/agent";

export { runCodingAgentCli } from "./cli/index.js";
export type { CodingCliOptions } from "./cli/index.js";
