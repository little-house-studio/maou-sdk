/**
 * Skill 上下文管理 —— 扫描、烘焙、增量注入
 *
 * 扫描路径（优先级从高到低）：
 * 1. Agent 所属 .maou/skills/
 * 2. 项目内置 skills/
 * 3. 全局 npx skills 默认路径
 *
 * 功能：
 * - 烘焙：首轮将 skill 内容注入到 user 消息部分
 * - 增量注入：检测变动，在下一轮插入变更通知
 */

import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── 类型定义 ─────────────────────────────────────────────────────────────

export interface SkillEntry {
  name: string;
  description: string;
  version: string;
  content: string;
  sourcePath: string;
  source: "global" | "project" | "agent";  // 来源层级
}

export interface SkillChange {
  added: string[];
  removed: string[];
  updated: string[];
}

export interface SkillContextResult {
  /** 烘焙内容（首轮注入） */
  bakedContent: string;
  /** 增量内容（变动时注入） */
  incrementalContent: string;
  /** 当前所有 skill 列表 */
  currentSkills: Map<string, SkillEntry>;
  /** 是否有变动 */
  hasChanges: boolean;
}

// ─── SkillScanner ─────────────────────────────────────────────────────────

/**
 * Skill 扫描器 —— 从三个层级扫描 skill
 */
export class SkillScanner {
  private projectRoot: string;
  private maouRoot: string;

  constructor(agentName: string, projectRoot: string, maouRoot?: string) {
    this.projectRoot = projectRoot;
    this.maouRoot = maouRoot || join(homedir(), ".maou");
    // agentName 保留用于后续扩展（如 agent 级别的 skill 配置）
    void agentName;
  }

  /**
   * 扫描所有 skill，按优先级合并
   * 优先级（高 → 低）：
   * 1. Agent 所属 .maou/agents/<agent>/skill/
   * 2. 项目 .maou/skill/
   * 3. 项目 skills/
   * 4. 全局 ~/.maou/skills/
   * （后者覆盖前者同名）
   */
  scanAll(agentName?: string): Map<string, SkillEntry> {
    const skills = new Map<string, SkillEntry>();

    // 4. 全局 ~/.maou/skills/（最低优先级）
    this.scanDirectory(join(this.maouRoot, "skills"), "global", skills);

    // 3. 项目内置 skills/
    this.scanDirectory(join(this.projectRoot, "skills"), "project", skills);

    // 2. 项目 .maou/skill/（新增）
    this.scanDirectory(join(this.projectRoot, ".maou", "skill"), "project", skills);

    // 1. Agent 所属 .maou/agents/<agent>/skill/（最高优先级）
    if (agentName) {
      this.scanDirectory(
        join(this.maouRoot, "agents", agentName, "skill"),
        "agent",
        skills
      );
    }

    return skills;
  }

  /**
   * 扫描单个目录
   */
  private scanDirectory(dir: string, source: "global" | "project" | "agent", skills: Map<string, SkillEntry>): void {
    if (!existsSync(dir)) return;

    try {
      const entries = readdirSync(dir).sort();
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        try {
          if (!statSync(fullPath).isDirectory()) continue;
        } catch {
          continue;
        }

        const skillFile = join(fullPath, "SKILL.md");
        if (!existsSync(skillFile)) continue;

        const skill = this.parseSkillFile(skillFile, source);
        if (skill) {
          // 后扫描的覆盖先扫描的（优先级高的覆盖低的）
          skills.set(skill.name, skill);
        }
      }
    } catch {
      // 目录读取失败，静默跳过
    }
  }

  /**
   * 解析 SKILL.md 文件
   */
  private parseSkillFile(path: string, source: "global" | "project" | "agent"): SkillEntry | null {
    try {
      const content = readFileSync(path, "utf-8");
      const { meta, body } = this.parseFrontmatter(content);

      const name = meta.name || this.extractNameFromPath(path);
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

  /**
   * 解析 YAML frontmatter
   */
  private parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
    const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) return { meta: {}, body: text.trim() };

    const meta: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        // 去除引号
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        meta[key] = value;
      }
    }
    return { meta, body: match[2].trim() };
  }

  /**
   * 从路径提取 skill 名称
   */
  private extractNameFromPath(path: string): string | null {
    const parts = path.split(/[/\\]/);
    const skillsIdx = parts.lastIndexOf("skills");
    if (skillsIdx >= 0 && skillsIdx < parts.length - 2) {
      return parts[skillsIdx + 1];
    }
    return null;
  }
}

