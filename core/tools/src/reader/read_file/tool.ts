/**
 * read_file — 只读本地文本。网页用 web_fetch，图片用 read_image。上帝入口 reader 仍可用。
 */

import { extname } from "node:path";
import { Tool, toolDir, toolFail } from "../../base.js";
import type { ToolContext, ToolDefinition, ToolResponse } from "../../base.js";
import { ReadTool } from "../god_tool/reader/tool.js";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"]);

function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export class ReadFileTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "read_file",
    aliases: [],
    description: "读取本地 UTF-8 文本文件（带行号）。网页用 web_fetch，图片用 read_image。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "本地文件路径" },
        start_line: { type: "integer", description: "起始行号（从 1 开始）" },
        end_line: { type: "integer", description: "结束行号（包含）" },
        max_chars: { type: "integer", description: "最大返回字符数" },
        mode: { type: "string", enum: ["full", "signatures"], description: "full 或 signatures" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
    parallelSafe: true,
  };

  private readonly reader = new ReadTool();

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const path = String(params.path ?? params.file_path ?? "").trim();
    if (!path) {
      return toolFail("invalid_args", "read_file 需要 path（本地文本文件）。", {
        code: "missing_params",
        details: { missing: ["path"] },
      });
    }
    if (isUrl(path)) {
      return toolFail("invalid_args", `这是 URL，请用 web_fetch：${path}`, { code: "use_web_fetch" });
    }
    if (IMAGE_EXTS.has(extname(path).toLowerCase())) {
      return toolFail("invalid_args", `这是图片，请用 read_image：${path}`, { code: "use_read_image" });
    }
    return this.reader.execute(params, ctx);
  }
}
