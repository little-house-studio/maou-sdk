/**
 * Completer —— 斜杠命令 + @ 文件路径补全引擎。
 * 阶段 2：斜杠命令；阶段 7：@ 文件路径（同步读 cwd，阶段可换后台线程）。
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

export interface CompletionItem {
  value: string;   // 补全插入文本
  label: string;   // 显示
  description?: string;
}

export const SLASH_COMMANDS: CompletionItem[] = [
  { value: "/new", label: "/new", description: "新对话" },
  { value: "/clear", label: "/clear", description: "清空消息" },
  { value: "/model", label: "/model", description: "选择模型" },
  { value: "/sessions", label: "/sessions", description: "切换会话" },
  { value: "/help", label: "/help", description: "帮助" },
  { value: "/quit", label: "/quit", description: "退出" },
  { value: "/thinking", label: "/thinking", description: "切换思考级别" },
];

/** @ 文件路径补全：列出 cwd 下匹配 prefix 的文件（最多 20 个） */
function completeFilePath(prefix: string): CompletionItem[] {
  if (!existsSync(process.cwd())) return [];
  // prefix 可能含子目录：split 出 dir + name
  const lastSep = prefix.lastIndexOf("/");
  const dir = lastSep >= 0 ? prefix.slice(0, lastSep) || "." : ".";
  const name = lastSep >= 0 ? prefix.slice(lastSep + 1) : prefix;
  const absDir = join(process.cwd(), dir);
  try {
    const entries = readdirSync(absDir).filter(e => e.startsWith(name));
    const out: CompletionItem[] = [];
    for (const e of entries.slice(0, 20)) {
      const full = dir === "." ? e : `${dir}/${e}`;
      let desc = "";
      try {
        const st = statSync(join(absDir, e));
        desc = st.isDirectory() ? "目录" : "文件";
      } catch { /* ignore */ }
      out.push({ value: `@${full}`, label: full, description: desc });
    }
    return out;
  } catch {
    return [];
  }
}

/** 根据当前输入返回补全候选 + 前缀 */
export function complete(input: string): { items: CompletionItem[]; prefix: string } {
  if (input.startsWith("/")) {
    const items = SLASH_COMMANDS.filter(c => c.value.startsWith(input) && c.value !== input);
    return { items, prefix: input };
  }
  // @ 文件路径补全：找最后一个 @ 之后的内容
  const atIdx = input.lastIndexOf("@");
  if (atIdx >= 0) {
    const afterAt = input.slice(atIdx + 1);
    // 确认 @ 之后无空格（一个 token 内）
    if (!afterAt.includes(" ")) {
      const items = completeFilePath(afterAt);
      return { items, prefix: afterAt };
    }
  }
  return { items: [], prefix: "" };
}
