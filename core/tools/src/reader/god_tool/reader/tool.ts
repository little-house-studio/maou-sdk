/**
 * 读文件工具 — 读取本地文件、URL、图片
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { Tool, toolDir } from "../../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../../base.js";
import { createToolResponse, toolFail } from "../../../base.js";
import { toolFailFromThrown } from "../../../errors.js";
import { errToString } from "../../../util/common.js";
import { formatRetentionNotice } from "@little-house-studio/types";
import { resolveToolPath } from "../../../path-guard.js";
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

/** 单行上限：minified 单行文件不能原样进上下文。 */
const MAX_LINE_CHARS = 2000;

/**
 * 分页页脚：说清看到哪儿了、下一段怎么取。
 * 没有这一句，start_line/end_line 造成的分页对模型是无声的。
 */
function readPaginationFooter(opts: {
  from: number;
  to: number;
  totalLines: number;
  charTruncated: boolean;
  maxChars: number;
  segmentChars: number;
  longLinesCut: number;
}): string {
  const parts: string[] = [];
  if (opts.charTruncated) {
    parts.push(
      `Cut at max_chars=${opts.maxChars} (this range is ${opts.segmentChars} chars).`,
    );
  }
  if (opts.to < opts.totalLines) {
    parts.push(
      `Showing lines ${opts.from}-${opts.to} of ${opts.totalLines}. Use start_line=${opts.to + 1} to continue.`,
    );
  } else if (opts.from > 1 || opts.charTruncated) {
    parts.push(`Showing lines ${opts.from}-${opts.to} of ${opts.totalLines}. End of file.`);
  } else {
    parts.push(`End of file - total ${opts.totalLines} lines.`);
  }
  if (opts.longLinesCut > 0) {
    parts.push(
      `${opts.longLinesCut} long line(s) cut at ${MAX_LINE_CHARS} chars; read the raw file if you need the rest.`,
    );
  }
  return `(${parts.join(" ")})`;
}

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
    aliases: ["read"],
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
      return toolFail(
        "invalid_args",
        '❌ reader 缺少必填参数 path（文件路径或 URL）。正确用法示例：\n{"tool": "reader", "params": {"path": "src/index.ts"}}\n请用正确的 path 参数重试。',
        { code: "missing_params", details: { missing: ["path"] } },
      );
    }

    // URL 模式
    if (isUrl(filePath)) {
      return this._readUrl(filePath);
    }

    // 图片检测
    if (isImagePath(filePath)) {
      return this._readImage(ctx, filePath);
    }

    // 本地文件读取（PathGuard / workingDir）
    return this._readLocalFile(ctx, filePath, params, ctx.sessionId);
  }

  /**
   * 读取本地文件
   */
  private _readLocalFile(
    ctx: ToolContext,
    userPath: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ): ToolResponse {
    let fullPath: string;
    try {
      fullPath = resolveToolPath(ctx, userPath).path;
    } catch (err: unknown) {
      return toolFailFromThrown(err, { fallbackCategory: "sandbox_denied" });
    }

    if (!existsSync(fullPath)) {
      return toolFail("not_found", `文件不存在: ${userPath}（建议先用 glob 工具搜索正确路径，例如 glob pattern="**/${userPath.split("/").pop()}"）`, { code: "ENOENT" });
    }

    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        return toolFail("precondition", `路径是目录而非文件: ${userPath}（如需列出目录内容，请用 glob pattern="${userPath}/*"）`, { code: "is_directory" });
      }

      // 登记"已读"——支撑 edit/write 的先读后改安全语义
      if (sessionId) markRead(sessionId, fullPath);

      let content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      const totalLines = lines.length;

      // 签名模式：只给函数/类/接口签名，剥掉函数体，省 token。
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

      // Number.isFinite 防护：非数字字符串会得 NaN，导致 slice/ clamp 崩溃
      const startLine = params.start_line != null && Number.isFinite(Number(params.start_line)) ? Number(params.start_line) : 1;
      const endLine = params.end_line != null && Number.isFinite(Number(params.end_line)) ? Number(params.end_line) : totalLines;
      const maxChars = params.max_chars != null && Number.isFinite(Number(params.max_chars)) ? Number(params.max_chars) : 0;

      const clampedStart = Math.max(1, Math.min(startLine, totalLines));
      const clampedEnd = Math.max(clampedStart, Math.min(endLine, totalLines));

      const selectedLines = lines.slice(clampedStart - 1, clampedEnd);
      let longLinesCut = 0;
      const formatted = selectedLines
        .map((line, i) => {
          let body = line;
          if (body.length > MAX_LINE_CHARS) {
            longLinesCut++;
            body = `${body.slice(0, MAX_LINE_CHARS)} …[line cut at ${MAX_LINE_CHARS} chars of ${line.length}]`;
          }
          return `${String(clampedStart + i).padStart(4)}→${body}`;
        })
        .join("\n");

      let result = formatted;
      let charTruncated = false;
      let lastShownLine = clampedEnd;
      if (maxChars > 0 && result.length > maxChars) {
        charTruncated = true;
        const shownText = result.slice(0, maxChars);
        // 已完整显示的行数（最后一行可能被切一半，不算它已读完）
        const shownLineCount = Math.max(1, shownText.split("\n").length - 1);
        lastShownLine = Math.min(clampedStart + shownLineCount - 1, clampedEnd);
        result = shownText;
      }

      const isTruncated = charTruncated || clampedStart > 1 || clampedEnd < totalLines;
      const footer = readPaginationFooter({
        from: clampedStart,
        to: lastShownLine,
        totalLines,
        charTruncated,
        maxChars,
        segmentChars: formatted.length,
        longLinesCut,
      });

      const metaParts = [
        `path=${fullPath}`,
        `total_lines=${totalLines}`,
        `shown=${clampedStart}-${lastShownLine}`,
      ];
      if (isTruncated) metaParts.push("truncated=true");
      const header = `[${metaParts.join(" | ")}]`;

      return createToolResponse(true, `${header}\n${result}\n${footer}`, {
        payload: {
          path: fullPath,
          total_lines: totalLines,
          start_line: clampedStart,
          end_line: lastShownLine,
          truncated: isTruncated,
          next_start_line: lastShownLine < totalLines ? lastShownLine + 1 : null,
        },
      });
    } catch (err: unknown) {
      return toolFailFromThrown(err, { prefix: "读取文件失败", fallbackCategory: "execution" });
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
        // 出路：URL 内容无法分页，只能说清剩多少 + 换 bash curl 取全文
        text =
          text.slice(0, URL_LIMIT) +
          `\n\n... ${formatRetentionNotice(
            { kind: "exact", count: originalLen - URL_LIMIT, unit: "chars" },
            {
              retrieveHint:
                "Fetch the full body with use_terminal (curl) and read it from disk if you need the rest.",
            },
          )}`;
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
      return toolFail("external", `URL 读取失败: ${errToString(err)}（提示：URL 必须是 http/https 开头；如果是内网或需认证，请改用 bash 调 curl）`, { code: "url_fetch_failed" });
    }
  }

  /**
   * 读取图片文件为 base64
   */
  private _readImage(ctx: ToolContext, userPath: string): ToolResponse {
    let fullPath: string;
    try {
      fullPath = resolveToolPath(ctx, userPath).path;
    } catch (err: unknown) {
      return toolFailFromThrown(err, { fallbackCategory: "sandbox_denied" });
    }

    if (!existsSync(fullPath)) {
      return toolFail("not_found", `图片文件不存在: ${userPath}`, { code: "ENOENT" });
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
      return toolFailFromThrown(err, { prefix: "图片读取失败", fallbackCategory: "execution" });
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
