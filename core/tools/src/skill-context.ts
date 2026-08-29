/**
 * Skill 上下文管理 —— 扫描、写入文件缓存区、diff 进上下文动态区
 *
 * 扫描路径（优先级从低到高，后扫描覆盖同名）：
 * 0. 系统 / NPM 全局（可选，默认开）：~/.agents/skills、~/.claude/skills
 * 1. 全局 maou：~/.maou/skills
 * 2. 项目：skills/、.agents/skills/、.maou/skills、.maou/skill
 * 3. Agent：先扫 ~/.maou/agents/<agent>/{skills,skill}，最后扫项目 .maou/agents/<agent>/
 *
 * 功能：
 * - 文件缓存区：首轮将 skill 索引（name+description）写入稳定前缀（缓存断点之前）
 * - 上下文动态区：检测增删改，后续轮注入 <skill_update>
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
  /** 仅用户菜单可点，模型 use_skill 拒 */
  userInvocableOnly?: boolean;
  /** 缺其中任一可用工具则说明书不进模型目录 */
  requiredTools?: string[];
}

export interface SkillChange {
  added: string[];
  removed: string[];
  updated: string[];
}

/**
 * 单条技能描述进目录时的上限。
 *
 * 目录本身是稳定前缀里的常驻开销，几十个技能各写几千字就把窗口吃光了；
 * 完整正文由 use_skill 按需加载。
 */
export const SKILL_DESCRIPTION_MAX_CHARS = 500;

export function clipSkillDescription(desc: string): string {
  const text = desc.replace(/\s+/g, " ").trim();
  if (text.length <= SKILL_DESCRIPTION_MAX_CHARS) return text;
  return `${text.slice(0, SKILL_DESCRIPTION_MAX_CHARS)}…（描述已截断，use_skill 加载可看全文）`;
}

/** 目录变空时的作废声明：没有它，模型历史里的旧名单永远有效。 */
export const EMPTY_SKILL_CATALOG_LINE =
  "当前没有可用技能。本条整份替换旧名单，请勿使用早前名单里的任何技能名。";

export const EMPTY_SKILL_CATALOG = `<available_skills>\n${EMPTY_SKILL_CATALOG_LINE}\n</available_skills>`;

