/**
 * 标准 Agent 运行时依赖装配（CLI / 各 agent 实例共用）。
 */

import { join } from "node:path";
import { ConfigStore, resolveUserMaouRoot } from "@little-house-studio/types";
import { SessionStore } from "@little-house-studio/context";
import {
  ToolRegistry,
  registerBuiltins,
  setTerminalPolicyRoot,
} from "@little-house-studio/tools";
import { LLMClient } from "@little-house-studio/llm";
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

/** CLI listAgents：合并全局 + 项目级 agent 目录 */
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

/** CLI getPreset：按 name/model 匹配，否则第一个 */
export function resolvePresetForCli(
  provider: string,
  model: string,
  configPath?: string,
): APIPreset {
  const presets = loadPresetsFromMaouConfig(configPath);
  const found =
    presets.find((p) => p.name === model || p.model === model || p.name === provider) ??
    presets[0];
  if (!found) {
    throw new Error(
      `未找到模型配置: ${model}（config.json 里有 ${presets.length} 个 preset）`,
    );
  }
  return found;
}

export function listProvidersForCli(configPath?: string): { id: string; name?: string }[] {
  const presets = loadPresetsFromMaouConfig(configPath);
  const seen = new Map<string, string>();
  for (const p of presets) {
    const id = p.name ?? p.model ?? "unknown";
    seen.set(id, p.name ?? id);
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

export function listModelsForCli(
  provider: string,
  configPath?: string,
): { id: string; name?: string }[] {
  const presets = loadPresetsFromMaouConfig(configPath);
  return presets
    .filter((p) => p.name === provider)
    .map((p) => ({
      id: p.model ?? p.name ?? "unknown",
      name: p.model ?? p.name ?? "unknown",
    }));
}
