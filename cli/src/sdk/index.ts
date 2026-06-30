/**
 * SDK 接线 —— 用 createCodingAgent + Runtime 驱动 CLI。
 *
 * 从 ~/.maou/config.json 读 preset，装配 configStore/sessionStore/toolRegistry/llmClient，
 * createCodingAgent 物化编程 agent（项目级 .maou/agents/coding）。
 * runCodingAgentCli 驱动 agent 循环，逐事件回调。
 */

import { ConfigStore } from "@little-house-studio/types";
import { SessionStore } from "@little-house-studio/context";
import { ToolRegistry, registerBuiltins } from "@little-house-studio/tools";
import { LLMClient, LLMConfig } from "@little-house-studio/llm";
import { createCodingAgent, runCodingAgentCli } from "@little-house-studio/coding-agent";
import type { CodingAgent } from "@little-house-studio/coding-agent";
import type { StreamEvent } from "@little-house-studio/types";
import { join } from "node:path";

// ─── 全局单例（cli 启动时初始化一次）──────────────────────────────────────

let _agent: CodingAgent | null = null;
let _llmConfig: LLMConfig | null = null;

function getLlmConfig(): LLMConfig {
  if (!_llmConfig) {
    _llmConfig = new LLMConfig({ configPath: process.env.MAOU_LLM_CONFIG });
  }
  return _llmConfig;
}

/** 获取/创建 agent 单例。name 指定 agent 名称（默认 coding）。projectRoot = cwd。 */
export function getAgent(name: string = "coding", projectRoot?: string): CodingAgent {
  if (_agent) return _agent;

  const root = projectRoot ?? process.cwd();
  const maouRoot = join(process.env.HOME ?? "", ".maou");

  const configStore = new ConfigStore(root, maouRoot);
  const toolRegistry = new ToolRegistry();
  registerBuiltins(toolRegistry);
  const sessionStore = new SessionStore(join(root, ".maou", "sessions"));
  const llmClient = new LLMClient();

  _agent = createCodingAgent({
    name,
    projectRoot: root,
    maouRoot,
    configStore,
    sessionStore,
    toolRegistry,
    llmClient,
  });
  return _agent;
}

/** 向后兼容：getCodingAgent = getAgent("coding") */
export function getCodingAgent(projectRoot?: string): CodingAgent {
  return getAgent("coding", projectRoot);
}

export interface RunOpts {
  /** 用户消息 */
  message: string;
  /** 会话 ID（不传则自动创建） */
  sessionId?: string;
  /** agent 名称（默认 coding） */
  agentName?: string;
  /** provider + model（从 LLMConfig 取 preset） */
  provider: string;
  model: string;
  /** 流式事件回调 */
  onEvent: (ev: StreamEvent) => void;
  /** 中断信号 */
  signal?: AbortSignal;
}

/**
 * 用一条消息驱动 agent。返回 sessionId。
 */
export async function runChat(opts: RunOpts): Promise<string> {
  const agent = getAgent(opts.agentName ?? "coding");
  const preset = getLlmConfig().toAPIPreset(opts.provider, opts.model) as unknown as Record<string, unknown>;

  return runCodingAgentCli(opts.message, {
    agent,
    sessionId: opts.sessionId,
    preset,
    onEvent: opts.onEvent,
    signal: opts.signal,
    source: "cli",
  });
}

export { LLMConfig };
