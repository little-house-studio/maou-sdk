/**
 * Load Skill 工具 — 加载专业知识
 * 对应 Python: core/tools/impls/skill_tool.py
 *
 * 从 skills/ 目录加载 SKILL.md 文件（含 YAML frontmatter）。
 * 支持三级扫描：全局 ~/.maou/skills + 项目 skills/ + agent .maou/skills
 */

import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { SkillContextManager } from "../../skill-context.js";

// ─── 全局 SkillContextManager 实例 ─────────────────────────────────────────

let skillManager: SkillContextManager | null = null;

function getSkillManager(ctx: ToolContext): SkillContextManager {
  if (!skillManager) {
    skillManager = new SkillContextManager(
      ctx.agentName || "default",
      ctx.projectRoot,
      ctx.sandboxRoot
    );
  }
  return skillManager;
}

// ─── LoadSkillTool ─────────────────────────────────────────────────────────

export class LoadSkillTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "use_skill",
    aliases: ["load_skill", "skill"],
    description:
      "Load specialized knowledge by skill name. " +
      "Use this before tackling unfamiliar topics. " +
      "Skills are loaded from ~/.maou/skills, project/skills, or global skills directory.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name to load (case-sensitive)." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const name = String(params.name ?? "").trim();
    const manager = getSkillManager(ctx);

    if (!name) {
      const available = manager.listAvailableSkills();
      const names = available.map(s => s.name).sort();
      return createToolResponse(false, `未提供 skill 名称。可用: ${names.length > 0 ? names.join(", ") : "(none)"}`);
    }

    const content = manager.getSkillContent(name);
    if (!content) {
      const available = manager.listAvailableSkills();
      const names = available.map(s => s.name).sort();
      return createToolResponse(false, `未找到 skill '${name}'。可用: ${names.length > 0 ? names.join(", ") : "(none)"}`);
    }

    return createToolResponse(true, `<skill name="${name}">\n${content}\n</skill>`, {
      payload: { skill_name: name, content_length: content.length },
      displayEvents: [{ type: "terminal", stream: "info", text: `[加载 skill] ${name}` }],
    });
  }
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────

/**
 * 获取所有可用 skill 描述（供其他模块调用）
 */
export function getSkillDescriptions(ctx: ToolContext): string {
  const manager = getSkillManager(ctx);
  const skills = manager.listAvailableSkills();

  if (skills.length === 0) return "(目前没有可用 skill)";

  const lines: string[] = [];
  for (const skill of skills) {
    let line = `  - ${skill.name}: ${skill.description || "无描述"}`;
    line += ` [${skill.source}]`;
    lines.push(line);
  }
  return lines.join("\n");
}

/**
 * 列出所有 skill 名称
 */
export function listSkillNames(ctx: ToolContext): string[] {
  const manager = getSkillManager(ctx);
  return manager.listAvailableSkills().map(s => s.name).sort();
}
