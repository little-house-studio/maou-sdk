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
  SqryAmbiguousError,
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
  /** 限定定义所在文件（相对/绝对路径片段）—— 客户端过滤，兼容 impact --in */
  inFile?: string;
}

/**
 * 语言别名 → sqry 正式 id（`sqry --list-languages`）。
 * agent 常写 ts/js/py，sqry 19 只认 typescript/javascript/python。
 */
const LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  rb: "ruby",
  cs: "csharp",
  cpp: "cpp",
  "c++": "cpp",
  kt: "kotlin",
  sh: "shell",
  bash: "shell",
};

/** 归一化 lang 参数 */
export function normalizeLang(lang?: string): string | undefined {
  if (!lang) return undefined;
  const key = lang.trim().toLowerCase();
  return LANG_ALIASES[key] ?? key;
}

/**
 * 组装 search 参数。
 * sqry 19+：`--kind` / `--lang` / `--exact` / `--fuzzy` 是**全局**选项，
 * 必须写在 `search` 子命令**之前**；写在 search 后会被拒绝。
 */
export function buildSearchArgs(symbol: string, opts: SearchOptions = {}): string[] {
  const args: string[] = [];
  if (opts.kind) args.push("--kind", opts.kind);
  const lang = normalizeLang(opts.lang);
  if (lang) args.push("--lang", lang);
  if (opts.exact) args.push("--exact");
  if (opts.fuzzy) args.push("--fuzzy");
  args.push("search", "--json", symbol, ".");
  return args;
}

function entryMatchesFile(file: string | undefined, inFile: string): boolean {
  if (!file || !inFile) return true;
  const a = file.replace(/\\/g, "/");
  const b = inFile.replace(/\\/g, "/");
  return a === b || a.endsWith("/" + b) || a.endsWith(b) || b.endsWith(a);
}

