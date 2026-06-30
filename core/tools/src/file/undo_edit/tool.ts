/**
 * 撤销编辑工具 — 回退最近一次 edit_file/write_file 操作
 *
 * 基于 file-edit-history 的 per-session 编辑历史，写回 before 内容。
 * - 不传 path：回退最近一次编辑（任意文件）
 * - 传 path：回退该文件最近一次编辑
 * - 传 all=true：连续回退该 session 所有编辑直到无可回退（慎用）
 * - 传 tool_call_id：按 toolCallId 精确回退某次编辑（关联上下文消息回退）
 *
 * @see DESIGN.md 第 28 行「被影响文件的回退机制」
 */

import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { errToString, safePath } from "../../browser/god_tool/use_browser/_util.js";
import {
  undo,
  undoByToolCallId,
  listEdits,
  clearHistory,
} from "../file-edit-history.js";

export class UndoEditTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "undo_edit",
    aliases: ["undo_edit"],
    description:
      "撤销最近一次 edit_file/write_file 的文件改动，恢复到编辑前的内容。" +
      "不传 path 撤销最近一次任意文件的编辑；传 path 撤销指定文件最近一次编辑；" +
      "传 all=true 撤销该 session 全部历史编辑（慎用，会按时间倒序逐个回退）；" +
      "传 tool_call_id 按 tool_call 精确回退某次编辑。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "要撤销编辑的文件路径（相对项目根）。不传则撤销最近一次任意文件的编辑。",
        },
        all: {
          type: "boolean",
          description: "为 true 时撤销该 session 全部历史编辑（按时间倒序逐个回退）。慎用。",
        },
        tool_call_id: {
          type: "string",
          description: "按 toolCallId 精确回退某次编辑（用于关联上下文消息回退）。",
        },
      },
      required: [],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
  };

  async execute(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const sessionId = ctx.sessionId;
    if (!sessionId) {
      return createToolResponse(false, "缺少 sessionId，无法回退");
    }

    try {
      // 按 toolCallId 精确回退
      const tcId = String(params.tool_call_id ?? params.toolCallId ?? "").trim();
      if (tcId) {
        const result = undoByToolCallId(sessionId, tcId);
        return createToolResponse(result.ok, result.message, {
          payload: { tool_call_id: tcId, ...result },
        });
      }

      // 撤销全部
      if (params.all === true || params.all === "true") {
        const before = listEdits(sessionId);
        if (before.length === 0) {
          return createToolResponse(true, "当前没有可撤销的编辑历史。", {
            payload: { reverted: 0 },
          });
        }
        const results: string[] = [];
        let okCount = 0;
        // 按时间倒序逐个回退
        for (let i = 0; i < before.length; i++) {
          const r = undo(sessionId);
          results.push(`${r.ok ? "✓" : "✗"} ${r.message}`);
          if (r.ok) okCount++;
        }
        return createToolResponse(
          okCount > 0,
          `批量撤销完成（${okCount}/${before.length} 成功）：\n${results.join("\n")}`,
          { payload: { reverted: okCount, total: before.length } },
        );
      }

      // 撤销单次（可选指定 path）—— 历史记录存绝对路径，需把相对 path 转绝对才能匹配
      const userPath = String(params.path ?? params.file_path ?? "").trim();
      let absPath: string | undefined;
      if (userPath) {
        try {
          absPath = safePath(ctx.workingDir || ctx.projectRoot, userPath);
        } catch (err) {
          return createToolResponse(false, errToString(err));
        }
      }
      const result = undo(sessionId, absPath);
      return createToolResponse(result.ok, result.message, {
        payload: result.record
          ? { path: result.record.path, action: result.record.action, timestamp: result.record.timestamp, tool: result.record.toolName }
          : {},
      });
    } catch (err) {
      return createToolResponse(false, `撤销操作失败: ${errToString(err)}`);
    }
  }
}

/** 列出当前 session 的编辑历史（debug 用，可被 CLI 调用） */
export function listSessionEdits(sessionId: string) {
  return listEdits(sessionId);
}

/** 清理 session 编辑历史（会话清理时调用） */
export function clearSessionEdits(sessionId: string) {
  clearHistory(sessionId);
}
