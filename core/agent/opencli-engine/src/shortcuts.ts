/**
 * OpenCLI 命令 argv 映射（SHORTCUTS）+ 输出解析/格式化
 */

import type { OpencliEnvelope } from "./types.js";

export const MSG_LIMIT = 8000;

type ShortcutFn = (args: Record<string, string>) => string[];

/** 给命令参数追加 --tab（如果指定了 tab） */
function withTab(args: string[], a: Record<string, string>): string[] {
  if (a.tab) args.push("--tab", a.tab);
  return args;
}

export const SHORTCUTS: Record<string, ShortcutFn> = {
  open: (a) => ["open", a.url || ""],
  state: (a) => withTab(["state"], a),
  find: (a) => {
    const args: string[] = ["find", "--css", a.target || "*"];
    if (a.limit) args.push("--limit", a.limit);
    if (a.text_max) args.push("--text-max", a.text_max);
    return withTab(args, a);
  },
  frames: (a) => withTab(["frames"], a),
  screenshot: (a) => withTab(a.path ? ["screenshot", a.path] : ["screenshot"], a),

  title: (a) => withTab(["get", "title"], a),
  url: (a) => withTab(["get", "url"], a),
  get: (a) => {
    const args: string[] = ["get"];
    if (a.subtype) args.push(a.subtype);
    args.push(a.target || "");
    if (a.nth) args.push("--nth", a.nth);
    return withTab(args, a);
  },
  html: (a) => {
    const args: string[] = ["get", "html", "--as", "json"];
    if (a.target) args.push("--selector", a.target);
    if (a.depth) args.push("--depth", a.depth);
    if (a.children_max) args.push("--children-max", a.children_max);
    if (a.text_max) args.push("--text-max", a.text_max);
    return withTab(args, a);
  },

  click: (a) => {
    const args: string[] = ["click", a.target || ""];
    if (a.nth) args.push("--nth", a.nth);
    return withTab(args, a);
  },
  type: (a) => {
    const args: string[] = ["type", a.target || "", a.text || ""];
    if (a.nth) args.push("--nth", a.nth);
    return withTab(args, a);
  },
  fill: (a) => {
    const args: string[] = ["fill", a.target || "", a.text || ""];
    if (a.nth) args.push("--nth", a.nth);
    return withTab(args, a);
  },
  select: (a) => {
    const args: string[] = ["select", a.target || "", a.text || ""];
    if (a.nth) args.push("--nth", a.nth);
    return withTab(args, a);
  },
  keys: (a) => withTab(["keys", a.text || ""], a),
  hover: (a) => withTab(["hover", a.target || ""], a),
  check: (a) => {
    const args: string[] = ["check", a.target || ""];
    if (a.nth) args.push("--nth", a.nth);
    return withTab(args, a);
  },
  uncheck: (a) => {
    const args: string[] = ["uncheck", a.target || ""];
    if (a.nth) args.push("--nth", a.nth);
    return withTab(args, a);
  },
  scroll: (a) => {
    const args: string[] = ["scroll", a.text || "down"];
    if (a.amount) args.push("--amount", a.amount);
    return withTab(args, a);
  },
  back: (a) => withTab(["back"], a),

  wait: (a) => {
    const args: string[] = ["wait"];
    if (a.text) {
      args.push(a.wait_type === "selector" ? "selector" : "text", a.text);
    } else {
      args.push("time", a.amount || "3");
    }
    if (a.timeout) args.push("--timeout", a.timeout);
    return withTab(args, a);
  },

  extract: (a) => {
    const args: string[] = ["extract"];
    if (a.target) args.push("--selector", a.target);
    if (a.max_chars) args.push("--chunk-size", a.max_chars);
    if (a.start) args.push("--start", a.start);
    return withTab(args, a);
  },

  network: (a) => {
    const args: string[] = ["network"];
    if (a.detail) args.push("--detail", a.detail);
    if (a.filter) args.push("--filter", a.filter);
    if (a.raw) args.push("--raw");
    if (a.all) args.push("--all");
    if (a.ttl) args.push("--ttl", a.ttl);
    return withTab(args, a);
  },

  eval: (a) => {
    const args: string[] = ["eval", a.js || ""];
    if (a.frame) args.push("--frame", a.frame);
    return withTab(args, a);
  },

  "tab-list": () => ["tab", "list"],
  "tab-new": (a) => ["tab", "new", ...(a.url ? [a.url] : [])],
  "tab-select": (a) => ["tab", "select", a.target || ""],
  "tab-close": (a) => ["tab", "close", a.target || ""],

  bind: (a) => {
    const args: string[] = ["bind"];
    if (a.workspace) args.push("--workspace", a.workspace);
    if (a.domain) args.push("--domain", a.domain);
    if (a.path_prefix) args.push("--path-prefix", a.path_prefix);
    return args;
  },
  unbind: (a) => (a.workspace ? ["unbind", "--workspace", a.workspace] : ["unbind"]),
  close: () => ["close"],

  help: () => ["--help"],
};

/** 已知 action 列表 */
export function knownActions(): string[] {
  return Object.keys(SHORTCUTS);
}

