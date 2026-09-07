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

/** 与 DSH read 默认一致：一次最多 2000 行、整窗 50KiB、单行 2000 字。 */
export const READ_LIMIT_LINES = 2000;
export const READ_MAX_LINE_CHARS = 2000;
export const READ_MAX_BYTES = 50 * 1024;

const MAX_LINE_CHARS = READ_MAX_LINE_CHARS;

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function positiveInt(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.trunc(n);
}

/** 行窗口：offset/start_line + limit，或 end_line。一次最多 2000 行。 */
export function resolveReadWindow(
  params: Record<string, unknown>,
  totalLines: number,
): { start: number; end: number; limit: number } {
  const safeTotal = Math.max(0, totalLines);
  const start = Math.max(1, Math.min(positiveInt(params.offset ?? params.start_line) ?? 1, Math.max(1, safeTotal)));
  const requestedLimit = positiveInt(params.limit);
  const endLine = positiveInt(params.end_line);
  let limit = READ_LIMIT_LINES;
  if (requestedLimit != null) {
    limit = Math.min(READ_LIMIT_LINES, requestedLimit);
  } else if (endLine != null) {
    limit = Math.min(READ_LIMIT_LINES, Math.max(1, endLine - start + 1));
  }
  const end = safeTotal === 0 ? 0 : Math.min(safeTotal, start + limit - 1);
  return { start, end, limit };
}

/**
 * 分页页脚：说清看到哪儿了、下一段怎么取。
 * 没有这一句，offset/limit 造成的分页对模型是无声的。
 */
function readPaginationFooter(opts: {
  from: number;
  to: number;
  totalLines: number;
  charTruncated: boolean;
  byteTruncated: boolean;
  maxChars: number;
  segmentChars: number;
  longLinesCut: number;
}): string {
  const parts: string[] = [];
  if (opts.charTruncated) {
    parts.push(
      `Cut at max_chars=${opts.maxChars} (this range is ${opts.segmentChars} chars).`,
    );
  } else if (opts.byteTruncated) {
    parts.push(`Cut at ${READ_MAX_BYTES} bytes (50KiB per read).`);
  }
  if (opts.to < opts.totalLines) {
    parts.push(
      `Showing lines ${opts.from}-${opts.to} of ${opts.totalLines}. Use offset=${opts.to + 1} to continue.`,
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
      "读取文件、网页或图片。本地文本按行分页：offset/limit（或 start_line/end_line），一次最多 2000 行 / 50KiB。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件路径（相对于项目根目录）或 URL。",
        },
        offset: {
          type: "integer",
          description: "起始行号（从 1 开始）。与 start_line 相同。默认 1。页脚给出续读 offset。",
        },
        limit: {
          type: "integer",
          description: "本次读取行数。默认 2000，最大 2000。",
        },
        start_line: {
          type: "integer",
          description: "起始行号（从 1 开始）。与 offset 相同。",
        },
        end_line: {
          type: "integer",
          description: "结束行号（包含）。也可用 limit 表示读多少行。",
        },
        max_chars: {
          type: "integer",
          description: "更紧的字符上限。不传则按 50KiB / 2000 行封顶。",
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
      const totalChars = [...content].length;

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
            `[path=${fullPath} | total_lines=${totalLines} | total_chars=${totalChars} | mode=signatures | ${sigCount} 个签名]\n${sigs}`,
            { payload: { path: fullPath, total_lines: totalLines, total_chars: totalChars, mode: "signatures", signature_count: sigCount } },
          );
        }
      }

      const maxChars =
        params.max_chars != null && Number.isFinite(Number(params.max_chars))
          ? Number(params.max_chars)
          : 0;
      const { start: clampedStart, end: clampedEnd } = resolveReadWindow(params, totalLines);

      const selectedLines = lines.slice(clampedStart - 1, clampedEnd);
      let longLinesCut = 0;
      const formattedLines: string[] = [];
      let usedBytes = 0;
      let lastShownLine = clampedStart - 1;
      let byteTruncated = false;
      for (let i = 0; i < selectedLines.length; i++) {
        let body = selectedLines[i]!;
        if (body.length > MAX_LINE_CHARS) {
          longLinesCut++;
          body = `${body.slice(0, MAX_LINE_CHARS)} …[line cut at ${MAX_LINE_CHARS} chars of ${selectedLines[i]!.length}]`;
        }
        const formatted = `${String(clampedStart + i).padStart(4)}→${body}`;
        const add = utf8Bytes(formatted) + (formattedLines.length > 0 ? 1 : 0);
        if (usedBytes + add > READ_MAX_BYTES) {
          byteTruncated = true;
          break;
        }
        formattedLines.push(formatted);
        usedBytes += add;
        lastShownLine = clampedStart + i;
      }
      if (formattedLines.length === 0 && selectedLines.length > 0) {
        byteTruncated = true;
      }

      let result = formattedLines.join("\n");
      let charTruncated = false;
      if (maxChars > 0 && result.length > maxChars) {
        charTruncated = true;
        const shownText = result.slice(0, maxChars);
        const shownLineCount = Math.max(1, shownText.split("\n").length - 1);
        lastShownLine = Math.min(clampedStart + shownLineCount - 1, lastShownLine);
        result = shownText;
      }

      const isTruncated =
        charTruncated ||
        byteTruncated ||
        clampedStart > 1 ||
        lastShownLine < totalLines;
      const footer = readPaginationFooter({
        from: clampedStart,
        to: Math.max(clampedStart, lastShownLine),
        totalLines,
        charTruncated,
        byteTruncated,
        maxChars,
        segmentChars: result.length,
        longLinesCut,
      });

      const metaParts = [
        `path=${fullPath}`,
        `total_lines=${totalLines}`,
        `total_chars=${totalChars}`,
        `shown=${clampedStart}-${lastShownLine}`,
      ];
      if (isTruncated) metaParts.push("truncated=true");
      const header = `[${metaParts.join(" | ")}]`;

      return createToolResponse(true, `${header}\n${result}\n${footer}`, {
        payload: {
          path: fullPath,
          total_lines: totalLines,
          total_chars: totalChars,
          offset: clampedStart,
          limit: Math.max(0, lastShownLine - clampedStart + 1),
          start_line: clampedStart,
          end_line: lastShownLine,
          truncated: isTruncated,
          next_offset: lastShownLine < totalLines ? lastShownLine + 1 : null,
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

      const URL_LIMIT = READ_MAX_BYTES;
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
