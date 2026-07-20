/**
 * PathGuard —— 子 Agent / project 路径沙箱（工具层硬约束）。
 *
 * 模式：
 *   inherit  — 仅 workingDir|projectRoot（默认，与旧 safePath 一致）
 *   hard     — 只能访问 roots（主 path）；越界直接拒绝
 *   audit    — roots 内自由；auditRoots 内允许但 needsAudit=true；其余拒绝
 *
 * denySegments（可选 / 环境开关）：
 *   路径任一路径段命中则拒绝（防读 gold / management / previous_runs）。
 *   默认不启用；MAOU_PIPELINE_ISOLATE=1 或 MAOU_DENY_PATH_SEGMENTS=a,b 时生效。
 *
 * 所有文件读写工具应走 resolveToolPath(ctx, userPath)，不要各自拼 root。
 */

import { resolve as resolvePath, isAbsolute, relative } from "node:path";

export type PathGuardMode = "inherit" | "hard" | "audit";

/** 流水线隔离默认禁止的路径段（仅 MAOU_PIPELINE_ISOLATE=1 时自动加入） */
export const DEFAULT_PIPELINE_DENY_SEGMENTS: readonly string[] = [
  "gold",
  "management",
  "previous_runs",
  ".pipeline-management",
  "pipeline-management",
];

export interface PathGuard {
  mode: PathGuardMode;
  /**
   * 主根路径列表（通常 1 个：project.path）。
   * 绝对路径；相对路径会在 resolve 时相对 projectRoot 展开。
   */
  roots: string[];
  /** 域外审核路径（audit 模式才有意义） */
  auditRoots?: string[];
  /**
   * 禁止访问的路径段（大小写不敏感，整段匹配）。
   * 例：["gold","management"] → 拒绝 .../gold/... 与 .../management/...
   */
  denySegments?: string[];
}

export interface ResolvedToolPath {
  /** 规范化后的绝对路径 */
  path: string;
  /** true = 落在 auditRoots 内（调用方可记日志 / 将来接审批） */
  needsAudit: boolean;
  /** 命中的根目录 */
  matchedRoot: string;
}

function normalizeRoot(root: string, base: string): string {
  const abs = isAbsolute(root) ? resolvePath(root) : resolvePath(base, root);
  // 去掉尾部斜杠（保留根 `/`）
  return abs.length > 1 && abs.endsWith("/") ? abs.slice(0, -1) : abs;
}

