/**
 * grade — 裁判评分工具。
 * 裁判 agent 调它输出结构化评分 { score, maxScore, passed, comment }。
 */

import { Tool, toolDir, createToolResponse } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";

export class GradeTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);

  readonly definition: ToolDefinition = {
    name: "grade",
    aliases: [],
    description: "裁判 agent 评分工具。对被测 agent 的回复给出结构化评分（分数/是否通过/评语）。仅在裁判测试场景使用。",
    parameters: {
      type: "object",
      properties: {
        score: { type: "number", description: "得分（0 到 maxScore 之间）。" },
        maxScore: { type: "number", description: "满分（与题目分值一致）。" },
        passed: { type: "boolean", description: "是否合格。" },
        comment: { type: "string", description: "评语：为什么给这个分，扣分点/亮点。" },
      },
      required: ["score", "passed", "comment"],
    },
    allowedModes: ["plan", "execute"],
  };

  async execute(
    params: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResponse> {
    const score = Number(params.score ?? 0);
    const maxScore = Number(params.maxScore ?? 0);
    const passed = Boolean(params.passed);
    const comment = String(params.comment ?? "");
    const result = { score, maxScore, passed, comment };
    // 返回结构化 JSON（EvalSuite.parseGrade 从回复里提取）
    return createToolResponse(true, JSON.stringify(result));
  }
}

export default new GradeTool();
