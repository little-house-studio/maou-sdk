/**
 * Completer —— 与光标位置绑定的 / 命令与 @ 路径补全。
 *
 * 规则（用户约定）：
 * - 看「光标前」文本里正在输入的 token：
 *   - `/` → 全部斜杠命令
 *   - `/s` → /stop、/sessions…
 *   - `/ses` → 仅 /sessions
 * - 与光标后文字无关（只替换 [tokenStart, cursor)）
 * - 接受后光标落到插入文本末尾
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import Fuse from "fuse.js";

export interface CompletionItem {
  value: string;
  label: string;
  description?: string;
}

/** 补全结果：候选 + 当前要替换的区间 [start, end)（end 通常=光标） */
export interface CompleteResult {
  items: CompletionItem[];
  /** 正在匹配的片段，如 "/s"、"@src/" */
  prefix: string;
  /** 在完整 input 中的替换范围 */
  range: { start: number; end: number };
}

export interface ApplyCompletionResult {
  text: string;
  /** 新光标 UTF-16 索引（在插入文本末尾） */
  cursorIndex: number;
}

export const SLASH_COMMANDS: CompletionItem[] = [
  { value: "/goal", label: "/goal", description: "启动监督模式（监督 Agent 监督主 Agent 完成）" },
  { value: "/new", label: "/new", description: "新建会话" },
  { value: "/clear", label: "/clear", description: "清空当前会话消息" },
  { value: "/stop", label: "/stop", description: "停止当前生成" },
  { value: "/agent", label: "/agent", description: "切换 agent" },
  { value: "/model", label: "/model", description: "选择模型" },
  { value: "/sessions", label: "/sessions", description: "切换会话" },
  { value: "/prompt", label: "/prompt", description: "预览当前 agent 渲染后的 system 提示词（不进上下文）" },
  { value: "/help", label: "/help", description: "帮助" },
  { value: "/quit", label: "/quit", description: "退出" },
  { value: "/thinking", label: "/thinking", description: "切换思考级别" },
];

const slashFuse = new Fuse(SLASH_COMMANDS, {
  keys: ["value", "label", "description"],
  threshold: 0.35,
  ignoreLocation: true,
});

const SLASH_EXACT = new Set(SLASH_COMMANDS.map((c) => c.value));

// ─── 光标 ↔ 索引 ──────────────────────────────────────────────────────────

/** TextArea [line, col]（col=行内 code point）→ UTF-16 索引 */
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

/** UTF-16 索引 → [line, col] code point 列（给 TextArea cursorPosition） */
export function indexToCursor(text: string, idx: number): [number, number] {
  const safe = Math.max(0, Math.min(text.length, idx));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < safe; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  const col = [...text.slice(lineStart, safe)].length;
  return [line, col];
}

// ─── @ 路径 ───────────────────────────────────────────────────────────────

function completeFilePath(prefix: string): CompletionItem[] {
  if (!existsSync(process.cwd())) return [];
  const lastSep = prefix.lastIndexOf("/");
  const dir = lastSep >= 0 ? prefix.slice(0, lastSep) || "." : ".";
  const name = lastSep >= 0 ? prefix.slice(lastSep + 1) : prefix;
  const absDir = join(process.cwd(), dir);
  try {
    const entries = readdirSync(absDir);
    const candidates: CompletionItem[] = [];
    for (const e of entries) {
      if (e === "." || e === "..") continue;
      if (e.startsWith(".") && name !== "" && !name.startsWith(".")) continue;
      const full = dir === "." ? e : `${dir}/${e}`;
      try {
        const st = statSync(join(absDir, e));
        if (st.isDirectory()) {
          candidates.push({ value: `@${full}/`, label: `${full}/`, description: "目录" });
          continue;
        }
      } catch {
        /* ignore */
      }
      candidates.push({ value: `@${full}`, label: full, description: "文件" });
    }
    if (!name) return candidates.slice(0, 24);
    const prefixHits = candidates.filter((c) =>
      c.label.toLowerCase().startsWith(name.toLowerCase()),
    );
    if (prefixHits.length > 0) return prefixHits.slice(0, 24);
    const fileFuse = new Fuse(candidates, {
      keys: ["label", "value"],
      threshold: 0.4,
      ignoreLocation: true,
    });
    return fileFuse.search(name).slice(0, 24).map((r) => r.item);
  } catch {
    return [];
  }
}

