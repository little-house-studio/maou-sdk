/**
 * Completer —— 与光标位置绑定的 / 命令与 @ 路径补全。
 *
 * 斜杠命令源（统一 CliCommandRegistry）：
 *   1. 内置 local/both（CliCommandSpec）
 *   2. 动态 runtime（syncRuntimeCommands）
 *   3. skills（syncSkillCommands）
 *   4. 可选 setSlashCatalogProvider 追加
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import Fuse from "fuse.js";
import {
  cliCommands,
  registerBuiltinCliCommands,
  syncSkillCommands,
  type SlashItem,
} from "../slash/index.js";

export interface CompletionItem {
  value: string;
  label: string;
  description?: string;
}

export interface CompleteResult {
  items: CompletionItem[];
  prefix: string;
  range: { start: number; end: number };
}

export interface ApplyCompletionResult {
  text: string;
  cursorIndex: number;
}

export type SlashCatalogProvider = () => CompletionItem[];

let slashCatalogProvider: SlashCatalogProvider | null = null;

/** 由 cli-session / useAgent 注入：registry.list 等 */
export function setSlashCatalogProvider(fn: SlashCatalogProvider | null): void {
  slashCatalogProvider = fn;
}

/** 动态：从注册表取 UI 本地指令 */
export function getUiSlashCommands(): CompletionItem[] {
  registerBuiltinCliCommands();
  return cliCommands.slashItems({ scopes: ["local", "both"] });
}

/** 动态：runtime 兜底 */
export function getRuntimeSlashFallbacks(): CompletionItem[] {
  registerBuiltinCliCommands();
  return cliCommands.slashItems({ scopes: ["runtime"] });
}

/** @deprecated 静态快照会过期；请用 getUiSlashCommands() */
export const UI_SLASH_COMMANDS: CompletionItem[] = getUiSlashCommands();

/** @deprecated 用 getRuntimeSlashFallbacks() */
export const RUNTIME_SLASH_FALLBACK: CompletionItem[] = getRuntimeSlashFallbacks();

/** @deprecated 用 getSlashCommands() */
export const SLASH_COMMANDS: CompletionItem[] = [
  ...RUNTIME_SLASH_FALLBACK,
  ...UI_SLASH_COMMANDS,
];

/** 合并注册表 + provider（去重，先注册者优先） */
export function getSlashCommands(): CompletionItem[] {
  registerBuiltinCliCommands();
  // 每次补全时刷新 skills（便宜目录扫）
  try {
    syncSkillCommands();
  } catch {
    /* ignore */
  }

  const map = new Map<string, CompletionItem>();
  const add = (list: SlashItem[] | CompletionItem[]) => {
    for (const it of list) {
      const k = it.value.toLowerCase();
      if (!map.has(k)) map.set(k, it);
    }
  };

  // 注册表全量（含 local/runtime/skill）
  add(cliCommands.slashItems());

  if (slashCatalogProvider) {
    try {
      add(slashCatalogProvider());
    } catch {
      /* ignore */
    }
  }

  return [...map.values()];
}

// ─── 路径补全 ─────────────────────────────────────────────────────────────

function completeFilePath(pathPart: string): CompletionItem[] {
  try {
    const sep = pathPart.lastIndexOf("/");
    const dir = sep >= 0 ? pathPart.slice(0, sep) || "." : ".";
    const name = sep >= 0 ? pathPart.slice(sep + 1) : pathPart;
    const absDir = join(process.cwd(), dir === "." ? "" : dir);
    if (!existsSync(absDir)) return [];
    const entries = readdirSync(absDir);
    const candidates: CompletionItem[] = [];
    for (const ent of entries) {
      if (
        name &&
        !ent.startsWith(name) &&
        !ent.toLowerCase().startsWith(name.toLowerCase())
      ) {
        continue;
      }
      const full = dir === "." ? ent : `${dir.replace(/\/$/, "")}/${ent}`;
      try {
        const st = statSync(join(absDir, ent));
        if (st.isDirectory()) {
          candidates.push({
            value: `@${full}/`,
            label: `${full}/`,
            description: "目录",
          });
        } else {
          candidates.push({
            value: `@${full}`,
            label: full,
            description: "文件",
          });
        }
      } catch {
        /* skip */
      }
    }
    if (!name) return candidates.slice(0, 24);
    const prefixHits = candidates.filter((c) =>
      c.label.toLowerCase().startsWith(name.toLowerCase()),
    );
    if (prefixHits.length > 0) return prefixHits.slice(0, 24);
    const fileFuse = new Fuse(candidates, {
      keys: ["label", "value"],
      threshold: 0.4,
    });
    return fileFuse.search(name).slice(0, 24).map((r) => r.item);
  } catch {
    return [];
  }
}

