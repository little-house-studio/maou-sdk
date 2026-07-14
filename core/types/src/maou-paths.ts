/**
 * Maou 全系列产品共享路径。
 *
 * 用户态根（机器级，所有 agent 产品共用 API / 主题 / 全局 agents）：
 *   $MAOU_HOME 或 ~/.maou
 *
 * 全局 API 配置文件：
 *   $MAOU_LLM_CONFIG 或 <userRoot>/config.json
 *
 * 项目态（会话等）由各产品用 projectRoot/.maou，不放 API key。
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

export const MAOU_DIR_NAME = ".maou";
export const MAOU_CONFIG_FILE = "config.json";
export const MAOU_CONFIG_FILE_LEGACY = "user_config.json";

/** 用户态 maou 根目录：所有系列产品共享 */
export function resolveUserMaouRoot(): string {
  const override = process.env.MAOU_HOME?.trim();
  if (override) return resolve(override);
  return join(homedir(), MAOU_DIR_NAME);
}

/**
 * 全局 API / 应用配置文件路径（全系列共用）。
 * 优先 $MAOU_LLM_CONFIG；否则 <userRoot>/config.json；
 * 若仅有旧名 user_config.json 则回退旧文件。
 */
export function resolveUserConfigPath(userRoot?: string): string {
  const llmOverride = process.env.MAOU_LLM_CONFIG?.trim();
  if (llmOverride) return resolve(llmOverride);

  const root = userRoot ? resolve(userRoot) : resolveUserMaouRoot();
  const next = join(root, MAOU_CONFIG_FILE);
  const legacy = join(root, MAOU_CONFIG_FILE_LEGACY);
  if (existsSync(next)) return next;
  if (existsSync(legacy)) return legacy;
  return next;
}

export function resolveUserThemesDir(userRoot?: string): string {
  return join(userRoot ? resolve(userRoot) : resolveUserMaouRoot(), "themes");
}

export function resolveUserAgentsDir(userRoot?: string): string {
  return join(userRoot ? resolve(userRoot) : resolveUserMaouRoot(), "agents");
}

export function resolveUserHistoryPath(userRoot?: string): string {
  return join(userRoot ? resolve(userRoot) : resolveUserMaouRoot(), "history.json");
}

export function resolveUserLastSessionPath(userRoot?: string): string {
  return join(userRoot ? resolve(userRoot) : resolveUserMaouRoot(), "last-session.json");
}

/** 项目态 maou 根：仅会话 / 项目 agents，不含全局 API */
export function resolveProjectMaouRoot(projectRoot: string = process.cwd()): string {
  return join(projectRoot, MAOU_DIR_NAME);
}

export function resolveProjectSessionsDir(projectRoot: string = process.cwd()): string {
  return join(resolveProjectMaouRoot(projectRoot), "sessions");
}
