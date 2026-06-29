/**
 * LSP 工具 — 基于语言服务器的语义代码分析（薄壳）
 *
 * 提供 sqry 做不到的能力：诊断（代码是否无错）、语义跳转/引用、类型/悬停、重命名（预览）、补全。
 * 重型逻辑在 @little-house-studio/lsp-engine。本文件只做 schema + 派发 + 格式化。
 *
 * 注意：工具层 line/character 为 1-based，传给引擎前 -1（LSP 原生 0-based）。
 */

import { resolve } from "node:path";
import * as lsp from "@little-house-studio/lsp-engine";
import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { safePath, errToString } from "../../browser/god_tool/use_browser/_util.js";

function relFile(file: string, root: string): string {
  return file.startsWith(root) ? file.slice(root.length).replace(/^\//, "") : file;
}

function fmtLoc(l: lsp.Loc, root: string): string {
  return `${relFile(l.file, root)}:${l.line + 1}:${l.character + 1}`;
}

export class LspTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "lsp",
    aliases: ["check_code", "lsp_check", "diagnostics"],
    description:
      "语义代码分析工具（基于语言服务器 LSP）。提供 sqry 做不到的精确语义能力：\n" +
      "- check/diagnostics：检查代码是否有错误（无 file 检查整个工程）。这是判断「代码是否达到无错误状态」的权威方式。\n" +
      "- definition/references/type_definition：语义跳转/查引用/查类型定义（跨文件、类型感知，比文本搜索准）。\n" +
      "- hover：拿到符号的真实类型签名和文档。\n" +
      "- rename：安全重命名预览（只返回会改哪些位置，不写盘）。\n" +
      "- completion：代码补全。\n" +
      "- symbols/workspace_symbols：列文件符号 / 全工程搜符号。\n" +
      "支持 TS/JS/Python/Rust 等（按文件扩展名自动选语言服务器）。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["check", "diagnostics", "definition", "references", "type_definition", "hover", "rename", "completion", "symbols", "workspace_symbols"],
          description:
            "操作类型。check/diagnostics=检查错误（无 file 检查整个工程）；" +
            "definition/references/type_definition/hover/rename/completion 需 file+line+character；" +
            "symbols=列文件符号（需 file）；workspace_symbols=全工程搜符号（需 query）。",
        },
        file: { type: "string", description: "文件路径（相对项目根）。除 workspace_symbols 外多数 action 需要。" },
        line: { type: "integer", minimum: 1, description: "行号（1-based）。位置类 action 必填。" },
        character: { type: "integer", minimum: 1, description: "列号（1-based）。位置类 action 必填。" },
        new_name: { type: "string", description: "rename 的新名字。" },
        query: { type: "string", description: "workspace_symbols 的搜索词。" },
        settle_ms: { type: "integer", description: "诊断收敛静默期(ms)。默认单文件 600，全工程 1500。" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "completion/symbols 最大返回数。默认 50。" },
        reason: { type: "string", description: "为什么必须调用此工具而不是直接回复用户？" },
      },
      required: ["action", "reason"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
    parallelSafe: true,
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim();
    if (!action) return createToolResponse(false, '❌ lsp 缺少必填参数 action（操作类型）。正确用法示例：\n{"tool": "lsp", "params": {"action": "check", "file": "src/index.ts", "reason": "检查代码错误"}}\n可选 action: check, diagnostics, definition, references, type_definition, hover, rename, completion, symbols, workspace_symbols。请用正确的 action 参数重试。');

    const root = resolve(ctx.workingDir || ctx.projectRoot);
    const fileParam = params.file ? String(params.file) : "";
    const absFile = fileParam ? safePath(root, fileParam) : "";
    // 1-based → 0-based
    const line = params.line != null ? Math.max(0, Number(params.line) - 1) : 0;
    const character = params.character != null ? Math.max(0, Number(params.character) - 1) : 0;
    const limit = Math.max(1, Math.min(200, Number(params.limit ?? 50)));

    // 可用性检查（位置类/单文件 action 需要 file）
    if (absFile && !lsp.isServerAvailable(absFile)) {
      return createToolResponse(false, `没有为该文件类型配置语言服务器: ${fileParam}`);
    }

    try {
      switch (action) {
        case "check":
        case "diagnostics": {
          if (absFile) {
            const r = await lsp.diagnostics(absFile, { settleMs: params.settle_ms ? Number(params.settle_ms) : undefined });
            return this.fmtFileDiags(r, root);
          }
          // 全工程
          const r = await lsp.diagnosticsWorkspace(root, { settleMs: params.settle_ms ? Number(params.settle_ms) : undefined });
          return this.fmtWorkspaceDiags(r, root);
        }
        case "definition": {
          if (!absFile) return createToolResponse(false, '❌ lsp definition 缺少必填参数 file/line/character。正确用法示例：\n{"tool": "lsp", "params": {"action": "definition", "file": "src/index.ts", "line": 10, "character": 5, "reason": "跳转到定义"}}\n请用正确的 file、line、character 参数重试。');
          const locs = await lsp.definition(absFile, line, character);
          return this.fmtLocs(locs, "definition", root);
        }
        case "type_definition": {
          if (!absFile) return createToolResponse(false, '❌ lsp type_definition 缺少必填参数 file/line/character。正确用法示例：\n{"tool": "lsp", "params": {"action": "type_definition", "file": "src/index.ts", "line": 10, "character": 5, "reason": "跳转到类型定义"}}\n请用正确的 file、line、character 参数重试。');
          const locs = await lsp.typeDefinition(absFile, line, character);
          return this.fmtLocs(locs, "type_definition", root);
        }
        case "references": {
          if (!absFile) return createToolResponse(false, '❌ lsp references 缺少必填参数 file/line/character。正确用法示例：\n{"tool": "lsp", "params": {"action": "references", "file": "src/index.ts", "line": 10, "character": 5, "reason": "查找引用"}}\n请用正确的 file、line、character 参数重试。');
          const locs = await lsp.references(absFile, line, character);
          return this.fmtLocs(locs, "references", root);
        }
        case "hover": {
          if (!absFile) return createToolResponse(false, '❌ lsp hover 缺少必填参数 file/line/character。正确用法示例：\n{"tool": "lsp", "params": {"action": "hover", "file": "src/index.ts", "line": 10, "character": 5, "reason": "查看类型签名"}}\n请用正确的 file、line、character 参数重试。');
          const h = await lsp.hover(absFile, line, character);
          if (!h) return createToolResponse(true, "（无悬停信息）", { payload: { action: "hover" } });
          return createToolResponse(true, `[hover]\n${h.contents}`, { payload: { action: "hover", contents: h.contents } });
        }
        case "rename": {
          if (!absFile) return createToolResponse(false, '❌ lsp rename 缺少必填参数 file/line/character。正确用法示例：\n{"tool": "lsp", "params": {"action": "rename", "file": "src/index.ts", "line": 10, "character": 5, "new_name": "newVarName", "reason": "重命名符号"}}\n请用正确的 file、line、character 参数重试。');
          const newName = String(params.new_name ?? "").trim();
          if (!newName) return createToolResponse(false, '❌ lsp rename 缺少必填参数 new_name（新名字）。正确用法示例：\n{"tool": "lsp", "params": {"action": "rename", "file": "src/index.ts", "line": 10, "character": 5, "new_name": "newVarName", "reason": "重命名符号"}}\n请用正确的 new_name 参数重试。');
          const preview = await lsp.rename(absFile, line, character, newName);
          if (preview.totalEdits === 0) return createToolResponse(true, "（无可重命名的引用，或当前位置不可重命名）", { payload: { action: "rename" } });
          const lines = preview.changes.map(c => `${relFile(c.file, root)} (${c.edits.length} 处)`);
          return createToolResponse(true,
            `[rename 预览：${preview.totalFiles} 文件 / ${preview.totalEdits} 处改动 → "${newName}"]\n${lines.join("\n")}\n\n⚠️ 仅预览，未写盘。如需应用请用 edit_file。`,
            { payload: { action: "rename", preview } });
        }
        case "completion": {
          if (!absFile) return createToolResponse(false, '❌ lsp completion 缺少必填参数 file/line/character。正确用法示例：\n{"tool": "lsp", "params": {"action": "completion", "file": "src/index.ts", "line": 10, "character": 5, "reason": "代码补全"}}\n请用正确的 file、line、character 参数重试。');
          const items = await lsp.completion(absFile, line, character, { limit });
          if (items.length === 0) return createToolResponse(true, "（无补全建议）", { payload: { action: "completion" } });
          const formatted = items.map(it => `${it.label}${it.detail ? ` — ${it.detail}` : ""}`).join("\n");
          return createToolResponse(true, `[completion | ${items.length} 项]\n${formatted}`, { payload: { action: "completion", count: items.length } });
        }
        case "symbols": {
          if (!absFile) return createToolResponse(false, '❌ lsp symbols 缺少必填参数 file（文件路径）。正确用法示例：\n{"tool": "lsp", "params": {"action": "symbols", "file": "src/index.ts", "reason": "列出文件符号"}}\n请用正确的 file 参数重试。');
          const syms = await lsp.documentSymbols(absFile);
          return this.fmtSymbols(syms, "symbols", root, limit);
        }
        case "workspace_symbols": {
          const query = String(params.query ?? "").trim();
          if (!query) return createToolResponse(false, '❌ lsp workspace_symbols 缺少必填参数 query（搜索词）。正确用法示例：\n{"tool": "lsp", "params": {"action": "workspace_symbols", "query": "MyClass", "reason": "全工程搜符号"}}\n请用正确的 query 参数重试。');
          const syms = await lsp.workspaceSymbols(query, root);
          return this.fmtSymbols(syms, "workspace_symbols", root, limit);
        }
        default:
          return createToolResponse(false, `未知的 action: ${action}`);
      }
    } catch (e) {
      if (e instanceof lsp.ServerNotInstalledError) {
        return createToolResponse(false, e.message);
      }
      if (e instanceof lsp.NoServerForFileError) {
        return createToolResponse(false, e.message);
      }
      return createToolResponse(false, `lsp 执行失败: ${errToString(e)}`);
    }
  }

  private fmtFileDiags(r: lsp.FileDiags, root: string): ToolResponse {
    if (r.diagnostics.length === 0) {
      // settled:false 表示语言服务器未在时限内给出结果，不能据此宣称"无错误"
      if (r.settle && !r.settle.settled) {
        return createToolResponse(true,
          `⚠️ ${relFile(r.file, root)}：语言服务器在 ${Math.round(r.settle.waitedMs / 1000)}s 内未返回诊断（可能仍在启动/索引），无法确认是否无错误。`,
          { payload: { action: "diagnostics", errorCount: 0, settled: false } });
      }
      return createToolResponse(true, `✅ ${relFile(r.file, root)} 无错误。`, { payload: { action: "diagnostics", errorCount: 0, settled: true } });
    }
    const lines = r.diagnostics.map(d => `  ${d.severity} [${d.line + 1}:${d.character + 1}] ${d.message}${d.code ? ` (${d.code})` : ""}`);
    const errors = r.diagnostics.filter(d => d.severity === "error").length;
    return createToolResponse(true, `[${relFile(r.file, root)} | ${r.diagnostics.length} 条诊断, ${errors} 错误]\n${lines.join("\n")}`,
      { payload: { action: "diagnostics", errorCount: errors, diagnostics: r.diagnostics } });
  }

  private fmtWorkspaceDiags(r: lsp.WorkspaceDiagsResult, root: string): ToolResponse {
    const settleNote = r.settle.settled
      ? ""
      : `\n⚠️ 语言服务器在 ${Math.round(r.settle.waitedMs / 1000)}s 内未稳定（仍在索引/检查），结果可能不完整。`;

    if (r.errorCount === 0 && r.warningCount === 0) {
      const status = r.settle.settled ? "✅ 项目无错误。" : `（未发现错误，但${settleNote.trim()}）`;
      return createToolResponse(true, status, { payload: { action: "diagnostics", errorCount: 0, warningCount: 0, settled: r.settle.settled } });
    }

    const blocks = r.files.slice(0, 50).map(f => {
      const lines = f.diagnostics.slice(0, 20).map(d => `  ${d.severity} [${d.line + 1}:${d.character + 1}] ${d.message}`);
      return `${relFile(f.file, root)}:\n${lines.join("\n")}`;
    });
    return createToolResponse(true,
      `[全工程诊断 | ${r.errorCount} 错误, ${r.warningCount} 警告]${settleNote}\n\n${blocks.join("\n\n")}`,
      { payload: { action: "diagnostics", errorCount: r.errorCount, warningCount: r.warningCount, settled: r.settle.settled } });
  }

  private fmtLocs(locs: lsp.Loc[], action: string, root: string): ToolResponse {
    if (locs.length === 0) return createToolResponse(true, `（未找到 ${action} 结果）`, { payload: { action, count: 0 } });
    const formatted = locs.map(l => `  → ${fmtLoc(l, root)}`).join("\n");
    return createToolResponse(true, `[${action} | ${locs.length} 处]\n${formatted}`, { payload: { action, count: locs.length, locations: locs } });
  }

  private fmtSymbols(syms: lsp.SymbolLite[], action: string, root: string, limit: number): ToolResponse {
    if (syms.length === 0) return createToolResponse(true, "（无符号）", { payload: { action, count: 0 } });
    const limited = syms.slice(0, limit);
    const formatted = limited.map(s => `  ${s.kind} ${s.name}${s.containerName ? ` (in ${s.containerName})` : ""} → ${relFile(s.file, root)}:${s.line + 1}`).join("\n");
    return createToolResponse(true, `[${action} | ${syms.length} 个符号${syms.length > limit ? `, 显示前 ${limit}` : ""}]\n${formatted}`,
      { payload: { action, count: syms.length } });
  }
}

// ─── 生命周期（供 harness 退出时关服务器）──────────────────────────────────

export async function shutdownLspEngine(): Promise<void> {
  try { await lsp.shutdownAll(); } catch { /* ignore */ }
}

export async function cleanupWorkspaceLsp(root: string): Promise<void> {
  try { await lsp.cleanupWorkspace(root); } catch { /* ignore */ }
}
