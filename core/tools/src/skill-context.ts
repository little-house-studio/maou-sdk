/**
 * Skill 上下文管理 —— 扫描、烘焙、增量注入
 *
 * 扫描路径（优先级从低到高，后扫描覆盖同名）：
 * 0. 系统 / NPM 全局（可选，默认开）：~/.agents/skills、~/.claude/skills
 * 1. 全局 maou：~/.maou/skills
 * 2. 项目：skills/、.agents/skills/、.maou/skills、.maou/skill
 * 3. Agent：project/.maou/agents/<agent>/{skill,skills}、~/.maou/agents/<agent>/{skill,skills}
 *
 * 功能：
 * - 烘焙：首轮将 skill 索引（name+description）注入 system
 * - 增量：检测增删改，在后续轮注入 <skill_update>
 * - use_skill：按 name 加载完整正文
 */

import { existsSync, readdirSync, statSync, readFileSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// ─── 类型定义 ─────────────────────────────────────────────────────────────

/** skill 来源层级 */
export type SkillSource = "system" | "global" | "project" | "agent";

export interface SkillEntry {
  name: string;
  description: string;
  version: string;
  content: string;
  sourcePath: string;
  source: SkillSource;
}

export interface SkillChange {
  added: string[];
  removed: string[];
  updated: string[];
}

export interface SkillContextResult {
  /** 烘焙内容（首轮注入 system） */
  bakedContent: string;
  /** 增量内容（变动时注入动态区） */
  incrementalContent: string;
  /** 当前所有 skill 列表 */
  currentSkills: Map<string, SkillEntry>;
  /** 是否有变动 */
  hasChanges: boolean;
}

/**
 * 扫描选项。
 * includeSystemNpmSkills 默认 true：扫描 npx skills -g 的常见全局目录。
 */
export interface SkillScanOptions {
  /**
   * 是否扫描系统/NPM 生态全局 skill 路径：
   *   ~/.agents/skills（npx skills -g 主路径）
   *   ~/.claude/skills（常为到 .agents 的 symlink）
   * 默认 true。
   */
  includeSystemNpmSkills?: boolean;
  /** 额外扫描目录（最低优先级，先扫；可被同名更高层覆盖） */
  extraDirs?: string[];
}

const DEFAULT_SCAN_OPTIONS: Required<Pick<SkillScanOptions, "includeSystemNpmSkills">> & {
  extraDirs: string[];
} = {
  includeSystemNpmSkills: true,
  extraDirs: [],
};

/** 模块级默认（Agent 层 createSkillManager / setDefaultSkillScanOptions 写入；use_skill 读取） */
let _defaultScanOptions: SkillScanOptions = { ...DEFAULT_SCAN_OPTIONS };

/** Agent / bootstrap 设置全局默认扫描选项（影响后续 new SkillContextManager 与 use_skill） */
export function setDefaultSkillScanOptions(opts: SkillScanOptions): void {
  _defaultScanOptions = {
    ..._defaultScanOptions,
    ...opts,
    extraDirs: opts.extraDirs ?? _defaultScanOptions.extraDirs,
  };
}

export function getDefaultSkillScanOptions(): SkillScanOptions {
  return {
    includeSystemNpmSkills: _defaultScanOptions.includeSystemNpmSkills !== false,
    extraDirs: [...(_defaultScanOptions.extraDirs ?? [])],
  };
}

/** 解析合并扫描选项（env MAOU_INCLUDE_SYSTEM_SKILLS=0|false 可强制关系统路径） */
export function resolveSkillScanOptions(opts?: SkillScanOptions): Required<SkillScanOptions> {
  const base = getDefaultSkillScanOptions();
  const env = process.env.MAOU_INCLUDE_SYSTEM_SKILLS;
  let includeSystem =
    opts?.includeSystemNpmSkills ??
    base.includeSystemNpmSkills ??
    true;
  if (env === "0" || env === "false" || env === "off") {
    includeSystem = false;
  } else if (env === "1" || env === "true" || env === "on") {
    includeSystem = true;
  }
  return {
    includeSystemNpmSkills: includeSystem,
    extraDirs: [...(base.extraDirs ?? []), ...(opts?.extraDirs ?? [])],
  };
}

// ─── SkillScanner ─────────────────────────────────────────────────────────

/**
 * Skill 扫描器 —— 多层级合并（后扫覆盖先扫 = 更高优先级）
 */
export class SkillScanner {
  private projectRoot: string;
  private maouRoot: string;
  private agentName: string;
  private scanOptions: Required<SkillScanOptions>;

  constructor(
    agentName: string,
    projectRoot: string,
    maouRoot?: string,
    scanOptions?: SkillScanOptions,
  ) {
    this.agentName = agentName;
    this.projectRoot = projectRoot;
    this.maouRoot = maouRoot || join(homedir(), ".maou");
    this.scanOptions = resolveSkillScanOptions(scanOptions);
  }

  /** 当前生效的扫描选项（只读） */
  get options(): Readonly<Required<SkillScanOptions>> {
    return this.scanOptions;
  }

  /**
   * 扫描所有 skill，按优先级合并。
   * @param agentName 覆盖构造时的 agent（getSkillContent 等应始终带 agent）
   */
  scanAll(agentName?: string): Map<string, SkillEntry> {
    const skills = new Map<string, SkillEntry>();
    const agent = agentName ?? this.agentName;
    const home = homedir();

    // ── 0. 额外目录（最低）──
    for (const dir of this.scanOptions.extraDirs) {
      if (dir) this.scanDirectory(dir, "system", skills);
    }

    // ── 1. 系统 / NPM 全局（npx skills -g）──
    if (this.scanOptions.includeSystemNpmSkills) {
      this.scanDirectory(join(home, ".agents", "skills"), "system", skills);
      // ~/.claude/skills 常为 symlink 到 .agents；按 realpath 去重，避免重复解析
      this.scanDirectory(join(home, ".claude", "skills"), "system", skills);
    }

    // ── 2. maou 全局 ~/.maou/skills ──
    this.scanDirectory(join(this.maouRoot, "skills"), "global", skills);

    // ── 3. 项目级 ──
    this.scanDirectory(join(this.projectRoot, "skills"), "project", skills);
    // npx skills 项目安装常见路径
    this.scanDirectory(join(this.projectRoot, ".agents", "skills"), "project", skills);
    // find_skill 安装目标：.maou/skills（复数）；兼容历史 .maou/skill（单数）
    this.scanDirectory(join(this.projectRoot, ".maou", "skills"), "project", skills);
    this.scanDirectory(join(this.projectRoot, ".maou", "skill"), "project", skills);

    // ── 4. Agent 级（最高）──
    if (agent) {
      // 项目物化 agent：.maou/agents/<name>/
      for (const sub of ["skills", "skill"] as const) {
        this.scanDirectory(
          join(this.projectRoot, ".maou", "agents", agent, sub),
          "agent",
          skills,
        );
      }
      // 全局 agent：~/.maou/agents/<name>/
      for (const sub of ["skills", "skill"] as const) {
        this.scanDirectory(
          join(this.maouRoot, "agents", agent, sub),
          "agent",
          skills,
        );
      }
    }

    return skills;
  }

  private scanDirectory(
    dir: string,
    source: SkillSource,
    skills: Map<string, SkillEntry>,
  ): void {
    if (!existsSync(dir)) return;

    let realDir = dir;
    try {
      realDir = realpathSync(dir);
    } catch {
      realDir = dir;
    }

    try {
      const entries = readdirSync(realDir).sort();
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const fullPath = join(realDir, entry);
        try {
          if (!statSync(fullPath).isDirectory()) continue;
        } catch {
          continue;
        }

        const skillFile = join(fullPath, "SKILL.md");
        if (!existsSync(skillFile)) continue;

        const skill = this.parseSkillFile(skillFile, source);
        if (skill) {
          skills.set(skill.name, skill);
        }
      }
    } catch {
      // 目录读取失败，静默跳过
    }
  }

  private parseSkillFile(path: string, source: SkillSource): SkillEntry | null {
    try {
      const content = readFileSync(path, "utf-8");
      const { meta, body } = this.parseFrontmatter(content);

      const name = (meta.name || this.extractNameFromPath(path) || "").trim();
      if (!name) return null;

      return {
        name,
        description: meta.description || "",
        version: meta.version || "1.0.0",
        content: body.trim(),
        sourcePath: path,
        source,
      };
    } catch {
      return null;
    }
  }

  private parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
    const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) return { meta: {}, body: text.trim() };

    const meta: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        // 跳过嵌套 yaml 缩进行（metadata: 子字段）
        if (key.startsWith(" ") || key.startsWith("\t") || line.match(/^\s/)) continue;
        let value = line.slice(colonIdx + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        meta[key] = value;
      }
    }
    return { meta, body: match[2].trim() };
  }

  /**
   * 从路径提取 skill 名称：SKILL.md 的父目录名。
   * 兼容 .../skills/foo/SKILL.md 与 .../skill/foo/SKILL.md。
   */
  private extractNameFromPath(path: string): string | null {
    const parts = path.split(/[/\\]/).filter(Boolean);
    const file = parts[parts.length - 1] ?? "";
    if (file.toLowerCase() === "skill.md" && parts.length >= 2) {
      return parts[parts.length - 2];
    }
    // 任意 .../name/SKILL.md
    const skillMdIdx = parts.findIndex((p) => p.toLowerCase() === "skill.md");
    if (skillMdIdx > 0) return parts[skillMdIdx - 1];
    return null;
  }
}