// ─── SkillContextManager ──────────────────────────────────────────────────

/**
 * Skill 上下文管理器 —— 烘焙和增量注入
 */
export class SkillContextManager {
  private scanner: SkillScanner;
  /** 上一次的 skill 列表（用于检测变动） */
  private previousSkills: Map<string, SkillEntry> = new Map();
  /** 当前启用的 skill 名称列表 */
  private enabledSkills: Set<string> = new Set();
  /** 是否首轮 */
  private isFirstRound: boolean = true;

  private agentName: string;

  constructor(agentName: string, projectRoot: string, maouRoot?: string) {
    this.agentName = agentName;
    this.scanner = new SkillScanner(agentName, projectRoot, maouRoot);
  }

  /**
   * 设置启用的 skill 列表
   */
  setEnabledSkills(skillNames: string[]): void {
    this.enabledSkills = new Set(skillNames);
  }

  /**
   * 编译 skill 上下文（烘焙 + 增量）
   */
  compile(): SkillContextResult {
    // 扫描所有 skill（传入 agentName）
    const allSkills = this.scanner.scanAll(this.agentName);

    // 过滤出启用的 skill
    const currentSkills = new Map<string, SkillEntry>();
    for (const [name, entry] of allSkills) {
      if (this.enabledSkills.size === 0 || this.enabledSkills.has(name) || this.enabledSkills.has("*")) {
        currentSkills.set(name, entry);
      }
    }

    // 检测变动
    const changes = this.detectChanges(currentSkills);
    const hasChanges = changes.added.length > 0 || changes.removed.length > 0 || changes.updated.length > 0;

    // 生成内容
    let bakedContent = "";
    let incrementalContent = "";

    if (this.isFirstRound) {
      // 首轮：烘焙所有 skill
      bakedContent = this.generateBakedContent(currentSkills);
      this.isFirstRound = false;
    } else if (hasChanges) {
      // 非首轮但有变动：增量注入
      incrementalContent = this.generateIncrementalContent(changes, currentSkills);
    }

    // 更新上一次列表
    this.previousSkills = new Map(currentSkills);

    return {
      bakedContent,
      incrementalContent,
      currentSkills,
      hasChanges,
    };
  }

  /**
   * 检测 skill 变动
   */
  private detectChanges(current: Map<string, SkillEntry>): SkillChange {
    const changes: SkillChange = { added: [], removed: [], updated: [] };

    // 新增和更新
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

    // 移除
    for (const name of this.previousSkills.keys()) {
      if (!current.has(name)) {
        changes.removed.push(name);
      }
    }

    return changes;
  }

  /**
   * 生成烘焙内容（首轮注入）
   */
  private generateBakedContent(skills: Map<string, SkillEntry>): string {
    if (skills.size === 0) return "";

    const parts: string[] = ["<available_skills>"];
    parts.push(`以下 ${skills.size} 个技能**可用但尚未加载**。遇到相关任务时，先用 \`use_skill\` 工具按 name 加载该技能完整内容再操作（不相关无需加载）：`);
    parts.push("");

    for (const [name, entry] of skills) {
      const desc = entry.description ? entry.description : "(无描述)";
      parts.push(`- **${name}** — ${desc} [${entry.source}]`);
    }

    parts.push("</available_skills>");
    return parts.join("\n");
  }

  /**
   * 生成增量内容（变动时注入）
   */
  private generateIncrementalContent(changes: SkillChange, current: Map<string, SkillEntry>): string {
    const parts: string[] = ["<skill_update>", ""];

    if (changes.added.length > 0) {
      parts.push("  <added>");
      for (const name of changes.added) {
        const entry = current.get(name);
        if (entry) {
          parts.push(`    - ${name}: ${entry.description || "无描述"}`);
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
          parts.push(`    - ${name}: ${entry.description || "无描述"} (v${entry.version})`);
        }
      }
      parts.push("  </updated>");
    }

    parts.push("");
    parts.push("</skill_update>");
    return parts.join("\n");
  }

  /**
   * 获取指定 skill 的完整内容
   */
  getSkillContent(name: string): string | null {
    const skills = this.scanner.scanAll();
    const entry = skills.get(name);
    return entry ? entry.content : null;
  }

  /**
   * 列出所有可用 skill
   */
  listAvailableSkills(): SkillEntry[] {
    const skills = this.scanner.scanAll();
    return [...skills.values()];
  }

  /**
   * 重置状态（用于新会话）
   */
  reset(): void {
    this.previousSkills = new Map();
    this.isFirstRound = true;
  }
}