function isUnder(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** 解析环境变量中的 deny 段 */
export function parseEnvDenySegments(): string[] {
  const raw = (process.env.MAOU_DENY_PATH_SEGMENTS ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/[,:\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 合并 guard / 环境 / 流水线隔离开关后的 deny 段。
 * 默认空 = 不改变现有行为。
 */
export function effectiveDenySegments(guard?: PathGuard | null): string[] {
  const set = new Set<string>();
  for (const s of guard?.denySegments ?? []) {
    const t = String(s).trim().toLowerCase();
    if (t) set.add(t);
  }
  for (const s of parseEnvDenySegments()) set.add(s);
  const iso = (process.env.MAOU_PIPELINE_ISOLATE ?? "").trim().toLowerCase();
  if (iso === "1" || iso === "true" || iso === "yes" || iso === "on") {
    for (const s of DEFAULT_PIPELINE_DENY_SEGMENTS) set.add(s);
  }
  return [...set];
}

/**
 * 路径是否命中 deny 段（整段匹配，大小写不敏感）。
 * What: path_deny_check
 * How: segment_name_match
 */
export function pathHitsDenySegments(absPath: string, denySegments: string[]): string | null {
  if (!denySegments.length) return null;
  const parts = absPath.split(/[/\\]+/).filter(Boolean);
  const deny = new Set(denySegments.map((s) => s.toLowerCase()));
  for (const p of parts) {
    if (deny.has(p.toLowerCase())) return p;
  }
  return null;
}

function assertNotDenied(absPath: string, userPath: string, guard?: PathGuard | null): void {
  const deny = effectiveDenySegments(guard);
  const hit = pathHitsDenySegments(absPath, deny);
  if (hit) {
    throw new Error(
      `路径被流水线隔离策略拒绝（deny 段「${hit}」）: ${userPath}\n` +
        `金标/管理目录/历史结果不可读，避免 context leakage。` +
        `（关闭：unset MAOU_PIPELINE_ISOLATE；或从 MAOU_DENY_PATH_SEGMENTS 去掉该段）`,
    );
  }
}

/**
 * 从 ToolContext 解析用户路径。
 * 无 pathGuard 时行为与 safePath(workingDir|projectRoot, userPath) 一致。
 */
export function resolveToolPath(
  ctx: {
    workingDir?: string;
    projectRoot: string;
    pathGuard?: PathGuard;
  },
  userPath: string,
): ResolvedToolPath {
  const base = resolvePath(ctx.workingDir || ctx.projectRoot || process.cwd());
  const guard = ctx.pathGuard;

  // 无 guard / inherit → 单 root
  if (!guard || guard.mode === "inherit" || !guard.roots?.length) {
    const candidate = isAbsolute(userPath)
      ? resolvePath(userPath)
      : resolvePath(base, userPath);
    if (!isUnder(base, candidate)) {
      throw new Error(`路径越过了项目根目录: ${userPath}`);
    }
    assertNotDenied(candidate, userPath, guard);
    return { path: candidate, needsAudit: false, matchedRoot: base };
  }

  const primary = guard.roots.map((r) => normalizeRoot(r, base));
  const audit = (guard.auditRoots ?? []).map((r) => normalizeRoot(r, base));

  // 相对路径：先相对 workingDir/base 解析，再检查是否在允许根内
  // 绝对路径：直接检查
  const candidate = isAbsolute(userPath)
    ? resolvePath(userPath)
    : resolvePath(base, userPath);

  for (const root of primary) {
    if (isUnder(root, candidate)) {
      assertNotDenied(candidate, userPath, guard);
      return { path: candidate, needsAudit: false, matchedRoot: root };
    }
  }

  if (guard.mode === "audit") {
    for (const root of audit) {
      if (isUnder(root, candidate)) {
        assertNotDenied(candidate, userPath, guard);
        return { path: candidate, needsAudit: true, matchedRoot: root };
      }
    }
  }

  const allowed = [...primary, ...(guard.mode === "audit" ? audit : [])].join(", ");
  throw new Error(
    `路径越界（pathGuard.${guard.mode}）: ${userPath}\n允许根: ${allowed}`,
  );
}

/**
 * 兼容旧 API：单 root 安全解析。
 */
export function safePath(projectRoot: string, userPath: string): string {
  return resolveToolPath({ projectRoot, workingDir: projectRoot }, userPath).path;
}

/** 从 fork kind 策略构造 PathGuard */
export function pathGuardFromPolicy(opts: {
  permission?: string;
  path?: string;
  auditPaths?: string[];
  projectRoot?: string;
  denySegments?: string[];
}): PathGuard | undefined {
  const base = opts.projectRoot || process.cwd();
  const deny = opts.denySegments;
  if (opts.permission === "project_scoped_audit" && opts.path) {
    return {
      mode: "audit",
      roots: [normalizeRoot(opts.path, base)],
      auditRoots: (opts.auditPaths ?? []).map((p) => normalizeRoot(p, base)),
      denySegments: deny,
    };
  }
  if (opts.permission === "project_unrestricted" && opts.path) {
    // 主 path 优先，但 audit 路径也自由；无严格外禁 → hard 多 root
    return {
      mode: "hard",
      roots: [
        normalizeRoot(opts.path, base),
        ...(opts.auditPaths ?? []).map((p) => normalizeRoot(p, base)),
      ],
      denySegments: deny,
    };
  }
  if (opts.permission === "scoped_write" && opts.path) {
    return {
      mode: "hard",
      roots: [normalizeRoot(opts.path, base)],
      denySegments: deny,
    };
  }
  return undefined;
}

/**
 * 流水线运行时推荐的 inherit + deny 段（opt-in）。
 * 不收紧 roots，只禁止读金标/管理目录。
 */
export function pipelineIsolateGuard(projectRoot: string): PathGuard {
  return {
    mode: "inherit",
    roots: [resolvePath(projectRoot)],
    denySegments: [...DEFAULT_PIPELINE_DENY_SEGMENTS],
  };
}