// ─── SkillContextManager ──────────────────────────────────────────────────

/**
 * Skill 上下文管理器 —— 烘焙和增量注入
 */
export class SkillContextManager {
  private scanner: SkillScanner;
  private previousSkills: Map<string, SkillEntry> = new Map();
  private enabledSkills: Set<string> = new Set();
  private isFirstRound = true;
  private agentName: string;
  private projectRoot: string;
  private maouRoot: string;
  private scanOptions: SkillScanOptions;

  constructor(
    agentName: string,
    projectRoot: string,
    maouRoot?: string,
    scanOptions?: SkillScanOptions,
  ) {
    this.agentName = agentName;
    this.projectRoot = projectRoot;
    this.maouRoot = maouRoot || join(homedir(), ".maou");
    this.scanOptions = scanOptions ?? getDefaultSkillScanOptions();
    this.scanner = new SkillScanner(
      agentName,
      projectRoot,
      this.maouRoot,
      this.scanOptions,
    );
  }

  get maouRootPath(): string {
    return this.maouRoot;
  }

  get projectRootPath(): string {
    return this.projectRoot;
  }

  get agent(): string {
    return this.agentName;
  }

  /** 设置启用的 skill 白名单；空 = 全部启用；含 "*" = 全部 */
  setEnabledSkills(skillNames: string[]): void {
    this.enabledSkills = new Set(skillNames);
  }

