/**
 * CodeSearch 工具 — 基于 sqry 的代码结构搜索（薄壳）
 * 搜的是代码结构（函数、类、调用关系），不是文本。
 * 重型逻辑（二进制发现/子进程/协议解析）已剥离到 @little-house-studio/sqry-engine。
 * 本文件只保留 schema + 派发 + 结果格式化。
 */

import { resolve } from "node:path";
import * as sqry from "@little-house-studio/sqry-engine";
import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { errToString } from "../../util/common.js";

// ─── 结果格式化（薄）──────────────────────────────────────────────────────

/** 提取摘要信息（控制输出长度） */
function trim(text: string, limit: number): string {
  const lines = text.trim().split("\n");
  if (lines.length <= limit) return text.trim();
  const shown = lines.slice(0, limit).join("\n");
  return `${shown}\n\n... 还有 ${lines.length - limit} 行结果未显示，请缩小搜索范围或增加 limit 参数。`;
}

/** 相对路径（保留末 3 段） */
function relFile(file: string): string {
  return file.includes("/") ? file.split("/").slice(-3).join("/") : file;
}

/** 格式化 search 结果 */
function formatSearch(r: sqry.SqrySearchResult, symbol: string, limit: number, kind?: string, lang?: string): ToolResponse {
  if (r.isJson) {
    if (r.entries.length === 0) {
      return createToolResponse(true, `未找到符号 "${symbol}"。`, { payload: { action: "search", symbol, count: 0 } });
    }
    const limited = r.entries.slice(0, limit);
    const formatted = limited.map(e =>
      `${e.kind ?? "?"} ${e.qualifiedName ?? e.name} → ${relFile(e.file)}:${e.line ?? "?"}`).join("\n");
    const meta = `[action=search | symbol=${symbol} | found=${r.totalMatches}${r.totalMatches > limit ? ` | shown=${limit}` : ""} | ${r.execMs ?? "?"}ms]`;
    return createToolResponse(true, `${meta}\n${formatted}`, { payload: { action: "search", symbol, count: r.totalMatches, results: limited } });
  }
  // 文本降级
  const output = trim(r.rawText ?? "", limit);
  const meta = `[action=search | symbol=${symbol}${kind ? ` | kind=${kind}` : ""}${lang ? ` | lang=${lang}` : ""} | lines=${r.totalMatches}]`;
  return createToolResponse(true, `${meta}\n${output}`, { payload: { action: "search", symbol, count: r.totalMatches } });
}

/** 格式化 graph 类结果 */
function formatGraph(r: sqry.SqryGraphResult, action: string, label: string, limit: number): ToolResponse {
  if (r.isJson) {
    if (r.entries.length === 0) {
      const summary = JSON.stringify(r.raw ?? {}, null, 2).slice(0, 500);
      return createToolResponse(true, `[action=${action} | ${label}]\n${summary}`, { payload: { action, label, raw: r.raw } });
    }
    const limited = r.entries.slice(0, limit);
    const formatted = limited.map(e =>
      `${e.kind ?? "?"} ${e.name} → ${relFile(e.file)}:${e.line ?? "?"}`).join("\n");
    const meta = `[action=${action} | ${label} | found=${r.totalFound}${r.entries.length > limit ? ` | shown=${limit}` : ""}]`;
    return createToolResponse(true, `${meta}\n${formatted}`, { payload: { action, label, count: r.entries.length, results: limited } });
  }
  const output = trim(r.rawText ?? "", limit);
  return createToolResponse(true, `[action=${action} | ${label}]\n${output}`, { payload: { action, label } });
}

/** 格式化纯文本结果 */
function formatText(text: string, action: string, label: string, limit: number, payload: Record<string, unknown>): ToolResponse {
  const output = trim(text, limit);
  return createToolResponse(true, `[action=${action} | ${label}]\n${output}`, { payload });
}

// ─── 工具类 ──────────────────────────────────────────────────────────────

