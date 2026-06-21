/**
 * SDK 技能系统 — Markdown 提示模板
 * 对齐 Python: sdk/skill.py
 *
 * 技能 = Markdown 文件 + YAML frontmatter 元数据。
 * 可被 Agent Runtime 动态加载，注入到 system prompt 中。
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";

// ─── Skill 接口 ────────────────────────────────────────────────────────────

/** 技能定义 */
export interface Skill {
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** Markdown 提示模板 */
  promptTemplate: string;
  /** 依赖的工具列表 */
  requiredTools: string[];
  /** 版本号 */
  version: string;
  /** 来源文件路径 */
  sourcePath: string;
}

/**
 * 渲染技能提示模板
 * 将 {{variable}} 替换为 context 中的值
 */
export function renderSkill(skill: Skill, context?: Record<string, string>): string {
  if (!context) return skill.promptTemplate;
  let result = skill.promptTemplate;
  for (const [key, value] of Object.entries(context)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

// ─── 解析 SKILL.md ─────────────────────────────────────────────────────────

/**
 * 解析技能文件（Markdown + YAML frontmatter）
 *
 * 文件格式:
 * ```
 * ---
 * name: 代码审查
 * description: 审查代码质量
 * required_tools: [read, bash]
 * version: 1.0.0
 * ---
 * # 代码审查技能
 *
 * 请按照以下步骤审查代码...
 * ```
 */
export function parseSkillFile(path: string): Skill | null {
  try {
    const content = readFileSync(path, "utf-8");
    const stem = basename(path, extname(path));

    // 解析 YAML frontmatter
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)/);
    if (!match) {
      // 没有 frontmatter，整个文件作为 prompt
      return {
        name: stem,
        description: "",
        promptTemplate: content,
        requiredTools: [],
        version: "1.0.0",
        sourcePath: path,
      };
    }

    const frontmatterStr = match[1];
    const body = match[2];

    // 简单 YAML 解析（不依赖 yaml 库）
    const meta: Record<string, unknown> = {};
    for (const line of frontmatterStr.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      let value: unknown = trimmed.slice(colonIdx + 1).trim();
      // 处理列表 [a, b, c]
      if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
        value = value
          .slice(1, -1)
          .split(",")
          .map((v) => v.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      }
      meta[key] = value;
    }

    return {
      name: (meta.name as string) ?? stem,
      description: (meta.description as string) ?? "",
      promptTemplate: body.trim(),
      requiredTools: Array.isArray(meta.required_tools)
        ? (meta.required_tools as string[])
        : [],
      version: (meta.version as string) ?? "1.0.0",
      sourcePath: path,
    };
  } catch (e) {
    console.warn(`[sdk] 读取技能文件失败 ${path}:`, e);
    return null;
  }
}

// ─── SkillRegistry ─────────────────────────────────────────────────────────

/** 技能注册表 */
export class SkillRegistry {
  private _skills = new Map<string, Skill>();

  /** 从目录加载所有 .md 技能文件 */
  loadFromDirectory(directory: string): number {
    if (!existsSync(directory)) return 0;

    let count = 0;
    const entries = readdirSync(directory).sort();
    for (const entry of entries) {
      if (extname(entry) !== ".md") continue;
      const fullPath = join(directory, entry);
      const skill = parseSkillFile(fullPath);
      if (skill) {
        this._skills.set(skill.name, skill);
        count++;
        console.log(`[sdk] 技能已加载: ${skill.name} (${entry})`);
      }
    }
    return count;
  }

  /** 手动注册技能 */
  register(skill: Skill): void {
    this._skills.set(skill.name, skill);
  }

  /** 获取技能 */
  get(name: string): Skill | undefined {
    return this._skills.get(name);
  }

  /** 列出所有技能 */
  listAll(): Skill[] {
    return [...this._skills.values()];
  }

  /** 渲染所有技能的提示模板，拼接为一个字符串 */
  renderAll(context?: Record<string, string>): string {
    const parts: string[] = [];
    for (const skill of this._skills.values()) {
      const rendered = renderSkill(skill, context);
      if (rendered) parts.push(rendered);
    }
    return parts.join("\n\n---\n\n");
  }

  /** 技能数量 */
  get count(): number {
    return this._skills.size;
  }
}
