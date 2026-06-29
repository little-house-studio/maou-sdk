/**
 * 编辑文件工具 — 查找并替换文件中的文本
 * 对应 Python: core/tools/impls/edit_file_tool.py
 */

import { readFileSync, existsSync } from "node:fs";
import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { safePath, errToString } from "../../browser/god_tool/use_browser/_util.js";
import { verifyAfterWrite } from "../../code/lsp_verify.js";
import { atomicWrite } from "../atomic-write.js";
import { wasRead, isStaleSinceRead, markRead, refreshRead } from "../read-registry.js";
import { record as recordEdit } from "../file-edit-history.js";

/** 统计 needle 在 haystack 中的出现次数（非重叠）。 */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

export class EditFileTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "edit_file",
    aliases: ["edit_file"],
    description:
      "Replace exact text in a file. old_text 必须在文件中唯一匹配（否则报错，需补充上下文使其唯一）；" +
      "若要替换全部相同文本，传 replace_all=true。编辑后会自动用 LSP 验证是否引入错误。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path from project root to the target file.",
        },
        old_text: {
          type: "string",
          description:
            "要替换的精确原文（含缩进/空白）。必须在文件中唯一出现，否则报错——请加上足够的前后文使其唯一。",
        },
        new_text: {
          type: "string",
          description: "The replacement text.",
        },
        replace_all: {
          type: "boolean",
          description: "为 true 时替换所有匹配（用于重命名等）；缺省 false，要求唯一匹配。",
        },
      },
      required: ["path", "old_text", "new_text"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
  };

  async execute(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const userPath = String(params.path ?? params.file_path ?? "").trim();
    const oldText = String(params.old_text ?? params.old_string ?? params.oldText ?? "");
    const newText = String(params.new_text ?? params.new_string ?? params.newText ?? "");
    const replaceAll = params.replace_all === true || params.replace_all === "true";

    if (!userPath) {
      return createToolResponse(false, '❌ edit_file 缺少必填参数 path（文件路径）。正确用法示例：\n{"tool": "edit_file", "params": {"path": "src/index.ts", "old_text": "旧文本", "new_text": "新文本"}}\n请用正确的 path 参数重试。');
    }
    if (!oldText) {
      return createToolResponse(false, "edit_file 的 old_text 不能为空（无法匹配空字符串）。如需创建/覆写文件请用 write_file。");
    }
    if (oldText === newText) {
      return createToolResponse(false, "old_text 与 new_text 相同，无需编辑。");
    }

    let fullPath: string;
    try {
      fullPath = safePath(ctx.workingDir || ctx.projectRoot, userPath);
    } catch (err: unknown) {
      return createToolResponse(false, errToString(err));
    }

    if (!existsSync(fullPath)) {
      return createToolResponse(false, `文件不存在: ${userPath}（建议先用 glob 工具搜索正确路径，例如 glob pattern="**/${userPath.split("/").pop()}"）`);
    }

    try {
      const content = readFileSync(fullPath, "utf-8");

      // ── 先读后改（防盲改覆盖）──
      // 未读过该文件 / 读后被外部改动 → 返回当前内容并提示，避免基于陈旧假设覆盖。
      // 返回内容后登记为已读，模型据此重试即可（不浪费一轮单独 read）。
      const sid = ctx.sessionId;
      if (sid && (!wasRead(sid, fullPath) || isStaleSinceRead(sid, fullPath))) {
        const stale = wasRead(sid, fullPath);
        markRead(sid, fullPath);
        const numbered = content.split("\n").map((l, i) => `${String(i + 1).padStart(4)}\t${l}`).join("\n");
        const why = stale
          ? "该文件在你上次读取后被改动过（磁盘 mtime 已变）"
          : "你尚未读取该文件就尝试编辑";
        return createToolResponse(
          false,
          `${why}。为避免覆盖未知改动，请先 read 再 edit。\n以下是该文件**当前**完整内容，请据此构造精确的 old_text 后重试：\n\n${numbered}`,
          { payload: { path: fullPath, reason: stale ? "stale" : "unread", total_lines: content.split("\n").length } },
        );
      }

      const occurrences = countOccurrences(content, oldText);

      // 0 处匹配 —— 给明确的下一步指引，避免盲目重试
      if (occurrences === 0) {
        const hint = [
          "可能的原因与对策：",
          "1. 缩进/空白差异：用 read 工具查看目标行的精确内容（含前导空格），再重新构造 old_text。",
          "2. 文本不存在：用 grep 工具确认文件中是否包含该关键字。",
          "3. 文件过大：先用 read start_line/end_line 缩小范围定位目标行。",
        ].join("\n");
        return createToolResponse(false, `未找到要替换的文本。\n${hint}`, {
          payload: {
            path: fullPath,
            old_text_length: oldText.length,
            file_length: content.length,
            old_text_preview: oldText.slice(0, 120),
          },
        });
      }

      // 多处匹配且未要求替换全部 —— 拒绝，要求唯一匹配（防止改错位置）
      if (occurrences > 1 && !replaceAll) {
        return createToolResponse(
          false,
          `old_text 在文件中出现 ${occurrences} 处，不唯一。请在 old_text 中加入更多前后文使其唯一定位；` +
          `若确实要替换全部 ${occurrences} 处（如重命名），请传 replace_all=true。`,
          {
            payload: { path: fullPath, occurrences, old_text_preview: oldText.slice(0, 120) },
          },
        );
      }

      // 执行替换：唯一匹配 → 替换该处；replace_all → 全部替换
      let updated: string;
      let replacedCount: number;
      if (replaceAll) {
        updated = content.split(oldText).join(newText);
        replacedCount = occurrences;
      } else {
        const index = content.indexOf(oldText);
        updated = content.slice(0, index) + newText + content.slice(index + oldText.length);
        replacedCount = 1;
      }
      // 登记编辑历史（diff 标记）—— 在 atomicWrite 之前，存下 before 内容供 undo
      if (ctx.sessionId) {
        recordEdit(ctx.sessionId, fullPath, content, updated, {
          toolName: "edit_file",
          action: "edit",
        });
      }
      atomicWrite(fullPath, updated);
      if (ctx.sessionId) refreshRead(ctx.sessionId, fullPath); // 写后即视为已读最新

      const totalLines = updated.split("\n").length;
      const meta = `[path=${fullPath} | replaced=${replacedCount} | old_len=${oldText.length} | new_len=${newText.length} | total_lines=${totalLines}]`;

      // 自我验证闭环：编辑后用 LSP 检查是否引入错误，结果拼回供模型自修
      const lspNote = await verifyAfterWrite(fullPath);

      return createToolResponse(
        true,
        `文件已编辑: ${userPath}（替换 ${replacedCount} 处）\n${meta}${lspNote ?? ""}`,
        {
          payload: {
            path: fullPath,
            replaced_count: replacedCount,
            old_text_length: oldText.length,
            new_text_length: newText.length,
            total_lines: totalLines,
            lsp_verified: lspNote !== null,
          },
        },
      );
    } catch (err: unknown) {
      return createToolResponse(false, `编辑文件失败: ${errToString(err)}`);
    }
  }
}
