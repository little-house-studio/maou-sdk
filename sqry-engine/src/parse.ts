/**
 * sqry 输出解析 — 把不同子命令的 JSON 形状归一化为 SqryEntry[]。
 * 不涉及任何工具层（ToolResponse）逻辑。
 */

import type { SqryEntry, SqryGraphResult, SqrySearchResult } from "./types.js";

/** 解析 search --json 输出 */
export function parseSearch(stdout: string): SqrySearchResult {
  try {
    const obj = JSON.parse(stdout.trim());
    const entries: SqryEntry[] = (obj.results ?? []).map(normalizeEntry);
    const totalMatches = obj.stats?.total_matches ?? entries.length;
    const execMs = obj.query?.execution_time_ms ?? undefined;
    return { entries, totalMatches, execMs, isJson: true };
  } catch {
    // 非 JSON：返回原始文本，工具层降级处理
    const lineCount = stdout.trim().split("\n").filter((l) => l.trim()).length;
    return { entries: [], totalMatches: lineCount, rawText: stdout, isJson: false };
  }
}

/**
 * 解析 graph 类输出（callers/callees/path/hierarchy/subgraph/explain）。
 * sqry graph 输出完整 JSON 对象，不同命令字段名不同。
 */
export function parseGraph(raw: string): SqryGraphResult {
  // 1. 尝试完整 JSON 对象
  try {
    const obj = JSON.parse(raw.trim());
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
    } else if (obj.hierarchy || obj.levels || obj.children) {
      // call-hierarchy 多种形状
      const h = obj.hierarchy ?? obj.levels ?? obj.children;
      if (Array.isArray(h)) {
        entries = h.flatMap((x: unknown) => {
          if (Array.isArray(x)) return x;
          if (x && typeof x === "object") {
            const o = x as Record<string, unknown>;
            if (Array.isArray(o.symbols)) return o.symbols;
            if (Array.isArray(o.nodes)) return o.nodes;
            return [o];
          }
          return [];
        });
      }
      totalFound = entries.length;
    } else if (obj.path || obj.nodes) {
      const p = obj.path ?? obj.nodes;
      if (Array.isArray(p)) entries = p as Record<string, unknown>[];
      totalFound = entries.length;
    } else if (obj.incoming || obj.outgoing) {
      const incoming = Array.isArray(obj.incoming) ? obj.incoming : [];
      const outgoing = Array.isArray(obj.outgoing) ? obj.outgoing : [];
      entries = [...incoming, ...outgoing];
      totalFound = entries.length;
    } else if (obj.direct || obj.indirect) {
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
      // 只有 stats/metadata，无 entries
      return { entries: [], totalFound: 0, raw: obj, isJson: true };
    }

    return {
      entries: entries.map(normalizeEntry),
      totalFound: totalFound || entries.length,
      isJson: true,
    };
  } catch {
    // 不是完整 JSON
  }

  // 2. 尝试 JSON lines
  const lineEntries: Record<string, unknown>[] = [];
  for (const line of raw.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      lineEntries.push(JSON.parse(line));
    } catch {
      // 非 JSON
    }
  }
  if (lineEntries.length > 0) {
    return {
      entries: lineEntries.map(normalizeEntry),
      totalFound: lineEntries.length,
      isJson: true,
    };
  }

  // 3. 纯文本降级
  return { entries: [], totalFound: 0, rawText: raw, isJson: false };
}

/** 把任意 sqry 条目对象归一化为 SqryEntry（兼容多种字段名） */
function normalizeEntry(e: Record<string, unknown>): SqryEntry {
  const name = (e.name ?? e.qualified_name ?? e.symbol ?? "?") as string;
  const qualifiedName = e.qualified_name as string | undefined;
  const kind = e.kind as string | undefined;
  const file = (e.file_path ?? e.file ?? "?") as string;
  const line = (e.start_line ?? e.line) as number | undefined;
  return { ...e, name, qualifiedName, kind, file, line };
}
