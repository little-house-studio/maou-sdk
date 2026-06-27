/**
 * 写文件工具 — 创建或覆写文件
 * 对应 Python: core/tools/impls/write_file_tool.py
 */

import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { safePath, errToString } from "../../browser/god_tool/use_browser/_util.js";
import { verifyAfterWrite } from "../../code/lsp_verify.js";
import { atomicWrite } from "../atomic-write.js";
import { wasRead, isStaleSinceRead, markRead, refreshRead } from "../read-registry.js";
import { record as recordEdit, readBefore } from "../file-edit-history.js";

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
    const userPath = String(params.path ?? params.file_path ?? "").trim();
    const content = String(params.content ?? params.text ?? "");

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
      const isNew = !existsSync(fullPath);

      // 先读后改：覆写一个已存在但未读过的文件 → 返回当前内容并提示，防止盲目覆盖
      const sid = ctx.sessionId;
      if (!isNew && sid && (!wasRead(sid, fullPath) || isStaleSinceRead(sid, fullPath))) {
        const stale = wasRead(sid, fullPath);
        markRead(sid, fullPath);
        const existing = readFileSync(fullPath, "utf-8");
        const numbered = existing.split("\n").map((l, i) => `${String(i + 1).padStart(4)}\t${l}`).join("\n");
        const why = stale ? "该文件在你上次读取后被改动过" : "你尚未读取该文件就尝试覆写";
        return createToolResponse(
          false,
          `${why}。覆写会丢弃现有内容——请先 read 确认后再 write。\n以下是该文件**当前**完整内容：\n\n${numbered}`,
          { payload: { path: fullPath, reason: stale ? "stale" : "unread" } },
        );
      }

      // 确保父目录存在
      const dir = dirname(fullPath);
      mkdirSync(dir, { recursive: true });

      // 登记编辑历史（diff 标记）—— 在 atomicWrite 之前，存下 before 内容供 undo
      // 新建文件 before=null（undo 时删除文件）；覆写 before=原内容
      if (sid) {
        const beforeContent = isNew ? null : readBefore(fullPath);
        recordEdit(sid, fullPath, beforeContent, content, {
          toolName: "write_file",
          action: isNew ? "create" : "overwrite",
        });
      }

      atomicWrite(fullPath, content);
      if (sid) refreshRead(sid, fullPath); // 写后即视为已读最新

      const lines = content.split("\n").length;
      const actionLabel = isNew ? "已创建" : "已覆写";
      const meta = `[path=${fullPath} | lines=${lines} | chars=${content.length} | action=${isNew ? "created" : "overwritten"}]`;

      // 自我验证闭环：写入后用 LSP 检查是否有错，结果拼回供模型自修
      const lspNote = await verifyAfterWrite(fullPath);

      return createToolResponse(
        true,
        `文件${actionLabel}: ${userPath}（${lines} 行，${content.length} 字符）\n${meta}${lspNote ?? ""}`,
        {
          payload: {
            path: fullPath,
            lines,
            chars: content.length,
            created: isNew,
            lsp_verified: lspNote !== null,
          },
        },
      );
    } catch (err: unknown) {
      return createToolResponse(false, `写入文件失败: ${errToString(err)}`);
    }
  }
}