/** search: 按名搜符号 */
export async function search(cwd: string, symbol: string, opts: SearchOptions = {}): Promise<SqrySearchResult> {
  const args = buildSearchArgs(symbol, opts);
  const result = await runSqry(args, cwd);
  if (result.code !== 0 && !result.stdout.trim()) {
    // 参数错误等：把 stderr 暴露出去，避免被当成「未找到」
    const errText = (result.stderr || "").trim();
    if (errText) {
      return { entries: [], totalMatches: 0, isJson: false, rawText: errText };
    }
    return { entries: [], totalMatches: 0, isJson: true };
  }
  const parsed = parseSearch(result.stdout);
  if (opts.inFile && parsed.entries.length > 0) {
    const filtered = parsed.entries.filter((e) => entryMatchesFile(e.file, opts.inFile!));
    return {
      ...parsed,
      entries: filtered,
      totalMatches: filtered.length,
    };
  }
  return parsed;
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

/**
 * 解析符号在图中的规范名（优先 exact search 命中）。
 * path/hierarchy 对 qualified name 更稳。
 */
async function resolvePreferredSymbolName(
  cwd: string,
  symbol: string,
  opts: { kind?: string; inFile?: string } = {},
): Promise<string> {
  try {
    const r = await search(cwd, symbol, {
      exact: true,
      kind: opts.kind,
      inFile: opts.inFile,
    });
    if (r.entries.length === 1) {
      return r.entries[0]!.qualifiedName || r.entries[0]!.name || symbol;
    }
    if (r.entries.length > 1 && opts.kind) {
      const byKind = r.entries.filter(
        (e) => (e.kind || "").toLowerCase() === opts.kind!.toLowerCase(),
      );
      if (byKind.length === 1) {
        return byKind[0]!.qualifiedName || byKind[0]!.name || symbol;
      }
    }
  } catch {
    /* keep original */
  }
  return symbol;
}

/** path: 两符号间调用链（sqry 原生 path 对跨类方法常失败 → 直接 caller 边 + 反向 BFS） */
export async function tracePath(
  cwd: string,
  from: string,
  to: string,
  opts: { kind?: string; inFile?: string } = {},
): Promise<SqryGraphResult | null> {
  const fromName = await resolvePreferredSymbolName(cwd, from, opts);
  const toName = await resolvePreferredSymbolName(cwd, to, opts);

  // 1) 直接边：to 的 callers 是否包含 from（TS 跨类上比 path 准）
  try {
    const toCallers = await callers(cwd, toName);
    const hit = toCallers.entries.find((e) => {
      const n = e.qualifiedName || e.name || "";
      return namesLooselyEqual(n, fromName) || namesLooselyEqual(e.name || "", from) || namesLooselyEqual(n, from);
    });
    if (hit) {
      return {
        entries: [
          { name: fromName, file: "?", kind: "symbol" },
          {
            name: toName,
            file: hit.file,
            kind: hit.kind,
            line: hit.line,
          },
        ],
        totalFound: 2,
        isJson: true,
        raw: { path: [fromName, toName], method: "direct-caller-edge" },
      };
    }
  } catch {
    /* continue */
  }

  // 2) sqry 原生 path（多种命名）
  const pairs: Array<[string, string]> = [
    [fromName, toName],
    [from, to],
    [toDot(fromName), toDot(toName)],
    [toColon(fromName), toColon(toName)],
  ];
  for (const [a, b] of pairs) {
    const result = await runSqry(["--json", "graph", "trace-path", a, b], cwd);
    if (result.stdout.trim() && !result.stdout.includes("No path found")) {
      const parsed = parseGraph(result.stdout);
      if (parsed.entries.length > 0 || (parsed.raw && hasPathPayload(parsed.raw))) {
        return normalizePathResult(parsed, a, b);
      }
    }
  }

  // 3) 反向 BFS：从 to 的 callers 向上找 from
  const rev = await bfsCallPathReverse(cwd, fromName, toName, 8);
  if (rev) return rev;

  // 4) 正向 BFS callees
  const fwd = await bfsCallPath(cwd, fromName, toName, 6);
  if (fwd) return fwd;

  return null;
}

function toDot(name: string): string {
  return name.replace(/::/g, ".");
}
function toColon(name: string): string {
  return name.replace(/\./g, "::");
}
function namesLooselyEqual(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/::/g, ".").toLowerCase();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(".").pop()!;
  const tb = nb.split(".").pop()!;
  return na.endsWith("." + tb) || nb.endsWith("." + ta) || ta === tb && (na.includes(tb) || nb.includes(ta));
}
function hasPathPayload(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return Array.isArray(o.path) || Array.isArray(o.nodes) || Array.isArray(o.route);
}
function normalizePathResult(parsed: SqryGraphResult, from: string, to: string): SqryGraphResult {
  if (parsed.entries.length > 0) return parsed;
  const raw = parsed.raw as Record<string, unknown>;
  const pathArr = (raw?.path ?? raw?.nodes ?? raw?.route) as unknown;
  if (Array.isArray(pathArr) && pathArr.length > 0) {
    return {
      entries: pathArr.map((x) =>
        typeof x === "string"
          ? { name: x, file: "?", kind: "symbol" }
          : {
              name: String((x as { name?: string }).name ?? x),
              file: String((x as { file?: string }).file ?? "?"),
              kind: String((x as { kind?: string }).kind ?? "symbol"),
              line: (x as { line?: number }).line,
            },
      ),
      totalFound: pathArr.length,
      raw,
      isJson: true,
    };
  }
  return {
    entries: [
      { name: from, file: "?", kind: "symbol" },
      { name: to, file: "?", kind: "symbol" },
    ],
    totalFound: 2,
    raw,
    isJson: true,
  };
}

/** 反向 BFS：从 to 沿 callers 找 from */
async function bfsCallPathReverse(
  cwd: string,
  from: string,
  to: string,
  maxDepth: number,
): Promise<SqryGraphResult | null> {
  const queue: Array<{ name: string; path: string[] }> = [{ name: to, path: [to] }];
  const seen = new Set<string>([to.toLowerCase()]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.path.length > maxDepth + 1) continue;
    let callersRes: SqryGraphResult;
    try {
      callersRes = await callers(cwd, cur.name);
    } catch {
      continue;
    }
    for (const e of callersRes.entries) {
      const n = e.qualifiedName || e.name;
      if (!n) continue;
      const key = n.toLowerCase();
      if (namesLooselyEqual(n, from) || namesLooselyEqual(e.name || "", from)) {
        const full = [n, ...cur.path];
        return {
          entries: full.map((name) => ({ name, file: "?", kind: "symbol" })),
          totalFound: full.length,
          isJson: true,
          raw: { path: full, method: "bfs-reverse-callers" },
        };
      }
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ name: n, path: [n, ...cur.path] });
    }
  }
  return null;
}

