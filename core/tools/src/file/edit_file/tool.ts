/**
 * 编辑文件工具 — 查找并替换文件中的文本
 * 对应 Python: core/tools/impls/edit_file_tool.py
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { safePath, errToString } from "../../browser/god_tool/use_browser/_util.js";

export class EditFileTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "edit_file",
    aliases: ["edit_file"],
    description:
      "Replace the first occurrence of exact text in a file. Safe for targeted edits.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path from project root to the target file.",
        },
        old_text: {
          type: "string",
          description:
            "The exact existing text to search for (first occurrence will be replaced).",
        },
        new_text: {
          type: "string",
          description: "The replacement text.",
        },
      },
      required: ["path", "old_text", "new_text"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
  };

  async execute(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const userPath = String(params.path ?? params.file_path ?? "").trim();
    const oldText = String(params.old_text ?? params.old_string ?? params.oldText ?? "");
    const newText = String(params.new_text ?? params.new_string ?? params.newText ?? "");

    if (!userPath) {
      return createToolResponse(false, "edit-file 缺少 path 参数");
    }

    let fullPath: string;
    try {
      fullPath = safePath(ctx.projectRoot, userPath);
    } catch (err: unknown) {
      return createToolResponse(false, errToString(err));
    }

    if (!existsSync(fullPath)) {
      return createToolResponse(false, `文件不存在: ${userPath}（建议先用 glob 工具搜索正确路径，例如 glob pattern="**/${userPath.split("/").pop()}"）`);
    }

    try {
      const content = readFileSync(fullPath, "utf-8");

      // 查找第一次出现的位置
      const index = content.indexOf(oldText);
      if (index === -1) {
        // 给 AI 明确的下一步指引，避免盲目重试
        const hint = [
          "可能的原因与对策：",
          "1. 缩进/空白差异：用 read 工具查看目标行的精确内容（含前导空格），再重新构造 old_text。",
          "2. 文本不存在：用 grep 工具确认文件中是否包含该关键字。",
          "3. 多处相同文本：本工具只替换第一次出现，如需替换所有请改用 bash 调 sed。",
          "4. 文件过大：先用 read start_line/end_line 缩小范围定位目标行。",
        ].join("\n");
        return createToolResponse(false, `未找到要替换的文本。\n${hint}`, {
          payload: {
            path: fullPath,
            old_text_length: oldText.length,
            file_length: content.length,
            old_text_preview: oldText.slice(0, 120),
          },
        });
      }

      // 替换第一次出现
      const updated = content.slice(0, index) + newText + content.slice(index + oldText.length);
      writeFileSync(fullPath, updated, "utf-8");

      const totalLines = updated.split("\n").length;
      const meta = `[path=${fullPath} | replaced_at=${index} | old_len=${oldText.length} | new_len=${newText.length} | total_lines=${totalLines}]`;

      return createToolResponse(
        true,
        `文件已编辑: ${userPath}（替换位置: 字符 ${index}）\n${meta}`,
        {
          payload: {
            path: fullPath,
            replaced_at: index,
            old_text_length: oldText.length,
            new_text_length: newText.length,
            total_lines: totalLines,
          },
        },
      );
    } catch (err: unknown) {
      return createToolResponse(false, `编辑文件失败: ${errToString(err)}`);
    }
  }
}
