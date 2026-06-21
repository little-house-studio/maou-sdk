/**
 * Create Skill 工具 — 创建新的 skill
 *
 * 根据用户需求生成 skill 模板，包含：
 * - SKILL.md 主文件（含 YAML frontmatter）
 * - 引导 AI 完善和测试 skill 的提示词
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

// ─── 工具实现 ─────────────────────────────────────────────────────────────

export class CreateSkillTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "create_skill",
    aliases: ["skill_create", "make_skill"],
    description:
      "Create a new skill from requirements. " +
      "Generates SKILL.md template and provides guidance for AI to complete and test the skill.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Skill name (kebab-case, e.g. 'code-review', 'lark-im')",
        },
        description: {
          type: "string",
          description: "Brief description of what this skill does",
        },
        requirements: {
          type: "string",
          description:
            "Detailed requirements (200-2000 chars). Include: purpose, outline, acceptance criteria, " +
            "whether it needs code resources, CLI tools, or external dependencies.",
        },
      },
      required: ["name", "description", "requirements"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const name = String(params.name ?? "").trim();
    const description = String(params.description ?? "").trim();
    const requirements = String(params.requirements ?? "").trim();

    // 验证参数
    if (!name) {
      return createToolResponse(false, "请提供 skill 名称");
    }
    if (!description) {
      return createToolResponse(false, "请提供 skill 描述");
    }
    if (!requirements || requirements.length < 50) {
      return createToolResponse(false, "需求描述太短，请提供更详细的需求（至少 50 字）");
    }
    if (requirements.length > 3000) {
      return createToolResponse(false, "需求描述过长，请精简到 3000 字以内");
    }

    // 验证名称格式
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      return createToolResponse(false, `skill 名称格式错误: "${name}"。应使用 kebab-case（小写字母、数字、连字符，如 'code-review'）`);
    }

    try {
      // 确定 skill 目录
      const isGlobalAgent = ctx.projectRoot === ctx.sandboxRoot || ctx.agentName === "default";
      const maouDir = isGlobalAgent
        ? join(homedir(), ".maou")
        : join(ctx.projectRoot, ".maou");
      const skillsDir = join(maouDir, "skills");
      const skillDir = join(skillsDir, name);

      // 检查是否已存在
      if (existsSync(join(skillDir, "SKILL.md"))) {
        return createToolResponse(false, `skill "${name}" 已存在于 ${skillDir}`);
      }

      // 创建目录
      mkdirSync(skillDir, { recursive: true });

      // 生成 SKILL.md 模板
      const skillContent = this.generateSkillTemplate(name, description, requirements);
      writeFileSync(join(skillDir, "SKILL.md"), skillContent, "utf-8");

      // 生成完善提示词
      const refinePrompt = this.generateRefinePrompt(name, description, requirements, skillDir);

      // 生成测试提示词
      const testPrompt = this.generateTestPrompt(name, skillDir);

      // 格式化输出
      const output = this.formatOutput(name, skillDir, refinePrompt, testPrompt);

      return createToolResponse(true, output, {
        payload: { name, skillDir, created: true },
        displayEvents: [{ type: "terminal", stream: "info", text: `[skill 创建] ${name} → ${skillDir}` }],
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return createToolResponse(false, `创建失败: ${msg}`);
    }
  }

  // ─── 生成模板 ───────────────────────────────────────────────────────────

  private generateSkillTemplate(name: string, description: string, requirements: string): string {
    const frontmatter = `---
name: ${name}
version: 1.0.0
description: "${description}"
tags: []
metadata:
  requires:
    bins: []
    tools: []
---`;

    const body = `# ${name}

> 此 skill 为初始模板，需要进一步完善。

## 概述

${description}

## 需求详情

${requirements}

## 使用方法

<!-- 描述如何调用此 skill -->

## 核心流程

<!-- 描述 skill 的主要工作流程 -->

## 输出格式

<!-- 描述 skill 执行后的输出格式 -->

## 注意事项

<!-- 列出使用此 skill 时需要注意的事项 -->

`;

    return frontmatter + "\n" + body;
  }

  private generateRefinePrompt(name: string, _description: string, requirements: string, skillDir: string): string {
    return `
你现在需要完善刚创建的 skill "${name}"。

**skill 目录**: ${skillDir}
**skill 文件**: ${skillDir}/SKILL.md

**原始需求**:
${requirements}

**完善步骤**:

1. **阅读现有模板**: 先读取 ${skillDir}/SKILL.md 了解当前结构

2. **补充概述**: 用简洁的语言描述 skill 的目的和适用场景

3. **定义核心流程**: 根据需求设计 skill 的主要工作流程，使用 Markdown 列表或步骤描述

4. **明确输入输出**:
   - 用户/Agent 需要提供什么信息
   - skill 执行后会输出什么

5. **添加示例**: 为关键步骤添加具体示例

6. **注意事项**: 列出使用限制、边界情况处理、错误处理方式

7. **更新 frontmatter**:
   - 补充合适的 tags
   - 如果需要 CLI 工具，添加到 metadata.requires.bins
   - 如果需要特定工具，添加到 metadata.requires.tools

**格式要求**:
- 使用 Markdown 格式
- 保持结构清晰，使用标题层级
- 避免冗长描述，每个部分控制在合理长度
- 使用代码块展示示例代码或命令

**开始完善**: 请先读取 SKILL.md，然后逐步编辑完善它。每完成一个部分后告知进度。
`;
  }

  private generateTestPrompt(name: string, skillDir: string): string {
    return `
skill "${name}" 已完善，现在需要测试验证。

**测试步骤**:

1. **验证结构**:
   - 检查 ${skillDir}/SKILL.md 是否存在
   - 检查 frontmatter 格式是否正确（name, version, description）
   - 检查必需的章节是否完整（概述、核心流程、输出格式）

2. **模拟调用**:
   - 设想一个典型的使用场景
   - 按照 skill 中的流程步骤模拟执行
   - 检查输出是否符合预期格式

3. **边界测试**:
   - 考虑异常输入情况
   - 检查 skill 是否有相应的处理说明

4. **检查依赖**:
   - 如果 metadata.requires.bins 列出了 CLI 工具，验证是否有使用说明
   - 如果需要外部 API，检查是否有认证说明

5. **修复问题**:
   - 发现缺失内容时，补充到 SKILL.md
   - 发现格式问题时，修正格式

**测试完成后**: 报告测试结果，说明 skill 是否可用，以及需要修复的问题（如果有）。
`;
  }

  private formatOutput(name: string, skillDir: string, refinePrompt: string, testPrompt: string): string {
    const lines: string[] = [
      `✅ skill "${name}" 已创建`,
      "",
      `📁 目录结构:`,
      `   ${skillDir}/`,
      `   └── SKILL.md`,
      "",
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      "",
      `📝 完善提示词（请执行以下步骤）:`,
      "",
      refinePrompt,
      "",
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      "",
      `🧪 测试提示词（完善后执行）:`,
      "",
      testPrompt,
      "",
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      "",
      `💡 使用方法:`,
      `   use_skill name="${name}"`,
      "",
    ];

    return lines.join("\n");
  }
}