/** 简易 BFS：from 的 callees 方向找 to（补 sqry path 漏边） */
async function bfsCallPath(
  cwd: string,
  from: string,
  to: string,
  maxDepth: number,
): Promise<SqryGraphResult | null> {
  const queue: Array<{ name: string; path: string[] }> = [{ name: from, path: [from] }];
  const seen = new Set<string>([from.toLowerCase()]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.path.length > maxDepth + 1) continue;
    let calleesRes: SqryGraphResult;
    try {
      calleesRes = await callees(cwd, cur.name);
    } catch {
      continue;
    }
    for (const e of calleesRes.entries) {
      const n = e.qualifiedName || e.name;
      if (!n) continue;
      const key = n.toLowerCase();
      if (namesLooselyEqual(n, to) || namesLooselyEqual(e.name || "", to)) {
        const full = [...cur.path, n];
        return {
          entries: full.map((name) => ({ name, file: "?", kind: "symbol" })),
          totalFound: full.length,
          isJson: true,
          raw: { path: full, method: "bfs-fallback" },
        };
      }
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ name: n, path: [...cur.path, n] });
    }
  }
  return null;
}

/** hierarchy: 调用层级 */
export async function hierarchy(
  cwd: string,
  symbol: string,
  opts: { kind?: string; inFile?: string; depth?: number } = {},
): Promise<SqryGraphResult> {
  const name = await resolvePreferredSymbolName(cwd, symbol, opts);
  const depth = Math.max(1, Math.min(6, opts.depth ?? 2));
  let result = await runSqry(
    ["--json", "graph", "call-hierarchy", name, "-d", String(depth)].filter(
      // sqry 19 call-hierarchy 可能不收 -d；失败再试无 depth
      () => true,
    ),
    cwd,
  );
  // 部分版本无 -d
  if (result.code !== 0 && result.stderr.includes("unexpected")) {
    result = await runSqry(["--json", "graph", "call-hierarchy", name], cwd);
  }
  if (result.code !== 0 && !result.stdout.trim()) {
    // 回退：合并 callers + callees
    const [up, down] = await Promise.all([callers(cwd, name), callees(cwd, name)]);
    const entries = [
      ...up.entries.map((e) => ({ ...e, relation: "caller" })),
      { name, file: "?", kind: "symbol", relation: "self" },
      ...down.entries.map((e) => ({ ...e, relation: "callee" })),
    ];
    return { entries, totalFound: entries.length, isJson: true, raw: { fallback: "callers+callees" } };
  }
  const parsed = parseGraph(result.stdout);
  if (parsed.entries.length <= 1) {
    const [up, down] = await Promise.all([callers(cwd, name), callees(cwd, name)]);
    if (up.entries.length + down.entries.length > 0) {
      const entries = [
        ...up.entries.map((e) => ({ ...e, relation: "caller" })),
        ...parsed.entries,
        ...down.entries.map((e) => ({ ...e, relation: "callee" })),
      ];
      return {
        entries,
        totalFound: entries.length,
        isJson: true,
        raw: { hierarchy: parsed.raw, fallbackMerged: true },
      };
    }
  }
  return parsed;
}

