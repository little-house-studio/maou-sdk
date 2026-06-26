/**
 * @little-house-studio/sqry-engine — sqry 代码结构搜索引擎
 *
 * 公共 API：自由函数 + 类型化结构体。绝不返回 ToolResponse（与工具层无关）。
 * 二进制发现、子进程执行、协议解析全在此包内。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { runSqry } from "./binary.js";
import { parseSearch, parseGraph } from "./parse.js";
import {
  SqryIndexError,
  type SqrySearchResult,
  type SqryGraphResult,
  type SqryTextResult,
} from "./types.js";

export {
  isAvailable,
  binaryPath,
  findSqryBinary,
} from "./binary.js";

export type {
  SqryEntry,
  SqrySearchResult,
  SqryGraphResult,
  SqryTextResult,
} from "./types.js";

export {
  SqryNotInstalledError,
  SqryIndexError,
  SqryAmbiguousError,
} from "./types.js";

// ─── 索引 ────────────────────────────────────────────────────────────────

/** 确保 .sqry/graph 索引存在；不存在则构建。失败抛 SqryIndexError。 */
export async function ensureIndex(cwd: string): Promise<void> {
  const idxDir = join(cwd, ".sqry/graph");
  if (existsSync(idxDir)) return;

  const result = await runSqry(["index", "--force", "."], cwd, 120000);
  if (result.code !== 0 && !result.stdout.includes("Index built")) {
    throw new SqryIndexError(result.stderr || "索引构建失败");
  }
}

// ─── 搜索 ────────────────────────────────────────────────────────────────

export interface SearchOptions {
  kind?: string;
  lang?: string;
  exact?: boolean;
  fuzzy?: boolean;
  limit?: number;
}

/** search: 按名搜符号 */
export async function search(cwd: string, symbol: string, opts: SearchOptions = {}): Promise<SqrySearchResult> {
  const args = ["search", "--json"];
  if (opts.kind) args.push("--kind", opts.kind);
  if (opts.lang) args.push("--lang", opts.lang);
  if (opts.exact) args.push("--exact");
  if (opts.fuzzy) args.push("--fuzzy");
  args.push(symbol, ".");

  const result = await runSqry(args, cwd);
  if (result.code !== 0 && !result.stdout.trim()) {
    return { entries: [], totalMatches: 0, isJson: true };
  }
  return parseSearch(result.stdout);
}

// ─── 图查询 ──────────────────────────────────────────────────────────────

/** callers: 谁调用了它 */
export async function callers(cwd: string, symbol: string): Promise<SqryGraphResult> {
  const result = await runSqry(["graph", "direct-callers", symbol, "--json"], cwd);
  if (result.code !== 0 && !result.stdout.trim()) {
    return { entries: [], totalFound: 0, isJson: true };
  }
  return parseGraph(result.stdout);
}

/** callees: 它调用了谁 */
export async function callees(cwd: string, symbol: string): Promise<SqryGraphResult> {
  const result = await runSqry(["graph", "direct-callees", symbol, "--json"], cwd);
  if (result.code !== 0 && !result.stdout.trim()) {
    return { entries: [], totalFound: 0, isJson: true };
  }
  return parseGraph(result.stdout);
}

/** path: 两符号间调用链 */
export async function tracePath(cwd: string, from: string, to: string): Promise<SqryGraphResult | null> {
  const result = await runSqry(["graph", "trace-path", from, to, "--json"], cwd);
  if (result.code !== 0 || !result.stdout.trim()) {
    return null;
  }
  return parseGraph(result.stdout);
}

/** hierarchy: 调用层级 */
export async function hierarchy(cwd: string, symbol: string): Promise<SqryGraphResult> {
  const result = await runSqry(["graph", "call-hierarchy", symbol, "--json"], cwd);
  if (result.code !== 0 && !result.stdout.trim()) {
    return { entries: [], totalFound: 0, isJson: true };
  }
  return parseGraph(result.stdout);
}

/** subgraph: 局部代码图 */
export async function subgraph(cwd: string, symbol: string, depth = 2): Promise<SqryGraphResult> {
  const result = await runSqry(["subgraph", "-d", String(depth), symbol, "--json"], cwd);
  if (result.code !== 0 && !result.stdout.trim()) {
    return { entries: [], totalFound: 0, isJson: true };
  }
  return parseGraph(result.stdout);
}

/** explain: 解释符号上下文（先 JSON，失败降级纯文本） */
export async function explain(cwd: string, symbol: string): Promise<SqryGraphResult | SqryTextResult | null> {
  const result = await runSqry(["explain", symbol, "--json"], cwd);
  if (result.code !== 0 && !result.stdout.trim()) {
    // explain 可能只支持文本输出
    const result2 = await runSqry(["explain", symbol], cwd);
    if (result2.code !== 0 && !result2.stdout.trim()) {
      return null;
    }
    return { text: result2.stdout || result2.stderr };
  }
  return parseGraph(result.stdout);
}

// ─── 文本类分析 ──────────────────────────────────────────────────────────

export interface CyclesOptions {
  type?: "calls" | "imports" | "modules";
  minDepth?: number;
}

/** cycles: 循环依赖 */
export async function cycles(cwd: string, opts: CyclesOptions = {}): Promise<SqryTextResult | null> {
  const type = opts.type ?? "calls";
  const minDepth = Math.max(2, opts.minDepth ?? 2);
  const result = await runSqry(["cycles", "--type", type, "--min-depth", String(minDepth), "--json", "."], cwd);
  if (result.code !== 0 && !result.stdout.trim()) {
    return null;
  }
  return { text: result.stdout || result.stderr };
}

export interface UnusedOptions {
  scope?: string;
  lang?: string;
}

/** unused: 死代码 */
export async function unused(cwd: string, opts: UnusedOptions = {}): Promise<SqryTextResult | null> {
  const scope = opts.scope ?? "all";
  const args = ["unused", "--scope", scope, "."];
  if (opts.lang) args.push("--lang", opts.lang);
  const result = await runSqry(args, cwd);
  if (result.code !== 0 && !result.stdout.trim()) {
    return null;
  }
  return { text: result.stdout || result.stderr };
}

export interface ImpactOptions {
  inFile?: string;
  depth?: number;
  directOnly?: boolean;
  limit?: number;
}

/** impact: 修改影响范围。歧义时抛 SqryAmbiguousError，未找到返回 null。 */
export async function impact(cwd: string, symbol: string, opts: ImpactOptions = {}): Promise<SqryTextResult | null> {
  const depth = Math.max(1, Math.min(10, opts.depth ?? 3));
  const limit = Math.max(1, Math.min(200, opts.limit ?? 100));
  const args = ["impact", symbol, "--depth", String(depth), "--limit", String(limit)];
  if (opts.inFile) args.push("--in", opts.inFile);
  if (opts.directOnly) args.push("--direct-only");

  const result = await runSqry(args, cwd);
  if (result.code !== 0 && !result.stdout.trim()) {
    if (result.stderr.includes("ambiguous")) {
      const { SqryAmbiguousError } = await import("./types.js");
      throw new SqryAmbiguousError(symbol, result.stderr);
    }
    return null;
  }
  return { text: result.stdout || result.stderr };
}

/** duplicates: 重复代码 */
export async function duplicates(cwd: string): Promise<SqryTextResult | null> {
  const result = await runSqry(["duplicates", "."], cwd, 60000);
  if (result.code !== 0 && !result.stdout.trim()) {
    return null;
  }
  return { text: result.stdout || result.stderr };
}