export function complete(input: string, cursorIndex?: number): CompleteResult {
  const empty: CompleteResult = {
    items: [],
    prefix: "",
    range: { start: 0, end: 0 },
  };
  if (!input && (cursorIndex === undefined || cursorIndex === 0)) return empty;

  const idx = Math.max(0, Math.min(input.length, cursorIndex ?? input.length));
  const before = input.slice(0, idx);
  const catalog = getSlashCommands();
  const exact = new Set(catalog.map((c) => c.value));

  const slashM = before.match(/\/([\w-]*)$/);
  if (slashM) {
    const prefix = slashM[0]!;
    const start = idx - prefix.length;
    if (exact.has(prefix)) {
      return { items: [], prefix, range: { start, end: idx } };
    }
    let items = catalog.filter(
      (c) => c.value.startsWith(prefix) && c.value !== prefix,
    );
    if (items.length === 0 && prefix.length > 1) {
      const q = prefix.slice(1);
      const fuse = new Fuse(catalog, {
        keys: ["value", "label", "description"],
        threshold: 0.35,
        ignoreLocation: true,
      });
      items = fuse
        .search(q)
        .map((r) => r.item)
        .filter((c) => c.value.startsWith("/") && c.value !== prefix);
    }
    return { items, prefix, range: { start, end: idx } };
  }

  const atM = before.match(/@([^\s@]*)$/);
  if (atM) {
    const prefix = atM[0]!;
    const pathPart = atM[1] ?? "";
    const start = idx - prefix.length;
    const items = completeFilePath(pathPart);
    return { items, prefix, range: { start, end: idx } };
  }

  return empty;
}

export function completionInsertSuffix(
  prefix: string,
  selected: CompletionItem,
  after: string,
): string | null {
  if (!selected.value.startsWith(prefix)) return null;
  let suffix = selected.value.slice(prefix.length);
  const wantSpace =
    selected.value.startsWith("/") &&
    !selected.value.endsWith("/") &&
    !after.startsWith(" ") &&
    !after.startsWith("\n");
  if (wantSpace) suffix += " ";
  return suffix;
}

export function applyCompletion(
  currentInput: string,
  selected: CompletionItem,
  range: { start: number; end: number },
  opts?: { trailingSpace?: boolean },
): ApplyCompletionResult {
  const start = Math.max(0, Math.min(currentInput.length, range.start));
  const end = Math.max(start, Math.min(currentInput.length, range.end));
  const after = currentInput.slice(end);
  const prefix = currentInput.slice(start, end);
  const suffix = completionInsertSuffix(prefix, selected, after);
  if (suffix !== null) {
    const text = currentInput.slice(0, end) + suffix + after;
    return { text, cursorIndex: end + suffix.length };
  }
  void opts;
  let insert = selected.value;
  if (
    selected.value.startsWith("/") &&
    !selected.value.endsWith("/") &&
    !after.startsWith(" ")
  ) {
    insert += " ";
  }
  const text = currentInput.slice(0, start) + insert + currentInput.slice(end);
  return { text, cursorIndex: start + insert.length };
}

/** UTF-16 索引工具：给 InputBar 用 */
export function cursorToIndex(text: string, line: number, col: number): number {
  let lineStart = 0;
  let curLine = 0;
  while (curLine < line && lineStart < text.length) {
    if (text[lineStart] === "\n") curLine++;
    lineStart++;
  }
  const lineText = text.slice(lineStart);
  const nl = lineText.indexOf("\n");
  const segment = nl >= 0 ? lineText.slice(0, nl) : lineText;
  const chars = [...segment];
  const take = Math.max(0, Math.min(col, chars.length));
  let idx = lineStart;
  for (let i = 0; i < take; i++) idx += chars[i]!.length;
  return idx;
}

/** UTF-16 索引 → [line, col] code point 列 */
export function indexToCursor(text: string, idx: number): [number, number] {
  const clamped = Math.max(0, Math.min(text.length, idx));
  let line = 0;
  let col = 0;
  let i = 0;
  while (i < clamped) {
    if (text[i] === "\n") {
      line++;
      col = 0;
      i++;
      continue;
    }
    const cp = text.codePointAt(i) ?? 0;
    const len = cp > 0xffff ? 2 : 1;
    if (i + len > clamped) break;
    col++;
    i += len;
  }
  return [line, col];
}