/** subgraph: 局部代码图 */
export async function subgraph(
  cwd: string,
  symbol: string,
  depth = 2,
  opts: { kind?: string; inFile?: string; maxNodes?: number } = {},
): Promise<SqryGraphResult> {
  const name = await resolvePreferredSymbolName(cwd, symbol, opts);
  const d = Math.max(1, Math.min(6, depth));
  const maxNodes = Math.max(10, Math.min(200, opts.maxNodes ?? 80));
  // 包含 callers+callees+imports，结果更丰满
  const result = await runSqry(
    [
      "--json",
      "subgraph",
      "-d",
      String(d),
      "-n",
      String(maxNodes),
      "--include-imports",
      name,
    ],
    cwd,
  );
  if (result.code !== 0 && !result.stdout.trim()) {
    // 回退：callers+callees 合成
    const [up, down] = await Promise.all([callers(cwd, name), callees(cwd, name)]);
    const entries = [
      { name, file: "?", kind: "seed" },
      ...up.entries,
      ...down.entries,
    ];
    return {
      entries,
      totalFound: entries.length,
      isJson: true,
      raw: { fallback: "callers+callees" },
    };
  }
  const parsed = parseGraph(result.stdout);
  // 解析 nodes/edges 形态
  if (parsed.entries.length <= 1 && parsed.raw && typeof parsed.raw === "object") {
    const raw = parsed.raw as Record<string, unknown>;
    const nodes = (raw.nodes ?? raw.vertices) as unknown;
    if (Array.isArray(nodes) && nodes.length > 0) {
      return {
        entries: nodes.map((n) =>
          typeof n === "string"
            ? { name: n, file: "?" }
            : {
                name: String((n as { name?: string; id?: string }).name ?? (n as { id?: string }).id ?? n),
                file: String((n as { file?: string }).file ?? "?"),
                kind: String((n as { kind?: string }).kind ?? "node"),
                line: (n as { line?: number }).line,
              },
        ),
        totalFound: nodes.length,
        raw,
        isJson: true,
      };
    }
  }
  if (parsed.entries.length <= 1) {
    const [up, down] = await Promise.all([callers(cwd, name), callees(cwd, name)]);
    if (up.entries.length + down.entries.length > 0) {
      return {
        entries: [{ name, file: "?", kind: "seed" }, ...up.entries, ...down.entries],
        totalFound: 1 + up.entries.length + down.entries.length,
        isJson: true,
        raw: { subgraph: parsed.raw, fallbackMerged: true },
      };
    }
  }
  return parsed;
}

export interface ExplainOptions {
  /** 定义文件（sqry explain 必填 FILE SYMBOL；可自动 search 补全） */
  inFile?: string;
  kind?: string;
}

/** explain: 解释符号上下文（sqry 19: explain <FILE> <SYMBOL>） */
export async function explain(
  cwd: string,
  symbol: string,
  opts: ExplainOptions = {},
): Promise<SqryGraphResult | SqryTextResult | null> {
  let file = opts.inFile?.trim() || "";
  if (!file) {
    const hit = await search(cwd, symbol, {
      exact: true,
      kind: opts.kind,
    });
    if (hit.entries.length === 0) {
      // 再试非 exact
      const hit2 = await search(cwd, symbol, { kind: opts.kind });
      if (hit2.entries.length === 0) return null;
      file = hit2.entries[0]!.file;
      if (hit2.entries.length > 1 && !opts.kind) {
        // 多命中：优先 class/interface/function
        const prefer = ["class", "interface", "function", "method", "struct"];
        const best =
          prefer
            .map((k) => hit2.entries.find((e) => (e.kind || "").toLowerCase() === k))
            .find(Boolean) || hit2.entries[0];
        file = best!.file;
      }
    } else {
      file = hit.entries[0]!.file;
      if (hit.entries.length > 1) {
        const prefer = ["class", "interface", "function", "method", "struct"];
        const best =
          prefer
            .map((k) => hit.entries.find((e) => (e.kind || "").toLowerCase() === k))
            .find(Boolean) || hit.entries[0];
        file = best!.file;
      }
    }
  }
  if (!file || file === "?") return null;

  // 文本模式通常更全；同时试 --json
  const textResult = await runSqry(["explain", file, symbol], cwd);
  if (textResult.stdout.trim() || textResult.stderr.trim()) {
    const text = (textResult.stdout || textResult.stderr).trim();
    if (text && !text.toLowerCase().includes("usage:")) {
      return { text };
    }
  }
  const jsonResult = await runSqry(["--json", "explain", file, symbol], cwd);
  if (jsonResult.stdout.trim()) {
    try {
      return parseGraph(jsonResult.stdout);
    } catch {
      return { text: jsonResult.stdout };
    }
  }
  return null;
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
  kind?: string;
  maxResults?: number;
}

/** unused: 死代码（默认偏向 function，并带结果说明） */
export async function unused(cwd: string, opts: UnusedOptions = {}): Promise<SqryTextResult | null> {
  // 默认 public：减少「导出符号/HTML 标签」类误报；调用方可传 all
  const scope = opts.scope ?? "public";
  const args: string[] = [];
  const lang = normalizeLang(opts.lang);
  if (lang) args.push("--lang", lang);
  if (opts.kind) args.push("--kind", opts.kind);
  args.push("unused", "--scope", scope, ".");
  if (opts.maxResults) args.push("--max-results", String(opts.maxResults));
  const result = await runSqry(args, cwd);
  if (result.code !== 0 && !result.stdout.trim()) {
    return null;
  }
  const body = (result.stdout || result.stderr || "").trim();
  if (!body) return null;
  const note =
    "注：unused 基于可达性分析，入口/导出/框架反射可能误报；请结合业务判断，勿仅凭此删除代码。\n";
  return { text: note + body };
}