/** 截断长文本 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n\n...(截断: 原始 ${text.length} 字符)`;
}

/** 解析 OpenCLI JSON 输出 */
export function parseOpencliOutput(stdout: string): { envelope: OpencliEnvelope | null; rawText: string } {
  const trimmed = stdout.trim();
  if (!trimmed) return { envelope: null, rawText: "" };

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { envelope: parsed as OpencliEnvelope, rawText: trimmed };
    }
    if (Array.isArray(parsed)) {
      return { envelope: { entries: parsed }, rawText: trimmed };
    }
  } catch { /* 不是 JSON */ }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed === "object") {
        return { envelope: parsed as OpencliEnvelope, rawText: trimmed };
      }
    } catch { /* 放弃 */ }
  }

  return { envelope: null, rawText: trimmed };
}

/** 格式化 envelope 为可读文本 */
export function formatEnvelope(env: OpencliEnvelope): string {
  const parts: string[] = [];

  if (env.error) {
    parts.push(`[错误] ${env.error.code}: ${env.error.message}`);
    if (env.error.hint) parts.push(`  提示: ${env.error.hint}`);
    if (env.error.candidates?.length) parts.push(`  候选: ${env.error.candidates.join(", ")}`);
    if (env.error.available?.length) parts.push(`  可用: ${env.error.available.join(", ")}`);
    return parts.join("\n");
  }

  if (env.page && !env.tabs && !env.clicked && !env.typed) {
    parts.push(`✅ 页面已打开，标签页 ID: ${env.page}`);
    parts.push(`⚠️ 后续命令（state/extract/screenshot/click 等）请传 tab="${env.page}" 以操作此标签页`);
  }

  if (env.matches_n !== undefined) {
    const level = env.match_level ? ` (${env.match_level})` : "";
    parts.push(`匹配: ${env.matches_n} 个${level}`);
  }

  if (env.clicked) parts.push("点击成功");
  if (env.typed) {
    parts.push(`输入成功: "${env.text}"`);
    if (env.autocomplete) parts.push("注意: 检测到自动补全弹窗，需要 keys Enter 或 click 建议项来确认");
  }
  if (env.filled) {
    parts.push(`填充成功${env.verified ? " (已验证)" : ""}`);
    if (env.actual !== undefined) parts.push(`实际值: "${env.actual}"`);
  }
  if (env.selected) parts.push(`已选择: ${env.selected.label} (${env.selected.value})`);

  if (env.title) parts.push(`标题: ${env.title}`);
  if (env.url) parts.push(`URL: ${env.url}`);
  if (env.value !== undefined && typeof env.value === "string") parts.push(`值: ${env.value}`);
  if (env.value !== undefined && typeof env.value === "object") {
    parts.push(`值: ${JSON.stringify(env.value)}`);
  }

  if (env.total_chars !== undefined) {
    parts.push(`总字符: ${env.total_chars}, 当前分块: ${env.content?.length || 0} 字符`);
    if (env.next_start_char !== null) parts.push(`下一分块起始: ${env.next_start_char}`);
  }

  if (env.entries && Array.isArray(env.entries) && env.entries.length > 0) {
    if (env.entries[0] && typeof env.entries[0].key === "string") {
      const list = env.entries.slice(0, 10).map((e: Record<string, unknown>) =>
        `  ${e.key} ${e.method} ${e.status} ${e.url} (${e.ct}, ${e.size}B)`
      ).join("\n");
      parts.push(`网络请求 (${env.entries.length}):\n${list}`);
      if (env.entries.length > 10) parts.push(`  ... 还有 ${env.entries.length - 10} 条`);
    }
  }

  if (env.tabs) {
    const list = env.tabs.map((t: Record<string, unknown>) =>
      `  [${t.index}] ${t.page} ${t.active ? "◉" : "○"} ${t.title} (${t.url})`
    ).join("\n");
    parts.push(`标签页:\n${list}`);
  }
  if (env.entries && Array.isArray(env.entries) && env.entries.length > 0 && (env.entries[0] as Record<string, unknown>)?.page) {
    const list = env.entries.map((t) => {
      const tr = t as Record<string, unknown>;
      return `  [${tr.index}] ${tr.page} ${tr.active ? "◉" : "○"} ${tr.title} (${tr.url})`;
    }).join("\n");
    parts.push(`标签页:\n${list}`);
  }
  if (env.page && !parts.some(p => p.includes("标签页 ID"))) parts.push(`标签页: ${env.page}`);

  if (env.sessions) {
    const list = env.sessions.map((s: Record<string, unknown>) =>
      `  ${s.workspace} ${s.idleMsRemaining !== null ? `${s.idleMsRemaining}ms 剩余` : "无超时"}`
    ).join("\n");
    parts.push(`会话:\n${list}`);
  }

  if (env.compound) {
    parts.push(`控件信息: ${JSON.stringify(env.compound)}`);
  }

  if (env.content && !env.total_chars) {
    parts.push(env.content);
  }

  return parts.length > 0 ? parts.join("\n") : "操作完成";
}
