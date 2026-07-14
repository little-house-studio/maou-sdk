/**
 * 写文件工具 — 创建或覆写文件
 */

import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { errToString } from "../../browser/god_tool/use_browser/_util.js";
import { resolveToolPath } from "../../path-guard.js";
import { verifyAfterWrite } from "../../code/lsp_verify.js";
import { atomicWrite } from "../atomic-write.js";
import {
  wasRead,
  isStaleSinceRead,
  markRead,
  refreshRead,
} from "../read-registry.js";
import {
  record as recordEdit,
  readBefore,
  wasEditedInSession,
} from "../file-edit-history.js";

/**
 * 先读后写策略：
 * - 新建：直接写
 * - 已存在且本 session 从未 read/edit：必须先读
 * - 已 read/edit 且磁盘相对登记有变更（diff/mtime）：必须再读
 * - 已 read/edit 且无外部变更：可直接写
 */
function needReadBeforeWrite(
  sid: string | undefined,
  fullPath: string,
  isNew: boolean,
): { block: boolean; reason?: "unread" | "stale" } {
  if (isNew || !sid) return { block: false };
  const touched = wasRead(sid, fullPath) || wasEditedInSession(sid, fullPath);
  if (!touched) return { block: true, reason: "unread" };
  // 读过/写过：仅当相对上次登记发生外部变更时再拦
  if (wasRead(sid, fullPath) && isStaleSinceRead(sid, fullPath)) {
    return { block: true, reason: "stale" };
  }
  return { block: false };
}

export class WriteFileTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "write_file",
    aliases: ["write_file"],
    description:
      "Create or overwrite a file. " +
      "Existing files: need prior read/edit in session, or force=true for intentional full replace; " +
      "if disk changed after last read/edit (diff), re-read first.",
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
        force: {
          type: "boolean",
          description:
            "Intentional full-file overwrite without prior read (scaffold/update config). " +
            "Still blocked if file was read/edited and then changed externally (stale).",
        },
        overwrite: {
          type: "boolean",
          description: "Alias of force.",
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
    const userPath = String(params.path ?? params.file_path ?? "").trim();
    const content = String(params.content ?? params.text ?? "");
    const force =
      params.force === true ||
      params.overwrite === true ||
      String(params.force ?? "").toLowerCase() === "true" ||
      String(params.overwrite ?? "").toLowerCase() === "true";

    if (!userPath) {
      return createToolResponse(
        false,
        '❌ write_file 缺少必填参数 path。示例：{"tool":"write_file","params":{"path":"src/index.ts","content":"..."}}',
      );
    }

    let fullPath: string;
    try {
      fullPath = resolveToolPath(ctx, userPath).path;
    } catch (err: unknown) {
      return createToolResponse(false, errToString(err));
    }

    try {
      const isNew = !existsSync(fullPath);
      const sid = ctx.sessionId;
      const gate = needReadBeforeWrite(sid, fullPath, isNew);

      if (gate.block) {
        // force：仅放行「从未读过」的故意整文件替换；stale（读后有 diff）仍须先读
        if (force && gate.reason === "unread") {
          // 放行
        } else {
          const existing = readFileSync(fullPath, "utf-8");
          if (sid) markRead(sid, fullPath);
          const numbered = existing
            .split("\n")
            .map((l, i) => `${String(i + 1).padStart(4)}\t${l}`)
            .join("\n");
          const why =
            gate.reason === "stale"
              ? "该文件在你上次读取/编辑后磁盘内容已变化（有 diff）"
              : "该文件已存在，且本会话尚未阅读或编辑过";
          const tip =
            gate.reason === "unread"
              ? `若**确认整文件替换**（更新配置/脚手架），请带 \`"force": true\` 再调用（不必先 read）。\n`
              : `请根据下列内容确认后再 write。\n`;
          return createToolResponse(
            false,
            `${why}。${tip}` +
              `以下是**当前**完整内容（已记为已读）：\n\n${numbered}`,
            {
              payload: {
                path: fullPath,
                reason: gate.reason,
                total_lines: existing.split("\n").length,
                force_ok: gate.reason === "unread",
              },
            },
          );
        }
      }

      const dir = dirname(fullPath);
      mkdirSync(dir, { recursive: true });

      if (sid) {
        const beforeContent = isNew ? null : readBefore(fullPath);
        recordEdit(sid, fullPath, beforeContent, content, {
          toolName: "write_file",
          action: isNew ? "create" : "overwrite",
        });
      }

      atomicWrite(fullPath, content);
      if (sid) refreshRead(sid, fullPath);

      const lines = content.split("\n").length;
      const actionLabel = isNew ? "已创建" : "已覆写";
      const meta = `[path=${fullPath} | lines=${lines} | chars=${content.length} | action=${isNew ? "created" : "overwritten"}]`;

      const verifyNote = await verifyAfterWrite(fullPath, {
        projectRoot: ctx.projectRoot || ctx.workingDir,
      });

      return createToolResponse(
        true,
        `文件${actionLabel}: ${userPath}（${lines} 行，${content.length} 字符）\n${meta}${verifyNote ?? ""}`,
        {
          payload: {
            path: fullPath,
            lines,
            chars: content.length,
            created: isNew,
            verified: verifyNote !== null,
          },
        },
      );
    } catch (err: unknown) {
      return createToolResponse(false, `写入文件失败: ${errToString(err)}`);
    }
  }
}
