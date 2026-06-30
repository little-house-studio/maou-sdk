/**
 * coding-agent 的 CLI 配置 —— AgentCliConfig 实现。
 *
 * `maou`（无参数）默认加载此文件，启动 coding agent 的 CLI 界面。
 * agent 开发者可参照此文件写自己的 cli-config，用 `maou <path>` 加载。
 */

import { ConfigStore } from "@little-house-studio/types";
import { SessionStore } from "@little-house-studio/context";
import { ToolRegistry, registerBuiltins } from "@little-house-studio/tools";
import { LLMClient, LLMConfig, getProviders, getModels } from "@little-house-studio/llm";
import { createCodingAgent } from "./index.js";
import type { AgentCliConfig } from "@little-house-studio/cli/types";
import { join } from "node:path";

let _llmConfig: LLMConfig | null = null;
function getLlmConfig(): LLMConfig {
  if (!_llmConfig) _llmConfig = new LLMConfig({ configPath: process.env.MAOU_LLM_CONFIG });
  return _llmConfig;
}

const codingCliConfig: AgentCliConfig = {
  name: "coding",

  createAgent(projectRoot: string, maouRoot: string) {
    const configStore = new ConfigStore(projectRoot, maouRoot);
    const toolRegistry = new ToolRegistry();
    registerBuiltins(toolRegistry);
    const sessionStore = new SessionStore(join(projectRoot, ".maou", "sessions"));
    const llmClient = new LLMClient();

    const agent = createCodingAgent({
      projectRoot,
      maouRoot,
      configStore,
      sessionStore,
      toolRegistry,
      llmClient,
    });
    return {
      runtime: agent.runtime,
      startSession: agent.startSession,
    };
  },

  getPreset(provider: string, model: string): Record<string, unknown> {
    return getLlmConfig().toAPIPreset(provider, model) as unknown as Record<string, unknown>;
  },

  getProviders() {
    return getProviders().map((p) => ({ id: p.id, name: p.name }));
  },

  getModels(provider: string) {
    return getModels(provider).map((m) => ({ id: m.id, name: m.name }));
  },
};

export default codingCliConfig;
