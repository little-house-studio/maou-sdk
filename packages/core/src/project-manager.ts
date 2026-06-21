/**
 * 项目管理器 — 管理注册项目列表
 * 对齐 Python: core/config/project_manager.py
 *
 * 项目注册表存储在 ~/.maou/projects.json。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

/** 系统级 .maou 目录 */
const SYSTEM_MAOU_DIR = join(homedir(), ".maou");

/** 注册表文件名 */
const REGISTRY_FILE = "projects.json";

/** 注册表文件路径 */
const REGISTRY_PATH = join(SYSTEM_MAOU_DIR, REGISTRY_FILE);

/** 项目条目 */
export interface ProjectEntry {
  name: string;
  path: string;
  created_at?: string;
  updated_at?: string;
}

/** 项目列表条目（带 isActive 标记） */
export interface ProjectListItem {
  name: string;
  path: string;
  isActive: boolean;
}

// ─── 内部工具函数 ──────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function loadProjects(): ProjectEntry[] {
  if (!existsSync(REGISTRY_PATH)) {
    mkdirSync(SYSTEM_MAOU_DIR, { recursive: true });
    writeFileSync(
      REGISTRY_PATH,
      JSON.stringify({ projects: [] }, null, 2),
      "utf-8",
    );
    return [];
  }
  try {
    const data = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
    return (data.projects ?? []) as ProjectEntry[];
  } catch {
    return [];
  }
}

function saveProjects(projects: ProjectEntry[]): void {
  mkdirSync(SYSTEM_MAOU_DIR, { recursive: true });
  const tmpPath = REGISTRY_PATH + ".tmp";
  writeFileSync(tmpPath, JSON.stringify({ projects }, null, 2), "utf-8");
  // 原子写入
  renameSync(tmpPath, REGISTRY_PATH);
}

// ─── 公开 API ──────────────────────────────────────────────────────────────

/** 获取所有已注册项目的列表（仅返回路径存在的项目） */
export function getProjectsList(): ProjectListItem[] {
  const allProjects = loadProjects();
  const result: ProjectListItem[] = [];
  for (const p of allProjects) {
    const projectPath = resolve(p.path);
    if (!existsSync(projectPath)) continue;
    result.push({
      name: p.name,
      path: projectPath,
      isActive: true,
    });
  }
  return result;
}

/**
 * 添加新项目
 *
 * @param name - 项目名称
 * @param projectPath - 项目路径（默认 ~/Documents/vscodeProject/{name}）
 * @returns 新增的项目条目，如果名称已存在则返回 null
 */
export function addProject(name: string, projectPath?: string): ProjectEntry | null {
  const projects = loadProjects();
  if (projects.some((p) => p.name === name)) return null;

  const finalPath = projectPath ?? join(homedir(), "Documents", "vscodeProject", name);
  const entry: ProjectEntry = {
    name,
    path: resolve(finalPath),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  projects.push(entry);
  saveProjects(projects);
  return entry;
}

/**
 * 移除项目
 *
 * @param name - 项目名称
 * @returns true 表示成功移除，false 表示未找到
 */
export function removeProject(name: string): boolean {
  const projects = loadProjects();
  const before = projects.length;
  const filtered = projects.filter((p) => p.name !== name);
  if (filtered.length === before) return false;
  saveProjects(filtered);
  return true;
}

/**
 * 自动发现包含 .maou/ 的目录，补入项目清单
 *
 * @param baseDir - 扫描根目录（默认 ~/Documents/vscodeProject）
 * @returns 新发现的项目列表
 */
export function autoDiscover(baseDir?: string): ProjectEntry[] {
  const scanRoot = baseDir ? resolve(baseDir) : join(homedir(), "Documents", "vscodeProject");
  if (!existsSync(scanRoot)) return [];

  const existing = new Map<string, ProjectEntry>();
  for (const p of loadProjects()) {
    existing.set(p.name, p);
  }

  const found: ProjectEntry[] = [];
  try {
    const entries = readdirSync(scanRoot, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;

      const dirPath = join(scanRoot, entry.name);
      const maouDir = join(dirPath, ".maou");
      if (!existsSync(maouDir)) continue;
      if (existing.has(entry.name)) continue;

      const entryData: ProjectEntry = {
        name: entry.name,
        path: resolve(dirPath),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      existing.set(entry.name, entryData);
      found.push(entryData);
    }

    if (found.length > 0) {
      saveProjects([...existing.values()]);
    }
  } catch {
    // 目录读取失败时静默返回
  }

  return found;
}
