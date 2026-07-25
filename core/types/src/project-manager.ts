/**
 * 机器级项目索引。
 *
 * `maou coding` 把项目按规范化绝对路径注册到
 * `<MAOU_HOME>/projects.json`，Ops Agent 由此发现本机所有 coding 项目。
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, parse, resolve } from "node:path";
import { homedir } from "node:os";
import { resolveUserProjectsPath } from "./maou-paths.js";

const REGISTRY_VERSION = 1;
const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 2_000;
const STALE_LOCK_MS = 30_000;

export interface ProjectEntry {
  name: string;
  path: string;
  created_at?: string;
  updated_at?: string;
  product?: string;
}

export interface ProjectListItem extends ProjectEntry {
  /** 路径存在且仍有 `.maou/project.json`。 */
  isActive: boolean;
}

interface ProjectRegistryFile {
  version: 1;
  projects: ProjectEntry[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function canonicalPath(inputPath: string): string {
  const absolute = resolve(inputPath);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function pathKey(inputPath: string): string {
  const canonical = canonicalPath(inputPath);
  const root = parse(canonical).root;
  const withoutTrailing = canonical === root
    ? canonical
    : canonical.replace(/[\\/]+$/, "");
  return process.platform === "win32" ? withoutTrailing.toLowerCase() : withoutTrailing;
}

export function resolveProjectsRegistryPath(userRoot?: string): string {
  return resolveUserProjectsPath(userRoot);
}

function loadRegistry(registryPath: string): ProjectRegistryFile {
  if (!existsSync(registryPath)) {
    return { version: REGISTRY_VERSION, projects: [] };
  }
  try {
    const data = JSON.parse(readFileSync(registryPath, "utf-8")) as {
      version?: unknown;
      projects?: unknown;
    };
    const projects = Array.isArray(data.projects)
      ? data.projects.filter((p): p is ProjectEntry => {
          if (!p || typeof p !== "object") return false;
          const entry = p as Partial<ProjectEntry>;
          return typeof entry.name === "string" && typeof entry.path === "string";
        })
      : [];
    return { version: REGISTRY_VERSION, projects };
  } catch {
    // 读取项目列表不应破坏损坏文件；写入时会以有效数据原子替换。
    return { version: REGISTRY_VERSION, projects: [] };
  }
}

function saveRegistry(registryPath: string, registry: ProjectRegistryFile): void {
  mkdirSync(dirname(registryPath), { recursive: true });
  const tmp = `${registryPath}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, JSON.stringify(registry, null, 2), "utf-8");
  renameSync(tmp, registryPath);
}

function sleepSync(ms: number): void {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, ms);
}

function withRegistryLock<T>(registryPath: string, fn: () => T): T {
  const lockPath = `${registryPath}.lock`;
  mkdirSync(dirname(registryPath), { recursive: true });
  const started = Date.now();
  let fd: number | null = null;

  while (fd === null) {
    try {
      fd = openSync(lockPath, "wx", 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at: nowIso() }));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - started >= LOCK_TIMEOUT_MS) {
        throw new Error(`项目索引被占用: ${lockPath}`);
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }

  try {
    return fn();
  } finally {
    try { closeSync(fd); } catch { /* ignore */ }
    try { rmSync(lockPath, { force: true }); } catch { /* ignore */ }
  }
}

/**
 * 按规范化绝对路径新增或更新项目。重复启动同一个项目只刷新 updated_at。
 */
export function registerProject(
  projectPath: string,
  options: { name?: string; product?: string; userRoot?: string } = {},
): ProjectEntry {
  const canonical = canonicalPath(projectPath);
  const registryPath = resolveProjectsRegistryPath(options.userRoot);

  return withRegistryLock(registryPath, () => {
    const registry = loadRegistry(registryPath);
    const key = pathKey(canonical);
    const at = nowIso();
    const index = registry.projects.findIndex((p) => pathKey(p.path) === key);
    const previous = index >= 0 ? registry.projects[index] : undefined;
    const entry: ProjectEntry = {
      name: options.name?.trim() || previous?.name || basename(canonical),
      path: canonical,
      created_at: previous?.created_at ?? at,
      updated_at: at,
      product: options.product ?? previous?.product ?? "coding-agent",
    };

    if (index >= 0) registry.projects[index] = entry;
    else registry.projects.push(entry);
    registry.projects.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
    saveRegistry(registryPath, registry);
    return entry;
  });
}

/** 获取全部注册项目；失效项目保留并标为 isActive=false。 */
export function getProjectsList(userRoot?: string): ProjectListItem[] {
  const registry = loadRegistry(resolveProjectsRegistryPath(userRoot));
  return registry.projects.map((entry) => {
    const path = canonicalPath(entry.path);
    return {
      ...entry,
      path,
      isActive: existsSync(join(path, ".maou", "project.json")),
    };
  });
}

/** 兼容旧 API；新代码应使用 registerProject(path, {name})。 */
export function addProject(name: string, projectPath?: string): ProjectEntry | null {
  const finalPath = projectPath ?? join(homedir(), "Documents", "vscodeProject", name);
  const existing = getProjectsList().find((p) => pathKey(p.path) === pathKey(finalPath));
  if (existing) return null;
  return registerProject(finalPath, { name });
}

/** 兼容旧 API：按名字移除第一个匹配项。 */
export function removeProject(name: string, userRoot?: string): boolean {
  const registryPath = resolveProjectsRegistryPath(userRoot);
  return withRegistryLock(registryPath, () => {
    const registry = loadRegistry(registryPath);
    const index = registry.projects.findIndex((p) => p.name === name);
    if (index < 0) return false;
    registry.projects.splice(index, 1);
    saveRegistry(registryPath, registry);
    return true;
  });
}

export function removeProjectByPath(projectPath: string, userRoot?: string): boolean {
  const registryPath = resolveProjectsRegistryPath(userRoot);
  return withRegistryLock(registryPath, () => {
    const registry = loadRegistry(registryPath);
    const key = pathKey(projectPath);
    const next = registry.projects.filter((p) => pathKey(p.path) !== key);
    if (next.length === registry.projects.length) return false;
    saveRegistry(registryPath, { version: REGISTRY_VERSION, projects: next });
    return true;
  });
}

/** 显式迁移工具：扫描 baseDir 的直接子目录并注册已有 `.maou/project.json` 的项目。 */
export function autoDiscover(baseDir?: string): ProjectEntry[] {
  const scanRoot = canonicalPath(baseDir ?? join(homedir(), "Documents", "vscodeProject"));
  if (!existsSync(scanRoot)) return [];
  const known = new Set(getProjectsList().map((p) => pathKey(p.path)));
  const found: ProjectEntry[] = [];

  try {
    for (const entry of readdirSync(scanRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
      const projectPath = join(scanRoot, entry.name);
      if (!existsSync(join(projectPath, ".maou", "project.json"))) continue;
      if (known.has(pathKey(projectPath))) continue;
      const registered = registerProject(projectPath, { name: entry.name });
      known.add(pathKey(projectPath));
      found.push(registered);
    }
  } catch {
    return found;
  }
  return found;
}