export class CodeSearchTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "find_code",
    aliases: ["sqry", "code-search"],
    description:
      "代码结构搜索工具，类似 grep 但搜的是代码结构（函数、类、调用关系），不是文本。" +
      "返回符号名+文件路径+行号，不返回原始代码行。" +
      "能回答 grep 做不到的问题：谁调用了 X、X 依赖了谁、有哪些死代码、有没有循环依赖。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["search", "callers", "callees", "path", "cycles", "unused", "impact", "explain", "hierarchy", "duplicates", "subgraph"],
          description:
            "操作类型。search=按名搜符号，callers=谁调用了它，callees=它调用了谁，path=两符号间调用链，" +
            "cycles=循环依赖，unused=死代码，impact=修改影响范围，explain=符号上下文解释，hierarchy=调用层级，" +
            "duplicates=重复代码，subgraph=局部代码图。",
        },
        symbol: { type: "string", description: "要搜索的符号名。search/callers/callees/impact/explain/hierarchy/subgraph 必填。支持正则匹配。" },
        target: { type: "string", description: "目标符号名。path 查调用链时必填，与 symbol 组成起点→终点。" },
        kind: {
          type: "string",
          enum: ["function", "class", "method", "struct", "enum", "interface", "trait", "variable", "constant", "type", "module", "namespace"],
          description:
            "符号类型过滤。search/unused/impact/explain/path 等均可用于消歧（同文件内 interface 与 type 同名时尤其有用）。",
        },
        lang: {
          type: "string",
          description:
            "语言过滤。search/unused 时有效。可用正式 id（typescript/javascript/python/rust/go）或别名（ts/js/py/rs）。",
        },
        in_file: {
          type: "string",
          description:
            "符号所在文件路径（相对项目根）。歧义消歧用；impact/explain/search/path/hierarchy/subgraph 有效。",
        },
        exact: { type: "boolean", description: "精确匹配符号名（关闭正则）。默认 false（正则匹配）。" },
        fuzzy: { type: "boolean", description: "模糊匹配符号名。适合不确定确切名称时使用。默认 false。" },
        depth: { type: "integer", minimum: 1, maximum: 10, description: "调用关系搜索深度。impact 默认 3，subgraph 默认 2。值越大分析越深但越慢。" },
        scope: {
          type: "string",
          enum: ["all", "public", "private", "function", "struct"],
          description: "unused 模式专用。all=所有未使用符号，public=未使用的公开符号，private=未使用的私有符号，function=只看函数，struct=只看类型。默认 all。",
        },
        cycle_type: { type: "string", enum: ["calls", "imports", "modules"], description: "cycles 模式专用。calls=函数调用循环（默认），imports=文件导入循环，modules=模块循环。" },
        min_cycle_size: { type: "integer", minimum: 2, description: "cycles 模式专用。只返回包含 ≥N 个符号的循环。默认 2。" },
        direct_only: { type: "boolean", description: "impact 模式专用。true=只看直接依赖者，false=包含间接依赖。默认 false。" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "最大返回结果数。默认 30。" },
        reason: { type: "string", description: "为什么必须调用此工具而不是直接回复用户？说明工具不可替代的作用。" },
      },
      required: ["action", "reason"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
    parallelSafe: true,
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim();
    if (!action) return createToolResponse(false, '❌ find_code 缺少必填参数 action（操作类型）。正确用法示例：\n{"tool": "find_code", "params": {"action": "search", "symbol": "MyClass", "reason": "查找类定义"}}\n可选 action: search, callers, callees, path, cycles, unused, impact, explain, hierarchy, duplicates, subgraph。请用正确的 action 参数重试。');

    if (!sqry.isAvailable()) {
      return createToolResponse(false, "sqry 未安装。请运行: maou doctor 或 node scripts/ensure-sqry.mjs");
    }

    const cwd = resolve(ctx.workingDir || ctx.projectRoot);
    try {
      await sqry.ensureIndex(cwd);
    } catch (e) {
      return createToolResponse(false, `代码索引不可用: ${errToString(e)}`);
    }

    const sym = () => String(params.symbol ?? "").trim();
    const limit = Math.max(1, Math.min(200, Number(params.limit ?? 30)));

    try {
      switch (action) {
        case "callers": {
          if (!sym()) return createToolResponse(false, '❌ find_code callers 缺少必填参数 symbol（符号名）。正确用法示例：\n{"tool": "find_code", "params": {"action": "callers", "symbol": "myFunction", "reason": "查找谁调用了该函数"}}\n请用正确的 symbol 参数重试。');
          return formatGraph(await sqry.callers(cwd, sym()), "callers", sym(), limit);
        }
        case "callees": {
          if (!sym()) return createToolResponse(false, '❌ find_code callees 缺少必填参数 symbol（符号名）。正确用法示例：\n{"tool": "find_code", "params": {"action": "callees", "symbol": "myFunction", "reason": "查找该函数调用了谁"}}\n请用正确的 symbol 参数重试。');
          return formatGraph(await sqry.callees(cwd, sym()), "callees", sym(), limit);
        }
        case "path": {
          const target = String(params.target ?? "").trim();
          if (!sym() || !target) return createToolResponse(false, '❌ find_code path 缺少必填参数 symbol（起点）和 target（终点）。正确用法示例：\n{"tool": "find_code", "params": {"action": "path", "symbol": "funcA", "target": "funcB", "reason": "查找两函数间调用链"}}\n请用正确的 symbol 和 target 参数重试。');
          const r = await sqry.tracePath(cwd, sym(), target, {
            kind: params.kind ? String(params.kind) : undefined,
            inFile: params.in_file ? String(params.in_file) : undefined,
          });
          if (!r) return createToolResponse(true, `未找到从 "${sym()}" 到 "${target}" 的调用路径。可改用 callers/callees 手工追溯。`, { payload: { action: "path", symbol: sym(), target, found: false } });
          return formatGraph(r, "path", `${sym()} → ${target}`, 50);
        }
        case "hierarchy": {
          if (!sym()) return createToolResponse(false, '❌ find_code hierarchy 缺少必填参数 symbol（符号名）。正确用法示例：\n{"tool": "find_code", "params": {"action": "hierarchy", "symbol": "MyClass", "reason": "查看调用层级"}}\n请用正确的 symbol 参数重试。');
          return formatGraph(
            await sqry.hierarchy(cwd, sym(), {
              kind: params.kind ? String(params.kind) : undefined,
              inFile: params.in_file ? String(params.in_file) : undefined,
              depth: Number(params.depth ?? 2),
            }),
            "hierarchy",
            sym(),
            50,
          );
        }
        case "subgraph": {
          if (!sym()) return createToolResponse(false, '❌ find_code subgraph 缺少必填参数 symbol（符号名）。正确用法示例：\n{"tool": "find_code", "params": {"action": "subgraph", "symbol": "MyClass", "reason": "查看局部代码图"}}\n请用正确的 symbol 参数重试。');
          const depth = Math.max(1, Math.min(5, Number(params.depth ?? 2)));
          return formatGraph(
            await sqry.subgraph(cwd, sym(), depth, {
              kind: params.kind ? String(params.kind) : undefined,
              inFile: params.in_file ? String(params.in_file) : undefined,
              maxNodes: Math.max(1, Math.min(200, Number(params.limit ?? 80))),
            }),
            "subgraph",
            sym(),
            80,
          );
        }
        case "explain": {
          if (!sym()) return createToolResponse(false, '❌ find_code explain 缺少必填参数 symbol（符号名）。正确用法示例：\n{"tool": "find_code", "params": {"action": "explain", "symbol": "MyClass", "reason": "查看符号上下文解释"}}\n请用正确的 symbol 参数重试。');
          const r = await sqry.explain(cwd, sym(), {
            inFile: params.in_file ? String(params.in_file) : undefined,
            kind: params.kind ? String(params.kind) : undefined,
          });
          if (!r) return createToolResponse(true, `未找到符号 "${sym()}" 的解释信息。可先 search 再带 in_file 重试。`, { payload: { action: "explain", symbol: sym(), found: false } });
          if ("text" in r) return createToolResponse(true, `[action=explain | symbol=${sym()}]\n${trim(r.text, 50)}`, { payload: { action: "explain", symbol: sym() } });
          return formatGraph(r, "explain", sym(), 50);
        }
        case "cycles": {
          const type = (params.cycle_type as string) || "calls";
          const r = await sqry.cycles(cwd, { type: type as "calls" | "imports" | "modules", minDepth: Number(params.min_cycle_size ?? 2) });
          if (!r) return createToolResponse(true, "未发现循环依赖。", { payload: { action: "cycles", count: 0 } });
          return formatText(r.text, "cycles", `type=${type}`, 100, { action: "cycles", type });
        }
        case "unused": {
          // 默认 public，减少导出符号/HTML 噪声；可显式 scope=all
          const scope = (params.scope as string) || "public";
          const lang = params.lang ? String(params.lang) : undefined;
          const kind = params.kind ? String(params.kind) : undefined;
          const r = await sqry.unused(cwd, {
            scope,
            lang,
            kind,
            maxResults: Math.max(1, Math.min(200, Number(params.limit ?? 50))),
          });
          if (!r) return createToolResponse(true, "未发现死代码。", { payload: { action: "unused", count: 0 } });
          return formatText(r.text, "unused", `scope=${scope}${lang ? ` | lang=${lang}` : ""}${kind ? ` | kind=${kind}` : ""}`, Math.max(1, Math.min(200, Number(params.limit ?? 50))), { action: "unused", scope, lang, kind });
        }
        case "impact": {
          if (!sym()) return createToolResponse(false, '❌ find_code impact 缺少必填参数 symbol（符号名）。正确用法示例：\n{"tool": "find_code", "params": {"action": "impact", "symbol": "myFunction", "reason": "查看修改影响范围"}}\n请用正确的 symbol 参数重试。');
          const r = await sqry.impact(cwd, sym(), {
            inFile: params.in_file ? String(params.in_file) : undefined,
            kind: params.kind ? String(params.kind) : undefined,
            depth: Number(params.depth ?? 3),
            directOnly: Boolean(params.direct_only),
            limit: Math.max(1, Math.min(200, Number(params.limit ?? 100))),
          });
          if (!r) return createToolResponse(true, `未找到 "${sym()}" 的影响范围。`, { payload: { action: "impact", symbol: sym(), count: 0 } });
          return formatText(r.text, "impact", `symbol=${sym()}`, Math.max(1, Math.min(200, Number(params.limit ?? 100))), { action: "impact", symbol: sym() });
        }
        case "search": {
          if (!sym()) return createToolResponse(false, '❌ find_code search 缺少必填参数 symbol（符号名）。正确用法示例：\n{"tool": "find_code", "params": {"action": "search", "symbol": "MyClass", "reason": "查找类定义"}}\n请用正确的 symbol 参数重试。');
          const r = await sqry.search(cwd, sym(), {
            kind: params.kind ? String(params.kind) : undefined,
            lang: params.lang ? String(params.lang) : undefined,
            exact: Boolean(params.exact),
            fuzzy: Boolean(params.fuzzy),
            inFile: params.in_file ? String(params.in_file) : undefined,
          });
          return formatSearch(r, sym(), limit, params.kind ? String(params.kind) : undefined, params.lang ? String(params.lang) : undefined);
        }
        case "duplicates": {
          const r = await sqry.duplicates(cwd);
          if (!r) return createToolResponse(true, "未发现重复代码。", { payload: { action: "duplicates", count: 0 } });
          return formatText(r.text, "duplicates", "", 50, { action: "duplicates" });
        }
        default:
          return createToolResponse(false, `未知的 action: ${action}。可选: search, callers, callees, path, cycles, unused, impact, explain, hierarchy, duplicates, subgraph`);
      }
    } catch (e) {
      if (e instanceof sqry.SqryAmbiguousError) {
        return createToolResponse(
          false,
          `符号 "${e.symbol}" 存在多个定义，请用 kind（interface/class/type/…）和/或 in_file 消歧。\n${e.stderr}`,
          { payload: { action, symbol: e.symbol, ambiguous: true } },
        );
      }
      return createToolResponse(false, `code-search 执行失败: ${errToString(e)}`);
    }
  }
}
