/**
 * 新项目门禁 —— 在尚未初始化的 cwd 上首次 maou agent 时确认。
 *
 * 同意后创建 <cwd>/.maou/ 与 project.json 标记，再进入 TUI。
 * 跳过：--yes / MAOU_PROJECT_YES=1
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectMaouRoot, projectSessionsDir } from "../config/paths.js";

export const PROJECT_MARKER = "project.json";

export interface ProjectMeta {
  version: 1;
  /** 绝对路径，便于排查 */
  cwd: string;
  createdAt: string;
  product?: string;
}

function markerPath(cwd: string = process.cwd()): string {
  return join(projectMaouRoot(cwd), PROJECT_MARKER);
}

/** 是否已在该路径确认过使用 Maou（存在 .maou/project.json） */
export function isProjectInitialized(cwd: string = process.cwd()): boolean {
  return existsSync(markerPath(cwd));
}

export function readProjectMeta(cwd: string = process.cwd()): ProjectMeta | null {
  try {
    return JSON.parse(readFileSync(markerPath(cwd), "utf-8")) as ProjectMeta;
  } catch {
    return null;
  }
}

/** 写入项目标记并确保 sessions 目录 */
export function initializeProject(
  cwd: string = process.cwd(),
  product = "coding-agent",
): ProjectMeta {
  const root = projectMaouRoot(cwd);
  mkdirSync(projectSessionsDir(cwd), { recursive: true });
  const meta: ProjectMeta = {
    version: 1,
    cwd: cwd,
    createdAt: new Date().toISOString(),
    product,
  };
  writeFileSync(markerPath(cwd), JSON.stringify(meta, null, 2), "utf-8");
  // 保证 root 存在
  mkdirSync(root, { recursive: true });
  return meta;
}

export interface ProjectGateOptions {
  /** 非交互直接同意 */
  yes?: boolean;
  cwd?: string;
  product?: string;
}

/**
 * 若项目未初始化，提示确认；同意则创建 .maou。
 * @returns true 可继续启动
 */
export async function ensureProjectConsent(
  opts: ProjectGateOptions = {},
): Promise<boolean> {
  const cwd = opts.cwd ?? process.cwd();
  const yes =
    opts.yes === true ||
    process.env.MAOU_PROJECT_YES === "1" ||
    process.env.MAOU_YES === "1";

  if (isProjectInitialized(cwd)) {
    return true;
  }

  const abs = cwd;
  const maouDir = projectMaouRoot(cwd);

  output.write("\n");
  output.write("══════════════════════════════════════════════════\n");
  output.write("  Maou · 新项目确认\n");
  output.write("══════════════════════════════════════════════════\n");
  output.write(`当前路径尚未启用 Maou：\n`);
  output.write(`  ${abs}\n`);
  output.write(`\n同意后将创建项目目录（不含 API key）：\n`);
  output.write(`  ${maouDir}/\n`);
  output.write(`  ${maouDir}/project.json\n`);
  output.write(`  ${maouDir}/sessions/\n`);
  output.write(`\n全局 API 配置仍在用户态 ~/.maou/config.json（全系列共用）。\n`);
  output.write("\n");

  if (yes) {
    initializeProject(cwd, opts.product);
    output.write("✓ 已确认并初始化项目（--yes）\n\n");
    return true;
  }

  if (!input.isTTY || !output.isTTY) {
    output.write(
      "❌ 非交互环境：请加 --yes 或设置 MAOU_PROJECT_YES=1 以确认在新项目使用。\n",
    );
    return false;
  }

  const rl = readline.createInterface({ input, output });
  try {
    const ans = (
      await rl.question("是否确认在此路径使用 Maou 并创建 .maou？[y/N]：")
    )
      .trim()
      .toLowerCase();
    if (ans !== "y" && ans !== "yes") {
      output.write("已取消。未创建任何文件。\n");
      return false;
    }
    initializeProject(cwd, opts.product);
    output.write("✓ 已创建项目目录，即将启动…\n\n");
    return true;
  } finally {
    rl.close();
  }
}