export interface ImpactOptions {
  inFile?: string;
  depth?: number;
  directOnly?: boolean;
  limit?: number;
  kind?: string;
}

/** impact: 修改影响范围。支持 kind 消歧；并用 callers 补全「谁在用」。 */
export async function impact(
  cwd: string,
  symbol: string,
  opts: ImpactOptions = {},
): Promise<SqryTextResult | null> {
  const depth = Math.max(1, Math.min(10, opts.depth ?? 3));
  const limit = Math.max(1, Math.min(200, opts.limit ?? 100));

  // 用 search 做 kind/inFile 消歧，拿到唯一定义
  let target = symbol;
  let defFile = opts.inFile;
  let defKind = opts.kind;
  const hit = await search(cwd, symbol, {
    exact: true,
    kind: opts.kind,
    inFile: opts.inFile,
  });
  let candidates = hit.entries;
  if (opts.kind) {
    candidates = candidates.filter(
      (e) => (e.kind || "").toLowerCase() === opts.kind!.toLowerCase(),
    );
  }
  // 去掉 import 伪符号（通常不是定义）
  const defs = candidates.filter((e) => (e.kind || "").toLowerCase() !== "import");
  if (defs.length === 1) {
    target = defs[0]!.qualifiedName || defs[0]!.name || symbol;
    defFile = defs[0]!.file || defFile;
    defKind = defs[0]!.kind || defKind;
  } else if (defs.length > 1) {
    // 仍歧义：若 kind 已指定仍多条，报错并列出
    if (opts.kind || opts.inFile) {
      const lines = defs
        .slice(0, 12)
        .map(
          (e) =>
            `- kind=${e.kind ?? "?"} ${e.qualifiedName ?? e.name} @ ${e.file}:${e.line ?? "?"}`,
        )
        .join("\n");
      throw new SqryAmbiguousError(
        symbol,
        `符号 "${symbol}" 在过滤后仍有 ${defs.length} 个定义。\n${lines}`,
      );
    }
  }

  const args = ["impact", target, "--depth", String(depth), "--limit", String(limit), "--show-files"];
  if (defFile) args.push("--in", defFile);
  if (opts.directOnly) args.push("--direct-only");

  let impactText = "";
  const result = await runSqry(args, cwd);
  if (result.code !== 0 && !result.stdout.trim()) {
    const err = (result.stderr || "").toLowerCase();
    if (err.includes("ambiguous")) {
      // 从 stderr 候选里用 kind 再滤一次
      const candLines = (result.stderr || "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("- "));
      if (opts.kind) {
        const k = opts.kind.toLowerCase();
        const matched = candLines.filter((l) => l.toLowerCase().includes(`[${k}]`));
        if (matched.length === 1) {
          // 解析 file path in (...)
          const m = matched[0]!.match(/\(([^)]+):(\d+):/);
          if (m) {
            const file = m[1]!;
            const retry = await runSqry(
              [
                "impact",
                symbol,
                "--depth",
                String(depth),
                "--limit",
                String(limit),
                "--show-files",
                "--in",
                file,
              ],
              cwd,
            );
            // 同文件 interface+type 仍可能歧义：改走 callers 合成
            if (retry.stdout.trim() && !retry.stderr.toLowerCase().includes("ambiguous")) {
              impactText = retry.stdout;
            }
          }
        }
      }
      if (!impactText) {
        // 合成 impact：search 定义 + callers
        const synth = await synthesizeImpact(cwd, symbol, {
          kind: opts.kind,
          inFile: opts.inFile,
          limit,
        });
        if (synth) return synth;
        let hint = result.stderr;
        try {
          const cand = await search(cwd, symbol, { exact: true });
          if (cand.entries.length > 0) {
            const lines = cand.entries
              .slice(0, 12)
              .map(
                (e) =>
                  `- kind=${e.kind ?? "?"} ${e.qualifiedName ?? e.name} @ ${e.file}:${e.line ?? "?"}`,
              )
              .join("\n");
            hint += `\n候选定义（请用 kind 和/或 in_file 消歧）:\n${lines}`;
          }
        } catch {
          /* ignore */
        }
        throw new SqryAmbiguousError(symbol, hint);
      }
    } else {
      // 未找到原生 impact：合成
      const synth = await synthesizeImpact(cwd, symbol, {
        kind: opts.kind,
        inFile: opts.inFile || defFile,
        limit,
      });
      if (synth) return synth;
      return null;
    }
  } else {
    impactText = result.stdout || result.stderr;
  }

  // 用 callers 补全「谁在用」（原生 impact 常只吐 module export 关系）
  const usage = await collectUsageDependents(cwd, target, limit);
  const header = [
    `impact: ${symbol}` +
      (defKind ? ` [kind=${defKind}]` : "") +
      (defFile ? ` @ ${defFile}` : ""),
    usage.lines.length
      ? `直接调用者/依赖者（via callers，共 ${usage.lines.length}）:\n${usage.lines.join("\n")}`
      : "直接调用者/依赖者（via callers）: （无）",
    "",
    "--- sqry impact 原始输出 ---",
    impactText.trim() || "（空）",
  ].join("\n");
  return { text: header };
}

async function collectUsageDependents(
  cwd: string,
  symbol: string,
  limit: number,
): Promise<{ lines: string[] }> {
  const lines: string[] = [];
  const seen = new Set<string>();
  const push = (kind: string, name: string, file: string, line?: number) => {
    const key = `${file}:${line ?? "?"}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(`- ${kind} ${name} → ${file}:${line ?? "?"}`);
  };
  try {
    const bare = symbol.split(/::|\./).pop() || symbol;
    const names = Array.from(
      new Set([symbol, bare, symbol.replace(/::/g, "."), symbol.replace(/\./g, "::")]),
    );
    for (const n of names) {
      try {
        const r = await callers(cwd, n);
        for (const e of r.entries) {
          push(e.kind ?? "caller", e.qualifiedName || e.name, e.file, e.line);
          if (lines.length >= limit) return { lines };
        }
      } catch {
        /* try next */
      }
    }
    // 类型/接口 callers 常为空：用 search 找「同名引用点」（含 import/type 使用）
    try {
      const refs = await search(cwd, bare, { exact: true });
      for (const e of refs.entries) {
        const k = (e.kind || "").toLowerCase();
        // 定义本身略过；import / type-use / variable 等算依赖
        if (k === "interface" || k === "class" || k === "struct" || k === "enum") {
          // 若是原定义文件+同名，仍列出其它文件的同名命中
        }
        push(e.kind ?? "ref", e.qualifiedName || e.name, e.file, e.line);
        if (lines.length >= limit) break;
      }
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
  return { lines };
}

async function synthesizeImpact(
  cwd: string,
  symbol: string,
  opts: { kind?: string; inFile?: string; limit: number },
): Promise<SqryTextResult | null> {
  const hit = await search(cwd, symbol, {
    exact: true,
    kind: opts.kind,
    inFile: opts.inFile,
  });
  let defs = hit.entries.filter((e) => (e.kind || "").toLowerCase() !== "import");
  if (opts.kind) {
    defs = defs.filter((e) => (e.kind || "").toLowerCase() === opts.kind!.toLowerCase());
  }
  if (defs.length === 0) return null;
  if (defs.length > 1 && !opts.kind) {
    // 仍歧义，不合成
    return null;
  }
  const def = defs[0]!;
  const name = def.qualifiedName || def.name || symbol;
  const usage = await collectUsageDependents(cwd, name, opts.limit);
  const text = [
    `impact (synthetic): ${symbol} [kind=${def.kind ?? "?"}] @ ${def.file}:${def.line ?? "?"}`,
    usage.lines.length
      ? `直接调用者/依赖者（via callers，共 ${usage.lines.length}）:\n${usage.lines.join("\n")}`
      : "直接调用者/依赖者（via callers）: （无）",
    "",
    "注：sqry 原生 impact 无法唯一消歧或结果过薄时，使用 callers 合成影响范围。",
  ].join("\n");
  return { text };
}

/** duplicates: 重复代码 */
export async function duplicates(cwd: string): Promise<SqryTextResult | null> {
  const result = await runSqry(["duplicates", "."], cwd, 60000);
  if (result.code !== 0 && !result.stdout.trim()) {
    return null;
  }
  return { text: result.stdout || result.stderr };
}