  /** 编译 skill 上下文（烘焙 + 增量） */
  compile(): SkillContextResult {
    const allSkills = this.scanner.scanAll(this.agentName);

    const currentSkills = new Map<string, SkillEntry>();
    for (const [name, entry] of allSkills) {
      if (
        this.enabledSkills.size === 0 ||
        this.enabledSkills.has(name) ||
        this.enabledSkills.has("*")
      ) {
        currentSkills.set(name, entry);
      }
    }

    const changes = this.detectChanges(currentSkills);
    const hasChanges =
      changes.added.length > 0 ||
      changes.removed.length > 0 ||
      changes.updated.length > 0;

    let bakedContent = "";
    let incrementalContent = "";

    if (this.isFirstRound) {
      bakedContent = this.generateBakedContent(currentSkills);
      this.isFirstRound = false;
    } else if (hasChanges) {
      incrementalContent = this.generateIncrementalContent(changes, currentSkills);
    }

    this.previousSkills = new Map(currentSkills);

    return {
      bakedContent,
      incrementalContent,
      currentSkills,
      hasChanges,
    };
  }

  private detectChanges(current: Map<string, SkillEntry>): SkillChange {
    const changes: SkillChange = { added: [], removed: [], updated: [] };

    for (const [name, entry] of current) {
      if (!this.previousSkills.has(name)) {
        changes.added.push(name);
      } else {
        const prev = this.previousSkills.get(name)!;
        if (prev.content !== entry.content || prev.version !== entry.version) {
          changes.updated.push(name);
        }
      }
    }

    for (const name of this.previousSkills.keys()) {
      if (!current.has(name)) {
        changes.removed.push(name);
      }
    }

    return changes;
  }

