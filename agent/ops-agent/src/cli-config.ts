/** Ops Agent 的通用 CLI 接入配置。 */

import {
  createStandardAgentDeps,
  listModelsForCli,
  listProvidersForCli,
  resolvePresetForCli,
} from "@little-house-studio/agent";
import type { AgentCliConfig, AgentHandle } from "@little-house-studio/agent";
import {
  resolveUserMaouRoot,
  resolveUserOpsRoot,
  resolveUserOpsSessionsDir,
} from "@little-house-studio/types";
import { createCodingAgent } from "@little-house-studio/coding-agent";
import { createOpsAgent } from "./index.js";
import { listOpsAgents } from "./list-agents.js";

const opsCliConfig: AgentCliConfig = {
  name: "ops",
  scope: "global",

  resolveWorkspaceRoot(maouRoot: string) {
    return resolveUserOpsRoot(maouRoot);
  },

  /**
   * projectRoot：
   * - ops 默认 workspace（~/.maou/ops）→ 创建 Ops Agent
   * - 其它路径视为项目根 → 创建该项目的 Coding Agent（同进程切换）
   */
  createAgent(projectRoot: string, maouRoot: string): AgentHandle {
    const opsRoot = resolveUserOpsRoot(maouRoot);
    const isOpsWorkspace =
      !projectRoot ||
      projectRoot === opsRoot ||
      projectRoot === maouRoot;

    if (!isOpsWorkspace) {
      const deps = createStandardAgentDeps(projectRoot, maouRoot, {
        reviewerOnMissingPreset: "approve",
      });
      return createCodingAgent({
        projectRoot,
        maouRoot,
        configStore: deps.configStore,
        sessionStore: deps.sessionStore,
        toolRegistry: deps.toolRegistry,
        llmClient: deps.llmClient,
        log: () => {},
        enablePostLogger: false,
      });
    }

    const deps = createStandardAgentDeps(opsRoot, maouRoot, {
      reviewerOnMissingPreset: "approve",
      sessionsDir: resolveUserOpsSessionsDir(maouRoot),
    });
    return createOpsAgent({
      maouRoot,
      opsRoot,
      configStore: deps.configStore,
      sessionStore: deps.sessionStore,
      toolRegistry: deps.toolRegistry,
      llmClient: deps.llmClient,
      log: () => {},
      enablePostLogger: false,
    });
  },

  getPreset(provider: string, model: string) {
    return resolvePresetForCli(provider, model) as unknown as Record<string, unknown>;
  },

  getProviders() {
    return listProvidersForCli();
  },

  getModels(provider: string) {
    return listModelsForCli(provider);
  },

  listAgents() {
    return listOpsAgents(resolveUserMaouRoot()) as ReturnType<
      NonNullable<AgentCliConfig["listAgents"]>
    >;
  },
};

export default opsCliConfig;

