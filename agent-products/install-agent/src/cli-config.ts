/** 安装员的 CLI 接入配置。headless 入口走 runAiinstallMain，不进 TUI。 */

import {
  createStandardAgentDeps,
  listModelsForCli,
  listProvidersForCli,
  resolvePresetForCli,
} from "@little-house-studio/agent";
import type { AgentCliConfig } from "@little-house-studio/agent";
import {
  resolveUserInstallRoot,
  resolveUserInstallSessionsDir,
} from "@little-house-studio/types";
import { createInstallAgent } from "./create.js";

const installCliConfig: AgentCliConfig = {
  name: "install",
  scope: "global",

  resolveWorkspaceRoot(maouRoot: string) {
    return resolveUserInstallRoot(maouRoot);
  },

  createAgent(projectRoot: string, maouRoot: string) {
    const dataRoot = resolveUserInstallRoot(maouRoot);
    const dest =
      projectRoot && projectRoot !== dataRoot && projectRoot !== maouRoot
        ? projectRoot
        : dataRoot;
    const deps = createStandardAgentDeps(dataRoot, maouRoot, {
      reviewerOnMissingPreset: "approve",
      sessionsDir: resolveUserInstallSessionsDir(maouRoot),
    });
    return createInstallAgent({
      maouRoot,
      dataRoot,
      projectRoot: dest,
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
    return [];
  },
};

export default installCliConfig;
