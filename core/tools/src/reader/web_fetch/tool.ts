/**
 * web_fetch — 只读 http(s) URL。
 */

import { Tool, toolDir, toolFail } from "../../base.js";
import type { ToolContext, ToolDefinition, ToolResponse } from "../../base.js";
import { ReadTool } from "../god_tool/reader/tool.js";

function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export class WebFetchTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "web_fetch",
    aliases: ["read_web"],
    description: "抓取 http(s) URL 正文。本地文件用 read_file，交互网页用 use_browser。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "http(s) URL（也接受 url 字段）" },
        url: { type: "string", description: "与 path 同义" },
      },
      required: [],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
    parallelSafe: true,
  };

  private readonly reader = new ReadTool();

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const path = String(params.url ?? params.path ?? "").trim();
    if (!path) {
      return toolFail("invalid_args", "web_fetch 需要 url 或 path。", {
        code: "missing_params",
        details: { missing: ["url"] },
      });
    }
    if (!isUrl(path)) {
      return toolFail("invalid_args", `不是 http(s) URL，请用 read_file：${path}`, {
        code: "use_read_file",
      });
    }
    return this.reader.execute({ ...params, path }, ctx);
  }
}