export interface SkillContextResult {
  /** 文件缓存区（首轮写入稳定前缀，缓存断点之前） */
  bakedContent: string;
  /** 上下文动态区（变动时的 <skill_update>） */
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
let _defaultAvailableTools: Set<string> | null = null;

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

export type SkillScanRoot = { dir: string; source: SkillSource };

/** CLI / App 菜单与 SkillScanner 同一套目录、同一先后（后扫覆盖）。 */
export function listSkillScanRoots(opts: {
  projectRoot: string;
  maouRoot?: string;
  agentName?: string;
  home?: string;
  includeSystemNpmSkills?: boolean;
  extraDirs?: string[];
}): SkillScanRoot[] {
  const home = opts.home ?? homedir();
  const resolved = resolveSkillScanOptions({
    includeSystemNpmSkills: opts.includeSystemNpmSkills,
    extraDirs: opts.extraDirs,
  });
  const maouRoot = opts.maouRoot || join(home, ".maou");
  const roots: SkillScanRoot[] = [];
  for (const dir of resolved.extraDirs) {
    if (dir) roots.push({ dir, source: "system" });
  }
  if (resolved.includeSystemNpmSkills) {
    for (const dir of getSystemNpmSkillDirs(home)) {
      roots.push({ dir, source: "system" });
    }
  }
  roots.push({ dir: join(maouRoot, "skills"), source: "global" });
  roots.push({ dir: join(opts.projectRoot, "skills"), source: "project" });
  roots.push({ dir: join(opts.projectRoot, ".agents", "skills"), source: "project" });
  roots.push({ dir: join(opts.projectRoot, ".maou", "skills"), source: "project" });
  roots.push({ dir: join(opts.projectRoot, ".maou", "skill"), source: "project" });
  const agent = (opts.agentName ?? "").trim();
  if (agent) {
    for (const sub of ["skills", "skill"] as const) {
      roots.push({ dir: join(maouRoot, "agents", agent, sub), source: "agent" });
    }
    for (const sub of ["skills", "skill"] as const) {
      roots.push({
        dir: join(opts.projectRoot, ".maou", "agents", agent, sub),
        source: "agent",
      });
    }
  }
  return roots;
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
    for (const { dir, source } of listSkillScanRoots({
      projectRoot: this.projectRoot,
      maouRoot: this.maouRoot,
      agentName: agent,
      includeSystemNpmSkills: this.scanOptions.includeSystemNpmSkills,
      extraDirs: this.scanOptions.extraDirs,
    })) {
      this.scanDirectory(dir, source, skills);
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
      const userInvocableOnly =
        parseFrontmatterFlag(meta["user_invocable"]) ||
        parseFrontmatterFlag(meta["disable-model-invocation"]);
      const requiredTools = parseFrontmatterList(
        meta["required-tools"] ?? meta["requiredTools"] ?? meta["allowed-tools"],
      );

      return {
        name,
        description: meta.description || "",
        version: meta.version || "1.0.0",
        content: body.trim(),
        sourcePath: path,
        source,
        userInvocableOnly: userInvocableOnly || undefined,
        requiredTools: requiredTools.length ? requiredTools : undefined,
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
 * Skill 上下文管理器 —— 文件缓存区 + 上下文动态区
 */
export class SkillContextManager {
  private scanner: SkillScanner;
  private previousSkills: Map<string, SkillEntry> = new Map();
  private enabledSkills: Set<string> = new Set();
  private availableTools: Set<string> | null = _defaultAvailableTools;
  private isFirstRound = true;
  /** 是否已经给模型报过一份非空名单（决定要不要显式作废） */
  private announcedSkills = false;
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

  /** 当前模型可见工具。设了之后缺 required-tools 的技能退出说明书。 */
  setAvailableTools(names: string[] | null | undefined): void {
    this.availableTools = names && names.length ? new Set(names) : null;
    _defaultAvailableTools = this.availableTools;
  }

  /** 编译 skill 上下文（文件缓存区首轮 + 上下文动态区增量） */
  compile(): SkillContextResult {
    const allSkills = this.scanner.scanAll(this.agentName);

    const currentSkills = new Map<string, SkillEntry>();
    for (const [name, entry] of allSkills) {
      if (
        this.enabledSkills.size > 0 &&
        !this.enabledSkills.has(name) &&
        !this.enabledSkills.has("*")
      ) {
        continue;
      }
      if (!skillVisibleToModel(entry, this.availableTools)) continue;
      currentSkills.set(name, entry);
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

  /** 生成文件缓存区 skill 索引（稳定前缀，缓存断点之前） */
  private generateBakedContent(skills: Map<string, SkillEntry>): string {
    // 从没报过名单就不必声明"没有技能"——历史里没有旧名单要作废
    if (skills.size === 0) return this.announcedSkills ? EMPTY_SKILL_CATALOG : "";
    this.announcedSkills = true;

    const parts: string[] = ["<available_skills>"];
    parts.push(
      `以下 ${skills.size} 个技能**可用但尚未加载**。遇到相关任务时，先用 \`use_skill\` 工具按 name 加载该技能完整内容再操作（不相关无需加载）：`,
    );
    parts.push("");

    // 稳定排序，避免顺序抖动改写文件缓存区（= 缓存破坏）
    const sorted = [...skills.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, entry] of sorted) {
      const desc = entry.description ? clipSkillDescription(entry.description) : "(无描述)";
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
          const desc = entry.description ? clipSkillDescription(entry.description) : "无描述";
          parts.push(`    - ${name}: ${desc} [${entry.source}]`);
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
          const desc = entry.description ? clipSkillDescription(entry.description) : "无描述";
          parts.push(`    - ${name}: ${desc} (v${entry.version})`);
        }
      }
      parts.push("  </updated>");
    }

    parts.push("");
    if (current.size === 0) {
      parts.push(EMPTY_SKILL_CATALOG_LINE);
    } else {
      parts.push("本目录整份替换旧名单。请勿继续使用已移除的技能名。");
    }
    parts.push("</skill_update>");
    return parts.join("\n");
  }

  /**
   * 获取指定 skill 的完整内容（始终带 agentName，与列表扫描同口径）
   */
  getSkillContent(name: string): string | null {
    const entry = this.getSkillEntry(name);
    return entry ? entry.content : null;
  }

  /** 按名取完整 entry（含 sourcePath）。模型侧走同一过滤。 */
  getSkillEntry(name: string): SkillEntry | null {
    const skills = this.scanner.scanAll(this.agentName);
    const entry = skills.get(name);
    if (!entry) return null;
    if (
      this.enabledSkills.size > 0 &&
      !this.enabledSkills.has(name) &&
      !this.enabledSkills.has("*")
    ) {
      return null;
    }
    if (!skillVisibleToModel(entry, this.availableTools)) return null;
    return entry;
  }

  /** 未过滤的原条目（use_skill 用来区分「仅用户可点」） */
  peekSkillEntry(name: string): SkillEntry | null {
    return this.scanner.scanAll(this.agentName).get(name) ?? null;
  }

  /** 列出模型可用 skill */
  listAvailableSkills(): SkillEntry[] {
    const skills = this.scanner.scanAll(this.agentName);
    const list = [...skills.values()].filter((s) => {
      if (
        this.enabledSkills.size > 0 &&
        !this.enabledSkills.has(s.name) &&
        !this.enabledSkills.has("*")
      ) {
        return false;
      }
      return skillVisibleToModel(s, this.availableTools);
    });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 菜单：含仅用户可点，不含缺工具的说明书 */
  listMenuSkills(): SkillEntry[] {
    const skills = this.scanner.scanAll(this.agentName);
    return [...skills.values()]
      .filter((s) => !skillMissingRequiredTools(s, this.availableTools))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 重置状态（新会话 / 新 run） */
  reset(): void {
    this.previousSkills = new Map();
    this.isFirstRound = true;
    this.announcedSkills = false;
  }
}

/** 系统 NPM 全局 skill 的默认目录列表（供文档 / CLI 展示） */
export function getSystemNpmSkillDirs(home = homedir()): string[] {
  return [join(home, ".agents", "skills"), join(home, ".claude", "skills")];
}

function parseFrontmatterFlag(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "true" || v === "yes" || v === "1" || v === "on";
}

function parseFrontmatterList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,[\]\s]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== "-" && !s.startsWith("["));
}

export function skillMissingRequiredTools(
  entry: SkillEntry,
  available: ReadonlySet<string> | null | undefined,
): boolean {
  if (!entry.requiredTools?.length || !available || available.size === 0) return false;
  return entry.requiredTools.some((t) => !available.has(t));
}

export function skillVisibleToModel(
  entry: SkillEntry,
  availableTools?: ReadonlySet<string> | null,
): boolean {
  if (entry.userInvocableOnly) return false;
  if (skillMissingRequiredTools(entry, availableTools)) return false;
  return true;
}

/** 从 SKILL.md 路径解析目录名（测试与工具共用） */
export function skillNameFromPath(skillMdPath: string): string | null {
  const parent = dirname(skillMdPath);
  const base = parent.split(/[/\\]/).filter(Boolean).pop();
  return base ?? null;
}
