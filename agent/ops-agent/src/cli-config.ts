/** Ops Agent 的通用 CLI 接入配置。 */

import {
  createStandardAgentDeps,
  listAgentsForCli,
  listModelsForCli,
  listProvidersForCli,
  resolvePresetForCli,
} from "@little-house-studio/agent";
import type { AgentCliConfig } from "@little-house-studio/agent";
import {
  resolveUserMaouRoot,
  resolveUserOpsRoot,
  resolveUserOpsSessionsDir,
} from "@little-house-studio/types";
import { createOpsAgent } from "./index.js";

const opsCliConfig: AgentCliConfig = {
  name: "ops",
  scope: "global",

  resolveWorkspaceRoot(maouRoot: string) {
    return resolveUserOpsRoot(maouRoot);
  },

  createAgent(_projectRoot: string, maouRoot: string) {
    const opsRoot = resolveUserOpsRoot(maouRoot);
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
    return listAgentsForCli(resolveUserMaouRoot(), resolveUserOpsRoot());
  },
};

export default opsCliConfig;
