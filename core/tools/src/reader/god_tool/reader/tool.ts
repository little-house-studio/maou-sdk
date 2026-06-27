/**
 * 读文件工具 — 读取本地文件、URL、图片
 * 对应 Python: core/tools/impls/read_tool.py
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { Tool, toolDir } from "../../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../../base.js";
import { createToolResponse } from "../../../base.js";
import { safePath, errToString } from "../../../browser/god_tool/use_browser/_util.js";
import { markRead } from "../../../file/read-registry.js";
import { extractSignatures } from "../../../compress/output-compressor.js";

const IMAGE_MIMES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * 判断是否是 URL
 */
function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 判断是否是图片路径
 */
function isImagePath(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext in IMAGE_MIMES;
}

export class ReadTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "reader",
    aliases: [],
    description:
      "读取文件、网页或图片。支持：本地文件（文本）、网页 URL（提取正文）、图片文件（base64）。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件路径（相对于项目根目录）或 URL。",
        },
        start_line: {
          type: "integer",
          description: "起始行号（从 1 开始）。",
        },
        end_line: {
          type: "integer",
          description: "结束行号（包含）。",
        },
        max_chars: {
          type: "integer",
          description: "最大返回字符数。",
        },
        mode: {
          type: "string",
          enum: ["full", "signatures"],
          description: "读取模式。signatures：只返回函数/类/接口签名（剥掉函数体），读大代码文件时极省 token；默认 full。",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
    parallelSafe: true,
  };

  async execute(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const filePath = String(params.path ?? params.file_path ?? "").trim();
    if (!filePath) {
      return createToolResponse(false, '❌ reader 缺少必填参数 path（文件路径或 URL）。正确用法示例：\n{"tool": "reader", "params": {"path": "src/index.ts"}}\n请用正确的 path 参数重试。');
    }

    // URL 模式
    if (isUrl(filePath)) {
      return this._readUrl(filePath);
    }

    // 图片检测
    if (isImagePath(filePath)) {
      return this._readImage(ctx.projectRoot, filePath);
    }

    // 本地文件读取
    return this._readLocalFile(ctx.projectRoot, filePath, params, ctx.sessionId);
  }

  /**
   * 读取本地文件
   */
  private _readLocalFile(
    projectRoot: string,
    userPath: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ): ToolResponse {
    let fullPath: string;
    try {
      fullPath = safePath(projectRoot, userPath);
    } catch (err: unknown) {
      return createToolResponse(false, errToString(err));
    }

    if (!existsSync(fullPath)) {
      return createToolResponse(false, `文件不存在: ${userPath}（建议先用 glob 工具搜索正确路径，例如 glob pattern="**/${userPath.split("/").pop()}"）`);
    }

    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        return createToolResponse(false, `路径是目录而非文件: ${userPath}（如需列出目录内容，请用 glob pattern="${userPath}/*"）`);
      }

      // 登记"已读"——支撑 edit/write 的先读后改安全语义
      if (sessionId) markRead(sessionId, fullPath);

      let content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      const totalLines = lines.length;

      // 签名模式（对标 RTK -l aggressive）：只给函数/类/接口签名，剥掉函数体，省 token。
      // 显式 mode/signatures/outline 触发；抽不到签名（非代码）则回退正常读取。
      const sigMode =
        params.mode === "signatures" || params.signatures === true || params.outline === true;
      if (sigMode) {
        const sigs = extractSignatures(content, extname(fullPath).toLowerCase());
        if (sigs) {
          const sigCount = sigs.split("\n").length;
          return createToolResponse(
            true,
            `[path=${fullPath} | total_lines=${totalLines} | mode=signatures | ${sigCount} 个签名]\n${sigs}`,
            { payload: { path: fullPath, total_lines: totalLines, mode: "signatures", signature_count: sigCount } },
          );
        }
      }

      const startLine = params.start_line != null ? Number(params.start_line) : 1;
      const endLine = params.end_line != null ? Number(params.end_line) : totalLines;
      const maxChars = params.max_chars != null ? Number(params.max_chars) : 0;

      const clampedStart = Math.max(1, Math.min(startLine, totalLines));
      const clampedEnd = Math.max(clampedStart, Math.min(endLine, totalLines));

      const selectedLines = lines.slice(clampedStart - 1, clampedEnd);
      const formatted = selectedLines
        .map((line, i) => `${String(clampedStart + i).padStart(4)}→${line}`)
        .join("\n");

      let result = formatted;
      if (maxChars > 0 && result.length > maxChars) {
        // 截断带"可继续"提示：估算已显示到第几行 + 如何读取后续
        const shownText = result.slice(0, maxChars);
        const shownLineCount = shownText.split("\n").length;
        const nextLine = clampedStart + shownLineCount;
        result =
          shownText +
          `\n... [输出按 ${maxChars} 字符截断，本段共 ${clampedEnd - clampedStart + 1} 行 / ${formatted.length} 字符；` +
          `如需后续内容用 read start_line=${Math.min(nextLine, totalLines)} end_line=${clampedEnd}]`;
      }

      const isTruncated =
        (maxChars > 0 && formatted.length > maxChars) || clampedStart > 1 || clampedEnd < totalLines;
      const metaParts = [
        `path=${fullPath}`,
        `total_lines=${totalLines}`,
        `shown=${clampedStart}-${clampedEnd}`,
      ];
      if (isTruncated) metaParts.push("truncated=true");
      const header = `[${metaParts.join(" | ")}]`;

      return createToolResponse(true, `${header}\n${result}`, {
        payload: {
          path: fullPath,
          total_lines: totalLines,
          start_line: clampedStart,
          end_line: clampedEnd,
        },
      });
    } catch (err: unknown) {
      return createToolResponse(false, `读取文件失败: ${errToString(err)}`);
    }
  }

  /**
   * 读取 URL 内容（使用 fetch）
   */
  private async _readUrl(url: string): Promise<ToolResponse> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return createToolResponse(
          false,
          `HTTP 请求失败: ${response.status} ${response.statusText}`,
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      let text = await response.text();

      const URL_LIMIT = 50000;
      const originalLen = text.length;
      const wasTruncated = originalLen > URL_LIMIT;
      if (wasTruncated) {
        text = text.slice(0, URL_LIMIT) + `\n\n... [URL 内容已截断，原长度 ${originalLen} 字符]`;
      }

      // 简单 HTML 正文提取
      if (contentType.includes("text/html")) {
        const body = this._extractHtmlBody(text);
        const meta = `[url=${url} | content_type=${contentType} | chars=${body.length}${wasTruncated ? " | truncated=true" : ""}]`;
        return createToolResponse(true, `${meta}\n${body}`, {
          payload: { url, content_type: contentType, truncated: wasTruncated },
        });
      }

      const meta = `[url=${url} | content_type=${contentType} | chars=${text.length}${wasTruncated ? " | truncated=true" : ""}]`;
      return createToolResponse(true, `${meta}\n${text}`, {
        payload: { url, content_type: contentType, truncated: wasTruncated },
      });
    } catch (err: unknown) {
      return createToolResponse(false, `URL 读取失败: ${errToString(err)}（提示：URL 必须是 http/https 开头；如果是内网或需认证，请改用 bash 调 curl）`);
    }
  }

  /**
   * 读取图片文件为 base64
   */
  private _readImage(projectRoot: string, userPath: string): ToolResponse {
    let fullPath: string;
    try {
      fullPath = safePath(projectRoot, userPath);
    } catch (err: unknown) {
      return createToolResponse(false, errToString(err));
    }

    if (!existsSync(fullPath)) {
      return createToolResponse(false, `图片文件不存在: ${userPath}`);
    }

    try {
      const buffer = readFileSync(fullPath);
      const ext = extname(fullPath).toLowerCase();
      const mime = IMAGE_MIMES[ext] ?? "application/octet-stream";
      const base64 = buffer.toString("base64");

      return createToolResponse(true, `[图片: ${userPath} | mime=${mime} | size=${buffer.length} 字节]`, {
        images: [{ mimeType: mime, data: base64 }],
        payload: { path: fullPath, mime_type: mime, size: buffer.length },
      });
    } catch (err: unknown) {
      return createToolResponse(false, `图片读取失败: ${errToString(err)}`);
    }
  }

  /**
   * 简单提取 HTML 正文文本
   */
  private _extractHtmlBody(html: string): string {
    // 移除 script 和 style
    let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
    // 移除 HTML 标签
    text = text.replace(/<[^>]+>/g, " ");
    // 合并空白
    text = text.replace(/\s+/g, " ").trim();
    return text;
  }
}
