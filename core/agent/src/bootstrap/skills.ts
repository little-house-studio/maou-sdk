/**
 * Agent 层 Skill 装配。
 *
 * 统一：
 * - 扫描选项（含系统/NPM 全局 ~/.agents/skills，默认开启）
 * - SkillContextManager 工厂（Runtime / createStandardAgentDeps 共用）
 * - 同步 tools 层默认选项（use_skill 与 bake 同口径）
 */

import {
  SkillContextManager,
  setDefaultSkillScanOptions,
  getDefaultSkillScanOptions,
  resolveSkillScanOptions,
  getSystemNpmSkillDirs,
} from "@little-house-studio/tools";
import type { SkillScanOptions } from "@little-house-studio/tools";

/**
 * Agent 级 skill 配置（RuntimeOptions.skillOptions / bootstrap）。
 */
export interface AgentSkillOptions {
  /**
   * 是否扫描系统/NPM 全局 skill（npx skills -g → ~/.agents/skills 等）。
   * 默认 true。也可用环境变量 MAOU_INCLUDE_SYSTEM_SKILLS=0 强制关闭。
   */
  includeSystemNpmSkills?: boolean;
  /** 额外 skill 根目录 */
  extraDirs?: string[];
  /**
   * 启用白名单。空 / 未设 = 全部；含 "*" = 全部。
   * 仅影响 bake 列表与 listAvailableSkills 过滤。
   */
  enabledSkills?: string[];
}

/** 将 AgentSkillOptions 转成 tools 层 SkillScanOptions */
export function toSkillScanOptions(opts?: AgentSkillOptions): SkillScanOptions {
  return resolveSkillScanOptions({
    includeSystemNpmSkills: opts?.includeSystemNpmSkills,
    extraDirs: opts?.extraDirs,
  });
}

/**
 * 应用 Agent skill 选项为 tools 默认扫描配置。
 * Runtime 构造时调用一次，保证 use_skill 与 system bake 一致。
 */
export function applyAgentSkillOptions(opts?: AgentSkillOptions): void {
  const scan = toSkillScanOptions(opts);
  setDefaultSkillScanOptions(scan);
}

/**
 * 创建与 Runtime bake / use_skill 同口径的 SkillContextManager。
 */
export function createAgentSkillManager(
  agentName: string,
  projectRoot: string,
  maouRoot: string,
  opts?: AgentSkillOptions,
): SkillContextManager {
  applyAgentSkillOptions(opts);
  const manager = new SkillContextManager(
    agentName,
    projectRoot,
    maouRoot,
    toSkillScanOptions(opts),
  );
  if (opts?.enabledSkills && opts.enabledSkills.length > 0) {
    manager.setEnabledSkills(opts.enabledSkills);
  }
  return manager;
}

export {
  getDefaultSkillScanOptions,
  getSystemNpmSkillDirs,
  setDefaultSkillScanOptions,
  resolveSkillScanOptions,
};
export type { SkillScanOptions };