// ─── 主逻辑 ───────────────────────────────────────────────────────────────

/**
 * 按光标位置补全。
 * @param cursorIndex 光标 UTF-16 索引；缺省=文末
 */
export function complete(input: string, cursorIndex?: number): CompleteResult {
  const empty: CompleteResult = { items: [], prefix: "", range: { start: 0, end: 0 } };
  if (!input && (cursorIndex === undefined || cursorIndex === 0)) return empty;

  const idx = Math.max(0, Math.min(input.length, cursorIndex ?? input.length));
  const before = input.slice(0, idx);

  // 1) 斜杠命令：光标前以 /xxx 结尾（xxx = 字母数字 _ -）
  //    例：before="…/s" → prefix="/s"；before="…/" → prefix="/"
  const slashM = before.match(/\/([\w-]*)$/);
  if (slashM) {
    const prefix = slashM[0]!; // "/s" | "/"
    const start = idx - prefix.length;
    // 已完整键入某条命令，且光标紧跟命令后 → 不再弹菜单
    if (SLASH_EXACT.has(prefix)) {
      return { items: [], prefix, range: { start, end: idx } };
    }
    // 前缀匹配（严格 startsWith，用户描述的 /s → stop/sessions）
    let items = SLASH_COMMANDS.filter(
      (c) => c.value.startsWith(prefix) && c.value !== prefix,
    );
    // 无严格前缀时退回 fuse（容错）
    if (items.length === 0 && prefix.length > 1) {
      const q = prefix.slice(1);
      items = slashFuse
        .search(q)
        .map((r) => r.item)
        .filter((c) => c.value.startsWith("/") && c.value !== prefix);
    }
    return { items, prefix, range: { start, end: idx } };
  }

  // 2) @ 路径：光标前 @ 后无空白
  const atM = before.match(/@([^\s@]*)$/);
  if (atM) {
    const prefix = atM[0]!; // "@src/f"
    const pathPart = atM[1] ?? "";
    const start = idx - prefix.length;
    const items = completeFilePath(pathPart);
    return { items, prefix, range: { start, end: idx } };
  }

  return empty;
}

/**
 * 在「光标已在 prefix 末尾」时，计算应 insert 的后缀（库 ref.insert 用）。
 * 例：prefix="/s" selected="/sessions" after=" " → "essions"（不加空格）
 *     prefix="/s" selected="/sessions" after=""  → "essions "
 * 若 selected 不以 prefix 开头（模糊项），返回 null → 走整段 replace。
 */
export function completionInsertSuffix(
  prefix: string,
  selected: CompletionItem,
  after: string,
): string | null {
  if (!selected.value.startsWith(prefix)) return null;
  let suffix = selected.value.slice(prefix.length);
  // 目录 @foo/ 或已有后续空白：不再加尾空格
  const wantSpace =
    selected.value.startsWith("/") &&
    !selected.value.endsWith("/") &&
    !after.startsWith(" ") &&
    !after.startsWith("\n");
  if (wantSpace) suffix += " ";
  return suffix;
}

/**
 * 接受补全：替换 range，光标落到插入文本末尾（整段重写回退路径）。
 */
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

  // 优先与 insert 路径同一套后缀逻辑，保证结果一致
  const suffix = completionInsertSuffix(prefix, selected, after);
  if (suffix !== null) {
    const text = currentInput.slice(0, end) + suffix + after;
    return { text, cursorIndex: end + suffix.length };
  }

  // 模糊匹配：整段换成 selected
  const wantSpace =
    opts?.trailingSpace ??
    (selected.value.startsWith("/") && !selected.value.endsWith("/"));
  const addSpace =
    wantSpace && !after.startsWith(" ") && !after.startsWith("\n");
  const insert = selected.value.endsWith("/")
    ? selected.value
    : selected.value + (addSpace ? " " : "");
  const text = currentInput.slice(0, start) + insert + currentInput.slice(end);
  return { text, cursorIndex: start + insert.length };
}
