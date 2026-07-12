/**
 * Load Skill 工具 — 加载专业知识
 *
 * 从多层级 skill 目录加载 SKILL.md（与 Runtime bake 列表同口径）：
 * - 系统/NPM：~/.agents/skills、~/.claude/skills（可由 skillOptions 关闭）
 * - 全局 maou：~/.maou/skills
 * - 项目：skills/、.agents/skills/、.maou/skills、.maou/skill
 * - Agent：.maou/agents/<agent>/{skill,skills}
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import {
  SkillContextManager,
  getDefaultSkillScanOptions,
  resolveSkillScanOptions,
} from "../../skill-context.js";
import type { SkillScanOptions } from "../../skill-context.js";

// ─── 按 agent+project+maou+scan 缓存，避免跨 agent 串台 ───────────────────

let skillManager: SkillContextManager | null = null;
let skillManagerKey = "";

function resolveMaouRoot(ctx: ToolContext): string {
  if (ctx.maouRoot && ctx.maouRoot.trim()) return ctx.maouRoot.trim();
  // promptRoot 通常就是 maouRoot（compiler.promptRoot）
  if (ctx.promptRoot && ctx.promptRoot.includes(".maou")) return ctx.promptRoot;
  return join(homedir(), ".maou");
}

function resolveScanOptions(ctx: ToolContext): SkillScanOptions {
  const fromCtx = ctx.skillOptions;
  if (fromCtx) {
    return resolveSkillScanOptions({
      includeSystemNpmSkills: fromCtx.includeSystemNpmSkills,
      extraDirs: fromCtx.extraDirs,
    });
  }
  return resolveSkillScanOptions(getDefaultSkillScanOptions());
}

function getSkillManager(ctx: ToolContext): SkillContextManager {
  const agentName = ctx.agentName || "default";
  const maouRoot = resolveMaouRoot(ctx);
  const scan = resolveScanOptions(ctx);
  const key = `${agentName}::${ctx.projectRoot}::${maouRoot}::${scan.includeSystemNpmSkills}::${(scan.extraDirs ?? []).join("|")}`;

  if (!skillManager || skillManagerKey !== key) {
    skillManager = new SkillContextManager(agentName, ctx.projectRoot, maouRoot, scan);
    if (ctx.skillOptions?.enabledSkills?.length) {
      skillManager.setEnabledSkills(ctx.skillOptions.enabledSkills);
    }
    skillManagerKey = key;
  }
  return skillManager;
}

// ─── LoadSkillTool ─────────────────────────────────────────────────────────

export class LoadSkillTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "use_skill",
    aliases: ["load_skill", "skill"],
    description:
      "Load specialized knowledge by skill name. " +
      "Use this before tackling unfamiliar topics. " +
      "Skills are loaded from project skills/, .maou/skills, ~/.maou/skills, and system ~/.agents/skills (npx skills -g).",
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
      const names = available.map((s) => s.name).sort();
      return createToolResponse(
        false,
        `未提供 skill 名称。可用: ${names.length > 0 ? names.join(", ") : "(none)"}`,
      );
    }

    const entry = manager.getSkillEntry(name);
    if (!entry) {
      const available = manager.listAvailableSkills();
      const names = available.map((s) => s.name).sort();
      return createToolResponse(
        false,
        `未找到 skill '${name}'。可用: ${names.length > 0 ? names.join(", ") : "(none)"}`,
      );
    }

    return createToolResponse(true, `<skill name="${name}" source="${entry.source}">\n${entry.content}\n</skill>`, {
      payload: {
        skill_name: name,
        content_length: entry.content.length,
        source: entry.source,
        source_path: entry.sourcePath,
      },
      displayEvents: [
        {
          type: "terminal",
          stream: "info",
          text: `[加载 skill] ${name} [${entry.source}]`,
        },
      ],
    });
  }
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────

export function getSkillDescriptions(ctx: ToolContext): string {
  const manager = getSkillManager(ctx);
  const skills = manager.listAvailableSkills();

  if (skills.length === 0) return "(目前没有可用 skill)";

  const lines: string[] = [];
  for (const skill of skills) {
    lines.push(`  - ${skill.name}: ${skill.description || "无描述"} [${skill.source}]`);
  }
  return lines.join("\n");
}

export function listSkillNames(ctx: ToolContext): string[] {
  const manager = getSkillManager(ctx);
  return manager.listAvailableSkills().map((s) => s.name).sort();
}