  private generateBakedContent(skills: Map<string, SkillEntry>): string {
    if (skills.size === 0) return "";

    const parts: string[] = ["<available_skills>"];
    parts.push(
      `以下 ${skills.size} 个技能**可用但尚未加载**。遇到相关任务时，先用 \`use_skill\` 工具按 name 加载该技能完整内容再操作（不相关无需加载）：`,
    );
    parts.push("");

    // 稳定排序，避免 map 迭代顺序抖动导致 system prompt 缓存失效
    const sorted = [...skills.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, entry] of sorted) {
      const desc = entry.description ? entry.description : "(无描述)";
      parts.push(`- **${name}** — ${desc} [${entry.source}]`);
    }

    parts.push("</available_skills>");
    return parts.join("\n");
  }

  private generateIncrementalContent(
    changes: SkillChange,
    current: Map<string, SkillEntry>,
  ): string {
    const parts: string[] = ["<skill_update>", ""];

    if (changes.added.length > 0) {
      parts.push("  <added>");
      for (const name of changes.added) {
        const entry = current.get(name);
        if (entry) {
          parts.push(`    - ${name}: ${entry.description || "无描述"} [${entry.source}]`);
        }
      }
      parts.push("  </added>");
    }

    if (changes.removed.length > 0) {
      parts.push("  <removed>");
      for (const name of changes.removed) {
        parts.push(`    - ${name}`);
      }
      parts.push("  </removed>");
    }

    if (changes.updated.length > 0) {
      parts.push("  <updated>");
      for (const name of changes.updated) {
        const entry = current.get(name);
        if (entry) {
          parts.push(
            `    - ${name}: ${entry.description || "无描述"} (v${entry.version})`,
          );
        }
      }
      parts.push("  </updated>");
    }

    parts.push("");
    parts.push("</skill_update>");
    return parts.join("\n");
  }

  /**
   * 获取指定 skill 的完整内容（始终带 agentName，与列表扫描同口径）
   */
  getSkillContent(name: string): string | null {
    const skills = this.scanner.scanAll(this.agentName);
    const entry = skills.get(name);
    return entry ? entry.content : null;
  }

  /** 按名取完整 entry（含 sourcePath） */
  getSkillEntry(name: string): SkillEntry | null {
    const skills = this.scanner.scanAll(this.agentName);
    return skills.get(name) ?? null;
  }

  /** 列出所有可用 skill（与 bake 过滤规则一致时由调用方再滤 enabled） */
  listAvailableSkills(): SkillEntry[] {
    const skills = this.scanner.scanAll(this.agentName);
    const list = [...skills.values()];
    if (this.enabledSkills.size === 0 || this.enabledSkills.has("*")) {
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list
      .filter((s) => this.enabledSkills.has(s.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 重置状态（新会话 / 新 run） */
  reset(): void {
    this.previousSkills = new Map();
    this.isFirstRound = true;
  }
}

/** 系统 NPM 全局 skill 的默认目录列表（供文档 / CLI 展示） */
export function getSystemNpmSkillDirs(home = homedir()): string[] {
  return [join(home, ".agents", "skills"), join(home, ".claude", "skills")];
}

/** 从 SKILL.md 路径解析目录名（测试与工具共用） */
export function skillNameFromPath(skillMdPath: string): string | null {
  const parent = dirname(skillMdPath);
  const base = parent.split(/[/\\]/).filter(Boolean).pop();
  return base ?? null;
}
