/**
 * Completer —— 与光标位置绑定的 / 命令与 @ 路径补全。
 *
 * 斜杠命令源（统一注册表驱动）：
 *   1. UI 本地命令（model/sessions/…）
 *   2. Runtime commandRegistry.list()（/new/clear/compact/cost/…）
 *   3. Skills（~/.agents/skills、项目 skills 等）→ /skill-name
 *
 * 通过 setSlashCatalogProvider 注入动态目录；未注入时用内置静态表。
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import Fuse from "fuse.js";

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

/** UI 本地命令（不进 runtime，只开 overlay） */
export const UI_SLASH_COMMANDS: CompletionItem[] = [
  { value: "/model", label: "/model", description: "选择模型" },
  { value: "/sessions", label: "/sessions", description: "切换会话" },
  { value: "/prompt", label: "/prompt", description: "调试预览：system/bake/tools/before_user/schemas" },
  { value: "/help", label: "/help", description: "帮助" },
  { value: "/settings", label: "/settings", description: "设置" },
  { value: "/agents", label: "/agents", description: "Agent 管理" },
  { value: "/screenshot", label: "/screenshot", description: "整屏文字截图→剪贴板（同 Ctrl+G）" },
  { value: "/dump", label: "/dump", description: "同 /screenshot" },
  { value: "/quit", label: "/quit", description: "退出" },
  { value: "/thinking", label: "/thinking", description: "切换思考级别" },
];

/** 内置 runtime 命令兜底（registry 未就绪时） */
export const RUNTIME_SLASH_FALLBACK: CompletionItem[] = [
  { value: "/goal", label: "/goal", description: "启动监督模式" },
  { value: "/new", label: "/new", description: "新建会话" },
  { value: "/clear", label: "/clear", description: "清空当前会话消息" },
  { value: "/stop", label: "/stop", description: "停止当前生成" },
  { value: "/agent", label: "/agent", description: "切换 agent" },
  { value: "/compact", label: "/compact", description: "强制压缩上下文" },
  { value: "/usage", label: "/usage", description: "会话用量（费用/时长/token，对标 Claude Code）" },
  { value: "/cost", label: "/cost", description: "同 /usage" },
  { value: "/context", label: "/context", description: "上下文占用与压缩阈值" },
];

/** @deprecated 用 getSlashCommands()；保留兼容 */
export const SLASH_COMMANDS: CompletionItem[] = [
  ...RUNTIME_SLASH_FALLBACK,
  ...UI_SLASH_COMMANDS,
];

export type SlashCatalogProvider = () => CompletionItem[];

let slashCatalogProvider: SlashCatalogProvider | null = null;

/** 由 useAgent 注入：registry.list + skills */
export function setSlashCatalogProvider(fn: SlashCatalogProvider | null): void {
  slashCatalogProvider = fn;
}

function scanSkillSlashItems(): CompletionItem[] {
  const items: CompletionItem[] = [];
  const dirs = [
    join(homedir(), ".agents", "skills"),
    join(process.cwd(), ".agents", "skills"),
    join(process.cwd(), "skills"),
    join(process.cwd(), ".maou", "skills"),
  ];
  const seen = new Set<string>();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        let name = "";
        if (ent.isDirectory()) {
          // skills/foo/SKILL.md 或 skills/foo.md
          const skillMd = join(dir, ent.name, "SKILL.md");
          if (existsSync(skillMd) || existsSync(join(dir, ent.name, "skill.md"))) {
            name = ent.name;
          }
        } else if (ent.name.endsWith(".md")) {
          name = basename(ent.name, ".md");
        }
        if (!name || seen.has(name)) continue;
        seen.add(name);
        items.push({
          value: `/${name}`,
          label: `/${name}`,
          description: `skill · ${name}`,
        });
      }
    } catch {
      /* ignore */
    }
  }
  return items;
}

/** 合并 UI + provider + skills（去重，先注册者优先） */
export function getSlashCommands(): CompletionItem[] {
  const map = new Map<string, CompletionItem>();
  const add = (list: CompletionItem[]) => {
    for (const it of list) {
      const k = it.value.toLowerCase();
      if (!map.has(k)) map.set(k, it);
    }
  };
  add(UI_SLASH_COMMANDS);
  if (slashCatalogProvider) {
    try {
      add(slashCatalogProvider());
    } catch {
      add(RUNTIME_SLASH_FALLBACK);
    }
  } else {
    add(RUNTIME_SLASH_FALLBACK);
  }
  add(scanSkillSlashItems());
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
      if (name && !ent.startsWith(name) && !ent.toLowerCase().startsWith(name.toLowerCase())) {
        continue;
      }
      const full = dir === "." ? ent : `${dir.replace(/\/$/, "")}/${ent}`;
      try {
        const st = statSync(join(absDir, ent));
        if (st.isDirectory()) {
          candidates.push({ value: `@${full}/`, label: `${full}/`, description: "目录" });
        } else {
          candidates.push({ value: `@${full}`, label: full, description: "文件" });
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
    const fileFuse = new Fuse(candidates, { keys: ["label", "value"], threshold: 0.4 });
    return fileFuse.search(name).slice(0, 24).map((r) => r.item);
  } catch {
    return [];
  }
}

export function complete(input: string, cursorIndex?: number): CompleteResult {
  const empty: CompleteResult = { items: [], prefix: "", range: { start: 0, end: 0 } };
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
