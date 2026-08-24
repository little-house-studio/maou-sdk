/**
 * read_image — 只读本地图片为多模态输入。
 */

import { extname } from "node:path";
import { Tool, toolDir, toolFail } from "../../base.js";
import type { ToolContext, ToolDefinition, ToolResponse } from "../../base.js";
import { ReadTool } from "../god_tool/reader/tool.js";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"]);

export class ReadImageTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "read_image",
    aliases: [],
    description: "读取本地图片（png/jpg/gif/webp 等），以多模态返回。文本用 read_file。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "本地图片路径" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
    parallelSafe: true,
  };

  private readonly reader = new ReadTool();

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const path = String(params.path ?? "").trim();
    if (!path) {
      return toolFail("invalid_args", "read_image 需要 path。", {
        code: "missing_params",
        details: { missing: ["path"] },
      });
    }
    if (!IMAGE_EXTS.has(extname(path).toLowerCase())) {
      return toolFail("invalid_args", `不是已知图片扩展名，请用 read_file：${path}`, {
        code: "use_read_file",
      });
    }
    return this.reader.execute(params, ctx);
  }
}
