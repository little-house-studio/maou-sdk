/**
 * 标准 Agent 运行时依赖装配（CLI / 各 agent 实例共用）。
 */

import { join } from "node:path";
import {
  ConfigStore,
  resolveUserMaouRoot,
  resolveProviderModel,
} from "@little-house-studio/types";
import { SessionStore } from "@little-house-studio/context";
import {
  ToolRegistry,
  registerBuiltins,
  setTerminalPolicyRoot,
} from "@little-house-studio/tools";
import { LLMClient, normalizeApiPreset } from "@little-house-studio/llm";
import type { APIPreset } from "@little-house-studio/llm";
import { AgentRegistry } from "../agent/registry.js";
import type { AgentEntry } from "../agent/registry.js";
import {
  installTerminalReviewer,
  resolveTerminalReviewPreset,
} from "./terminal-reviewer.js";
import {
  getDefaultPresetFromConfigStore,
  loadPresetsFromMaouConfig,
  loadProvidersFromMaouConfig,
  getDefaultPresetFromMaouConfig,
} from "./presets.js";
import { applyAgentSkillOptions } from "./skills.js";
import type { AgentSkillOptions } from "./skills.js";

export interface StandardAgentDeps {
  configStore: ConfigStore;
  sessionStore: SessionStore;
  toolRegistry: ToolRegistry;
  llmClient: LLMClient;
  projectRoot: string;
  maouRoot: string;
}

export interface CreateStandardAgentDepsOptions {
  /** 是否安装终端 LLM 审核器（默认 true） */
  installReviewer?: boolean;
  /** 无 preset 时审核器行为（CLI 建议 approve，服务端 deny） */
  reviewerOnMissingPreset?: "approve" | "deny";
  /** 自定义 LLMClient */
  llmClient?: LLMClient;
  /** session 目录，默认 <projectRoot>/.maou/sessions */
  sessionsDir?: string;
  /**
   * Skill 扫描选项。默认 includeSystemNpmSkills=true（扫描 ~/.agents/skills）。
   */
  skillOptions?: AgentSkillOptions;
}

/**
 * 创建 ConfigStore + SessionStore + 全量 builtins + LLMClient，
 * 并设置 terminal policy root（可选安装 reviewer）。
 */
export function createStandardAgentDeps(
  projectRoot: string,
  maouRoot: string,
  opts: CreateStandardAgentDepsOptions = {},
): StandardAgentDeps {
  const configStore = new ConfigStore(projectRoot, maouRoot);
  const sessionsDir =
    opts.sessionsDir ?? join(projectRoot, ".maou", "sessions");
  const sessionStore = new SessionStore(sessionsDir);
  const toolRegistry = new ToolRegistry();
  registerBuiltins(toolRegistry);
  const llmClient = opts.llmClient ?? new LLMClient();

  setTerminalPolicyRoot(maouRoot);

  // skill 默认扫描（系统 NPM 路径默认开）—— use_skill 与 Runtime bake 共用
  applyAgentSkillOptions(opts.skillOptions);

  if (opts.installReviewer !== false) {
    // 审核模式 auto = helper 辅助 agent（单轮无 tool / AuxModelCaller）
    installTerminalReviewer({
      llmClient,
      policyRoot: maouRoot,
      onMissingPreset: opts.reviewerOnMissingPreset ?? "deny",
      getPreset: () =>
        getDefaultPresetFromConfigStore(configStore) ??
        (getDefaultPresetFromMaouConfig() as Record<string, unknown> | undefined),
      getHelperPreset: () => {
        try {
          const cfg = configStore.get();
          const presets = (cfg.api.presets ?? []) as unknown as APIPreset[];
          const main =
            (getDefaultPresetFromConfigStore(configStore) as APIPreset | undefined) ??
            (getDefaultPresetFromMaouConfig() as APIPreset | undefined);
          if (!main) return undefined;
          return resolveTerminalReviewPreset(presets, main, {
            helperPresetIdx: cfg.api.helperPreset,
            helperRole: cfg.api.roles?.helper,
            fastRole: cfg.api.roles?.fast,
          }) as Record<string, unknown> | undefined;
        } catch {
          return undefined;
        }
      },
    });
  }

  return {
    configStore,
    sessionStore,
    toolRegistry,
    llmClient,
    projectRoot,
    maouRoot,
  };
}

/**
 * CLI listAgents：合并全局 + 项目级 agent 目录（原始 registry 扫描）。
 *
 * ⚠️ 管理器/可切换主体列表请用 `listOpsAgents()`（core 权威）：
 * 过滤 coding≠system、附属驻扎、list_in_manager=false。
 * 切勿 `listAgentsForCli(root, opsRoot)` 再整表 stamp 为 system——
 * 会把 ops 工作区 coding 混成系统自由人。
 */
export function listAgentsForCli(
  maouRoot?: string,
  projectRoot?: string,
): AgentEntry[] {
  const root = maouRoot ?? resolveUserMaouRoot();
  const proj = projectRoot ?? process.cwd();
  try {
    return new AgentRegistry(root, proj).list();
  } catch {
    return [];
  }
}

/** CLI getPreset：真路由 id + model id */
export function resolvePresetForCli(
  provider: string,
  model: string,
  configPath?: string,
): APIPreset {
  let providers: Record<string, import("@little-house-studio/types").ApiProvider>;
  try {
    providers = loadProvidersFromMaouConfig(configPath);
  } catch {
    providers = {};
  }
  const hit = resolveProviderModel(providers, provider, model);
  if (hit) {
    return normalizeApiPreset(hit as unknown as APIPreset);
  }
  const presets = loadPresetsFromMaouConfig(configPath);
  const found =
    presets.find(
      (p) =>
        p.model === model ||
        p.name === model ||
        p.name === provider ||
        (p as { _providerName?: string })._providerName === provider,
    ) ?? presets[0];
  if (!found) {
    throw new Error(
      `未找到模型配置: ${provider}/${model}（config.json 里有 ${Object.keys(providers).length} 个厂商）`,
    );
  }
  return found;
}

export function listProvidersForCli(configPath?: string): { id: string; name?: string }[] {
  try {
    const providers = loadProvidersFromMaouConfig(configPath);
    return Object.entries(providers).map(([id, p]) => ({
      id,
      name: p.displayName ?? id,
    }));
  } catch {
    return [];
  }
}

export function listModelsForCli(
  provider: string,
  configPath?: string,
): { id: string; name?: string }[] {
  try {
    const providers = loadProvidersFromMaouConfig(configPath);
    const p = providers[provider];
    if (!p) return [];
    return p.models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
    }));
  } catch {
    return [];
  }
}
