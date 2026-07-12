/**
 * coding-agent 的 CLI 配置 —— 仅 coding 特化 + 通用 bootstrap。
 *
 * `maou`（无参数）默认加载此文件。
 * 装配 / preset / 审核器 / listAgents 均来自 @little-house-studio/agent。
 */

import {
  createStandardAgentDeps,
  listAgentsForCli,
  resolvePresetForCli,
  listProvidersForCli,
  listModelsForCli,
} from "@little-house-studio/agent";
import type { AgentCliConfig } from "@little-house-studio/agent";
import { createCodingAgent } from "./index.js";

const codingCliConfig: AgentCliConfig = {
  name: "coding",

  createAgent(projectRoot: string, maouRoot: string) {
    // 通用依赖装配（builtins + terminal policy + LLM 审核器）
    const deps = createStandardAgentDeps(projectRoot, maouRoot, {
      reviewerOnMissingPreset: "approve", // CLI 无 preset 时不卡死
    });

    return createCodingAgent({
      projectRoot,
      maouRoot,
      configStore: deps.configStore,
      sessionStore: deps.sessionStore,
      toolRegistry: deps.toolRegistry,
      llmClient: deps.llmClient,
      log: () => {}, // 静默，避免污染 Ink stdout
      enablePostLogger: false,
    });
  },

  getPreset(_provider: string, model: string) {
    return resolvePresetForCli(_provider, model) as unknown as Record<string, unknown>;
  },

  getProviders() {
    return listProvidersForCli();
  },

  getModels(provider: string) {
    return listModelsForCli(provider);
  },

  listAgents() {
    return listAgentsForCli();
  },
};

export default codingCliConfig;
