/**
 * CLI 路径 —— 委托 @little-house-studio/types 全系列共享实现。
 * 用户态（API/主题）与项目态（sessions）分离。
 */

import {
  MAOU_DIR_NAME,
  resolveUserMaouRoot,
  resolveUserConfigPath,
  resolveUserThemesDir,
  resolveUserAgentsDir,
  resolveUserHistoryPath,
  resolveUserLastSessionPath,
  resolveProjectMaouRoot,
  resolveProjectSessionsDir,
} from "@little-house-studio/types";
import { join } from "node:path";

export { MAOU_DIR_NAME };

/** 用户态 maou 根：~/.maou 或 $MAOU_HOME（全系列共用） */
export function userMaouRoot(): string {
  return resolveUserMaouRoot();
}

/** 项目态 maou 根：<cwd>/.maou（不含全局 API） */
export function projectMaouRoot(cwd: string = process.cwd()): string {
  return resolveProjectMaouRoot(cwd);
}

export function userConfigPath(): string {
  return resolveUserConfigPath();
}

export function userHistoryPath(): string {
  return resolveUserHistoryPath();
}

export function userLastSessionPath(): string {
  return resolveUserLastSessionPath();
}

export function userThemesDir(): string {
  return resolveUserThemesDir();
}

export function userAgentsDir(): string {
  return resolveUserAgentsDir();
}

export function projectSessionsDir(cwd: string = process.cwd()): string {
  return resolveProjectSessionsDir(cwd);
}

export function projectSessionFile(sessionId: string, cwd: string = process.cwd()): string {
  return join(projectSessionsDir(cwd), `${sessionId}.jsonl`);
}

/** 项目态上次会话指针：<cwd>/.maou/last-session.json（按工作区隔离，勿用 ~/.maou） */
export function projectLastSessionPath(cwd: string = process.cwd()): string {
  return join(projectMaouRoot(cwd), "last-session.json");
}

export function projectAgentsDir(cwd: string = process.cwd()): string {
  return join(projectMaouRoot(cwd), "agents");
}
