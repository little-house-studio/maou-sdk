/**
 * CodeSearch 工具 — 基于 sqry 的代码结构搜索
 * 搜的是代码结构（函数、类、调用关系），不是文本。
 * 返回符号名+文件路径+行号，不返回原始代码行。
 * 能回答 grep 做不到的问题：谁调用了 X、X 依赖了谁、有没有循环依赖、死代码。
 */

import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

// ─── sqry 二进制查找 ──────────────────────────────────────────────────────

/** 查找 sqry 二进制路径 */
function findSqryBinary(): string | null {
  const candidates = [
    // cargo 安装
    join(process.env.HOME ?? "", ".cargo/bin/sqry"),
    // maou 自带
    join(process.env.HOME ?? "", ".maou/bin/sqry"),
    // 系统 PATH
    "sqry",
  ];
  for (const c of candidates) {
    try {
      if (c === "sqry") {
        // 检查 PATH 中是否存在
        const result = require("child_process").execSync("which sqry 2>/dev/null", { encoding: "utf-8" }).trim();
        if (result) return "sqry";
      } else if (existsSync(c)) {
        return c;
      }
    } catch {
      // 继续
    }
  }
  return null;
}

// ─── 执行 sqry 命令 ──────────────────────────────────────────────────────

function runSqry(args: string[], cwd: string, timeout = 30000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const bin = findSqryBinary();
    if (!bin) {
      resolve({ stdout: "", stderr: "sqry 未安装。请运行: cargo install sqry", code: 1 });
      return;
    }

    const cmd = `${bin} ${args.map(a => {
      // 包含空格或特殊字符的参数加引号
      if (/[\s'"\\{}()<>|&;$!?*]/.test(a)) {
        return `'${a.replace(/'/g, "'\\''")}'`;
      }
      return a;
    }).join(" ")}`;

    exec(cmd, { cwd, timeout, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        code: err && !stdout ? 1 : 0,
      });
    });
  });
}

// ─── 确保索引存在 ────────────────────────────────────────────────────────

async function ensureIndex(cwd: string): Promise<string | null> {
  const idxDir = join(cwd, ".sqry/graph");
  if (existsSync(idxDir)) return null; // 已有索引

  const result = await runSqry(["index", "--force", "."], cwd, 120000);
  if (result.code !== 0 && !result.stdout.includes("Index built")) {
    return result.stderr || "索引构建失败";
  }
  return null;
}

// ─── 格式化输出 ─────────────────────────────────────────────────────────

/** 提取摘要信息（控制输出长度） */
function trimOutput(text: string, limit: number): string {
  const lines = text.trim().split("\n");
  if (lines.length <= limit) return text.trim();
  const shown = lines.slice(0, limit).join("\n");
  const omitted = lines.length - limit;
  return `${shown}\n\n... 还有 ${omitted} 行结果未显示，请缩小搜索范围或增加 limit 参数。`;
}

// ─── action 实现 ────────────────────────────────────────────────────────

/** search: 按名搜符号 */
async function doSearch(params: Record<string, unknown>, cwd: string): Promise<ToolResponse> {
  const symbol = String(params.symbol ?? "").trim();
  if (!symbol) return createToolResponse(false, "code-search search 缺少 symbol 参数");

  const kind = params.kind ? String(params.kind) : undefined;
  const lang = params.lang ? String(params.lang) : undefined;
  const exact = Boolean(params.exact);
  const fuzzy = Boolean(params.fuzzy);
  const limit = Math.max(1, Math.min(200, Number(params.limit ?? 30)));
  const format = "json";

  const args = ["search", "--json"];
  if (kind) args.push("--kind", kind);
  if (lang) args.push("--lang", lang);
  if (exact) args.push("--exact");
  if (fuzzy) args.push("--fuzzy");
  args.push(symbol, ".");

  const result = await runSqry(args, cwd);
  if (result.code !== 0 && !result.stdout.trim()) {
    return createToolResponse(true, `未找到符号 "${symbol}"。`, {
      payload: { action: "search", symbol, count: 0 },
    });
  }

  // 解析 JSON 输出
  try {
    const obj = JSON.parse(result.stdout.trim());
    const entries: Record<string, unknown>[] = obj.results ?? [];
    const totalMatches = obj.stats?.total_matches ?? entries.length;
    const execMs = obj.query?.execution_time_ms ?? "?";

    if (entries.length === 0) {
      return createToolResponse(true, `未找到符号 "${symbol}"。`, {
        payload: { action: "search", symbol, count: 0 },
      });
    }

    const limited = entries.slice(0, limit);
    const formatted = limited.map(e => {
      const name = e.qualified_name ?? e.name ?? "?";
      const kindStr = e.kind ?? "?";
      const file = (e.file_path ?? e.file ?? "?") as string;
      const relFile = file.includes("/") ? file.split("/").slice(-3).join("/") : file;
      const line = e.start_line ?? e.line ?? "?";
      return `${kindStr} ${name} → ${relFile}:${line}`;
    }).join("\n");

    const meta = `[action=search | symbol=${symbol} | found=${totalMatches}${totalMatches > limit ? ` | shown=${limit}` : ""} | ${execMs}ms]`;
    return createToolResponse(true, `${meta}\n${formatted}`, {
      payload: { action: "search", symbol, count: totalMatches, results: limited },
    });
  } catch {
    // 非 JSON，按文本处理
  }

  // 文本输出降级
  const output = trimOutput(result.stdout, limit);
  const lineCount = result.stdout.trim().split("\n").filter(l => l.trim()).length;
  const meta = `[action=search | symbol=${symbol}${kind ? ` | kind=${kind}` : ""}${lang ? ` | lang=${lang}` : ""} | lines=${lineCount}]`;
  return createToolResponse(true, `${meta}\n${output}`, {
    payload: { action: "search", symbol, count: lineCount },
  });
}

/** callers: 谁调用了它 */
async function doCallers(params: Record<string, unknown>, cwd: string): Promise<ToolResponse> {
  const symbol = String(params.symbol ?? "").trim();
  if (!symbol) return createToolResponse(false, "code-search callers 缺少 symbol 参数");

  const limit = Math.max(1, Math.min(200, Number(params.limit ?? 30)));

  // graph 子命令用 --json（不是 --format json）
  const args = ["graph", "direct-callers", symbol, "--json"];
  const result = await runSqry(args, cwd);

  if (result.code !== 0 && !result.stdout.trim()) {
    return createToolResponse(true, `未找到 "${symbol}" 的调用者。`, {
      payload: { action: "callers", symbol, count: 0 },
    });
  }

  return formatGraphOutput(result.stdout, "callers", symbol, limit);
}

/** callees: 它调用了谁 */
async function doCallees(params: Record<string, unknown>, cwd: string): Promise<ToolResponse> {
  const symbol = String(params.symbol ?? "").trim();
  if (!symbol) return createToolResponse(false, "code-search callees 缺少 symbol 参数");

  const limit = Math.max(1, Math.min(200, Number(params.limit ?? 30)));

  const args = ["graph", "direct-callees", symbol, "--json"];
  const result = await runSqry(args, cwd);

  if (result.code !== 0 && !result.stdout.trim()) {
    return createToolResponse(true, `未找到 "${symbol}" 的被调用者。`, {
      payload: { action: "callees", symbol, count: 0 },
    });
  }

  return formatGraphOutput(result.stdout, "callees", symbol, limit);
}

/** path: 两符号间调用链 */
async function doPath(params: Record<string, unknown>, cwd: string): Promise<ToolResponse> {
  const symbol = String(params.symbol ?? "").trim();
  const target = String(params.target ?? "").trim();
  if (!symbol || !target) return createToolResponse(false, "code-search path 需要 symbol（起点）和 target（终点）");

  const args = ["graph", "trace-path", symbol, target, "--json"];
  const result = await runSqry(args, cwd);

  if (result.code !== 0 || !result.stdout.trim()) {
    return createToolResponse(true, `未找到从 "${symbol}" 到 "${target}" 的调用路径。`, {
      payload: { action: "path", symbol, target, found: false },
    });
  }

  return formatGraphOutput(result.stdout, "path", `${symbol} → ${target}`, 50);
}

/** cycles: 循环依赖 */
async function doCycles(params: Record<string, unknown>, cwd: string): Promise<ToolResponse> {
  const type = (params.cycle_type as string) || "calls";
  const minDepth = Math.max(2, Number(params.min_cycle_size ?? 2));

  const args = ["cycles", "--type", type, "--min-depth", String(minDepth), "--json", "."];
  const result = await runSqry(args, cwd);

  if (result.code !== 0 && !result.stdout.trim()) {
    return createToolResponse(true, "未发现循环依赖。", {
      payload: { action: "cycles", count: 0 },
    });
  }

  // cycles 可能输出纯文本
  const output = trimOutput(result.stdout || result.stderr, 100);
  const meta = `[action=cycles | type=${type} | min_depth=${minDepth}]`;
  return createToolResponse(true, `${meta}\n${output}`, {
    payload: { action: "cycles", type, min_depth: minDepth },
  });
}

/** unused: 死代码 */
async function doUnused(params: Record<string, unknown>, cwd: string): Promise<ToolResponse> {
  const scope = (params.scope as string) || "all";
  const lang = params.lang ? String(params.lang) : undefined;
  const limit = Math.max(1, Math.min(200, Number(params.limit ?? 50)));

  const args = ["unused", "--scope", scope, "."];
  if (lang) args.push("--lang", lang);

  const result = await runSqry(args, cwd);

  if (result.code !== 0 && !result.stdout.trim()) {
    return createToolResponse(true, "未发现死代码。", {
      payload: { action: "unused", count: 0 },
    });
  }

  const output = trimOutput(result.stdout || result.stderr, limit);
  const meta = `[action=unused | scope=${scope}${lang ? ` | lang=${lang}` : ""}]`;
  return createToolResponse(true, `${meta}\n${output}`, {
    payload: { action: "unused", scope, lang },
  });
}

/** impact: 修改影响范围 */
async function doImpact(params: Record<string, unknown>, cwd: string): Promise<ToolResponse> {
  const symbol = String(params.symbol ?? "").trim();
  if (!symbol) return createToolResponse(false, "code-search impact 缺少 symbol 参数");

  const inFile = params.in_file ? String(params.in_file) : undefined;
  const depth = Math.max(1, Math.min(10, Number(params.depth ?? 3)));
  const directOnly = Boolean(params.direct_only);
  const limit = Math.max(1, Math.min(200, Number(params.limit ?? 100)));

  const args = ["impact", symbol, "--depth", String(depth), "--limit", String(limit)];
  if (inFile) args.push("--in", inFile);
  if (directOnly) args.push("--direct-only");

  const result = await runSqry(args, cwd);

  if (result.code !== 0 && !result.stdout.trim()) {
    // 可能是消歧错误
    if (result.stderr.includes("ambiguous")) {
      return createToolResponse(false, `符号 "${symbol}" 存在多个定义，请用 in_file 参数指定文件路径。\n${result.stderr}`, {
        payload: { action: "impact", symbol, ambiguous: true },
      });
    }
    return createToolResponse(true, `未找到 "${symbol}" 的影响范围。`, {
      payload: { action: "impact", symbol, count: 0 },
    });
  }

  const output = trimOutput(result.stdout || result.stderr, limit);
  const meta = `[action=impact | symbol=${symbol} | depth=${depth}${directOnly ? " | direct_only" : ""}]`;
  return createToolResponse(true, `${meta}\n${output}`, {
    payload: { action: "impact", symbol, depth, direct_only: directOnly },
  });
}

/** explain: 解释符号上下文 */
async function doExplain(params: Record<string, unknown>, cwd: string): Promise<ToolResponse> {
  const symbol = String(params.symbol ?? "").trim();
  if (!symbol) return createToolResponse(false, "code-search explain 缺少 symbol 参数");

  const args = ["explain", symbol, "--json"];
  const result = await runSqry(args, cwd);

  if (result.code !== 0 && !result.stdout.trim()) {
    // explain 可能只支持文本输出
    const args2 = ["explain", symbol];
    const result2 = await runSqry(args2, cwd);
    if (result2.code !== 0 && !result2.stdout.trim()) {
      return createToolResponse(true, `未找到符号 "${symbol}" 的解释信息。`, {
        payload: { action: "explain", symbol, found: false },
      });
    }
    const output = trimOutput(result2.stdout || result2.stderr, 50);
    return createToolResponse(true, `[action=explain | symbol=${symbol}]\n${output}`, {
      payload: { action: "explain", symbol },
    });
  }

  return formatGraphOutput(result.stdout, "explain", symbol, 50);
}

/** hierarchy: 调用层级 */
async function doHierarchy(params: Record<string, unknown>, cwd: string): Promise<ToolResponse> {
  const symbol = String(params.symbol ?? "").trim();
  if (!symbol) return createToolResponse(false, "code-search hierarchy 缺少 symbol 参数");

  const args = ["graph", "call-hierarchy", symbol, "--json"];
  const result = await runSqry(args, cwd);

  if (result.code !== 0 && !result.stdout.trim()) {
    return createToolResponse(true, `未找到 "${symbol}" 的调用层级。`, {
      payload: { action: "hierarchy", symbol, count: 0 },
    });
  }

  return formatGraphOutput(result.stdout, "hierarchy", symbol, 50);
}

/** duplicates: 重复代码 */
async function doDuplicates(params: Record<string, unknown>, cwd: string): Promise<ToolResponse> {
  const args = ["duplicates", "."];
  const result = await runSqry(args, cwd, 60000);

  if (result.code !== 0 && !result.stdout.trim()) {
    return createToolResponse(true, "未发现重复代码。", {
      payload: { action: "duplicates", count: 0 },
    });
  }

  const output = trimOutput(result.stdout || result.stderr, 50);
  return createToolResponse(true, `[action=duplicates]\n${output}`, {
    payload: { action: "duplicates" },
  });
}

/** subgraph: 局部代码图 */
async function doSubgraph(params: Record<string, unknown>, cwd: string): Promise<ToolResponse> {
  const symbol = String(params.symbol ?? "").trim();
  if (!symbol) return createToolResponse(false, "code-search subgraph 缺少 symbol 参数");

  const depth = Math.max(1, Math.min(5, Number(params.depth ?? 2)));

  const args = ["subgraph", "-d", String(depth), symbol, "--json"];
  const result = await runSqry(args, cwd);

  if (result.code !== 0 && !result.stdout.trim()) {
    return createToolResponse(true, `未找到 "${symbol}" 的子图。`, {
      payload: { action: "subgraph", symbol, found: false },
    });
  }

  return formatGraphOutput(result.stdout, "subgraph", symbol, 80);
}

// ─── 通用格式化 ──────────────────────────────────────────────────────────

function formatGraphOutput(raw: string, action: string, label: string, limit: number): ToolResponse {
  // sqry graph 输出完整 JSON 对象（非 JSON lines）
  // 尝试解析为完整 JSON 对象
  try {
    const obj = JSON.parse(raw.trim());

    // 提取结果数组——不同命令的字段名不同
    let entries: Record<string, unknown>[] = [];
    let totalFound = 0;

    if (Array.isArray(obj)) {
      entries = obj;
    } else if (obj.callers) {
      entries = obj.callers;
      totalFound = obj.total ?? entries.length;
    } else if (obj.callees) {
      entries = obj.callees;
      totalFound = obj.total ?? entries.length;
    } else if (obj.incoming || obj.outgoing) {
      // call-hierarchy 格式
      const incoming = Array.isArray(obj.incoming) ? obj.incoming : [];
      const outgoing = Array.isArray(obj.outgoing) ? obj.outgoing : [];
      entries = [...incoming, ...outgoing];
      totalFound = entries.length;
    } else if (obj.direct || obj.indirect) {
      // impact 格式
      const direct = Array.isArray(obj.direct) ? obj.direct : [];
      const indirect = Array.isArray(obj.indirect) ? obj.indirect : [];
      entries = [...direct, ...indirect];
      totalFound = obj.stats?.total_affected ?? entries.length;
    } else if (obj.results) {
      entries = obj.results;
      totalFound = obj.stats?.total_matches ?? entries.length;
    } else if (obj.cycles) {
      entries = obj.cycles;
      totalFound = entries.length;
    }

    if (entries.length === 0) {
      // 可能是只有 stats/metadata 的对象
      const summary = JSON.stringify(obj, null, 2).slice(0, 500);
      return createToolResponse(true, `[action=${action} | ${label}]\n${summary}`, {
        payload: { action, label, raw: obj },
      });
    }

    const limited = entries.slice(0, limit);
    const formatted = limited.map(e => {
      const name = e.name ?? e.qualified_name ?? "?";
      const kindStr = e.kind ?? "?";
      const file = (e.file ?? e.file_path ?? "?") as string;
      // 文件路径转为相对路径
      const relFile = file.includes("/") ? file.split("/").slice(-3).join("/") : file;
      const line = e.line ?? e.start_line ?? "?";
      return `${kindStr} ${name} → ${relFile}:${line}`;
    }).join("\n");

    const meta = `[action=${action} | ${label} | found=${totalFound || entries.length}${entries.length > limit ? ` | shown=${limit}` : ""}]`;
    return createToolResponse(true, `${meta}\n${formatted}`, {
      payload: { action, label, count: entries.length, results: limited },
    });
  } catch {
    // 不是 JSON，按纯文本处理
  }

  // 尝试 JSON lines 格式
  const entries: Record<string, unknown>[] = [];
  for (const line of raw.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // 非 JSON
    }
  }

  if (entries.length > 0) {
    const limited = entries.slice(0, limit);
    const formatted = limited.map(e => {
      const name = e.name ?? e.symbol ?? "?";
      const kindStr = e.kind ?? "?";
      const file = e.file ?? "?";
      const line = e.line ?? "?";
      return `${kindStr} ${name} → ${file}:${line}`;
    }).join("\n");

    const meta = `[action=${action} | ${label} | found=${entries.length}${entries.length > limit ? ` | shown=${limit}` : ""}]`;
    return createToolResponse(true, `${meta}\n${formatted}`, {
      payload: { action, label, count: entries.length, results: limited },
    });
  }

  // 纯文本输出
  const output = trimOutput(raw, limit);
  const meta = `[action=${action} | ${label}]`;
  return createToolResponse(true, `${meta}\n${output}`, {
    payload: { action, label },
  });
}

// ─── 工具类 ──────────────────────────────────────────────────────────────

export class CodeSearchTool extends Tool {
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
          enum: [
            "search", "callers", "callees", "path",
            "cycles", "unused", "impact",
            "explain", "hierarchy", "duplicates", "subgraph",
          ],
          description:
            "操作类型。" +
            "search=按名搜符号，callers=谁调用了它，callees=它调用了谁，" +
            "path=两符号间调用链，cycles=循环依赖，unused=死代码，" +
            "impact=修改影响范围，explain=符号上下文解释，hierarchy=调用层级，" +
            "duplicates=重复代码，subgraph=局部代码图。",
        },
        symbol: {
          type: "string",
          description: "要搜索的符号名。search/callers/callees/impact/explain/hierarchy/subgraph 必填。支持正则匹配。",
        },
        target: {
          type: "string",
          description: "目标符号名。path 查调用链时必填，与 symbol 组成起点→终点。",
        },
        kind: {
          type: "string",
          enum: ["function", "class", "method", "struct", "enum", "interface", "trait", "variable", "constant", "type", "module", "namespace"],
          description: "符号类型过滤。search 时只返回该类型的符号；unused 时只检测该类型的死代码。默认不过滤。",
        },
        lang: {
          type: "string",
          description: "语言过滤。如 ts、python、rust、go。search/unused 时有效。",
        },
        in_file: {
          type: "string",
          description: "符号所在文件路径。当符号名有歧义（多个定义）时用于消歧。impact/callers 时有效。",
        },
        exact: {
          type: "boolean",
          description: "精确匹配符号名（关闭正则）。默认 false（正则匹配）。",
        },
        fuzzy: {
          type: "boolean",
          description: "模糊匹配符号名。适合不确定确切名称时使用。默认 false。",
        },
        depth: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          description: "调用关系搜索深度。impact 默认 3，subgraph 默认 2。值越大分析越深但越慢。",
        },
        scope: {
          type: "string",
          enum: ["all", "public", "private", "function", "struct"],
          description: "unused 模式专用。all=所有未使用符号，public=未使用的公开符号，private=未使用的私有符号，function=只看函数，struct=只看类型。默认 all。",
        },
        cycle_type: {
          type: "string",
          enum: ["calls", "imports", "modules"],
          description: "cycles 模式专用。calls=函数调用循环（默认），imports=文件导入循环，modules=模块循环。",
        },
        min_cycle_size: {
          type: "integer",
          minimum: 2,
          description: "cycles 模式专用。只返回包含 ≥N 个符号的循环。默认 2。",
        },
        direct_only: {
          type: "boolean",
          description: "impact 模式专用。true=只看直接依赖者，false=包含间接依赖。默认 false。",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "最大返回结果数。默认 30。",
        },
        reason: {
          type: "string",
          description: "为什么必须调用此工具而不是直接回复用户？说明工具不可替代的作用。",
        },
      },
      required: ["action", "reason"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
  };

  async execute(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim();
    if (!action) {
      return createToolResponse(false, "code-search 缺少 action 参数");
    }

    const cwd = resolve(ctx.projectRoot);

    // 确保索引存在
    const indexError = await ensureIndex(cwd);
    if (indexError) {
      return createToolResponse(false, `代码索引不可用: ${indexError}`);
    }

    // 检查 sqry 是否可用
    if (!findSqryBinary()) {
      return createToolResponse(false, "sqry 未安装。请运行: cargo install sqry");
    }

    switch (action) {
      case "search":
        return doSearch(params, cwd);
      case "callers":
        return doCallers(params, cwd);
      case "callees":
        return doCallees(params, cwd);
      case "path":
        return doPath(params, cwd);
      case "cycles":
        return doCycles(params, cwd);
      case "unused":
        return doUnused(params, cwd);
      case "impact":
        return doImpact(params, cwd);
      case "explain":
        return doExplain(params, cwd);
      case "hierarchy":
        return doHierarchy(params, cwd);
      case "duplicates":
        return doDuplicates(params, cwd);
      case "subgraph":
        return doSubgraph(params, cwd);
      default:
        return createToolResponse(false, `未知的 action: ${action}。可选: search, callers, callees, path, cycles, unused, impact, explain, hierarchy, duplicates, subgraph`);
    }
  }
}
