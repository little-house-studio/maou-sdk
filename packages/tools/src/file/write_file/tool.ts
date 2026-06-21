/**
 * 写文件工具 — 创建或覆写文件
 * 对应 Python: core/tools/impls/write_file_tool.py
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { safePath, errToString } from "../../browser/god_tool/use_browser/_util.js";

export class WriteFileTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "write_file",
    aliases: ["write_file"],
    description: "Create or overwrite a file with the given content.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path from project root to the target file.",
        },
        content: {
          type: "string",
          description: "Full content to write to the file.",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
  };

  async execute(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const userPath = String(params.path ?? "").trim();
    const content = String(params.content ?? "");

    if (!userPath) {
      return createToolResponse(false, "write-file 缺少 path 参数");
    }

    let fullPath: string;
    try {
      fullPath = safePath(ctx.projectRoot, userPath);
    } catch (err: unknown) {
      return createToolResponse(false, errToString(err));
    }

    try {
      // 确保父目录存在
      const dir = dirname(fullPath);
      mkdirSync(dir, { recursive: true });

      const isNew = !existsSync(fullPath);

      writeFileSync(fullPath, content, "utf-8");

      const lines = content.split("\n").length;
      const actionLabel = isNew ? "已创建" : "已覆写";
      const meta = `[path=${fullPath} | lines=${lines} | chars=${content.length} | action=${isNew ? "created" : "overwritten"}]`;

      return createToolResponse(
        true,
        `文件${actionLabel}: ${userPath}（${lines} 行，${content.length} 字符）\n${meta}`,
        {
          payload: {
            path: fullPath,
            lines,
            chars: content.length,
            created: isNew,
          },
        },
      );
    } catch (err: unknown) {
      return createToolResponse(false, `写入文件失败: ${errToString(err)}`);
    }
  }
}
