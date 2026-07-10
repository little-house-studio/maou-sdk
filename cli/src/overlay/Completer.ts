/**
 * Completer —— fuse.js 模糊补全 + 文件路径胶水。
 *
 * 斜杠命令 / 文件名用 Fuse；目录枚举仍是薄 readdir 胶水。
 * 导出 API 不变：complete(input) / CompletionItem / SLASH_COMMANDS。
 *
 * 旧实现：legacy/pre-lib-migration/overlay/Completer.ts
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import Fuse from "fuse.js";

export interface CompletionItem {
  value: string;
  label: string;
  description?: string;
}

export const SLASH_COMMANDS: CompletionItem[] = [
  { value: "/goal", label: "/goal", description: "启动监督模式（监督 Agent 监督主 Agent 完成）" },
  { value: "/new", label: "/new", description: "新建会话" },
  { value: "/clear", label: "/clear", description: "清空当前会话消息" },
  { value: "/stop", label: "/stop", description: "停止当前生成" },
  { value: "/agent", label: "/agent", description: "切换 agent" },
  { value: "/model", label: "/model", description: "选择模型" },
  { value: "/sessions", label: "/sessions", description: "切换会话" },
  { value: "/help", label: "/help", description: "帮助" },
  { value: "/quit", label: "/quit", description: "退出" },
  { value: "/thinking", label: "/thinking", description: "切换思考级别" },
];

const slashFuse = new Fuse(SLASH_COMMANDS, {
  keys: ["value", "label", "description"],
  threshold: 0.4,
  ignoreLocation: true,
});

/** @ 文件路径：readdir 胶水 + Fuse 模糊 */
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
      const full = dir === "." ? e : `${dir}/${e}`;
      let desc = "";
      try {
        const st = statSync(join(absDir, e));
        desc = st.isDirectory() ? "目录" : "文件";
      } catch { /* ignore */ }
      candidates.push({ value: `@${full}`, label: full, description: desc });
    }
    if (!name) return candidates.slice(0, 20);
    const fileFuse = new Fuse(candidates, {
      keys: ["label"],
      threshold: 0.4,
      ignoreLocation: true,
    });
    return fileFuse.search(name).slice(0, 20).map((r) => r.item);
  } catch {
    return [];
  }
}

/** 根据当前输入返回补全候选 + 前缀 */
export function complete(input: string): { items: CompletionItem[]; prefix: string } {
  if (input.startsWith("/")) {
    // 空 "/" 或仅前缀：Fuse 搜去掉 leading / 的部分；无 query 时返回全部未精确匹配项
    const q = input.slice(1);
    let items: CompletionItem[];
    if (!q) {
      items = SLASH_COMMANDS.filter((c) => c.value !== input);
    } else {
      // 优先精确前缀，再 fuse 模糊（保证 /mo → /model 仍排前）
      const prefixHits = SLASH_COMMANDS.filter(
        (c) => c.value.startsWith(input) && c.value !== input,
      );
      if (prefixHits.length > 0) {
        items = prefixHits;
      } else {
        items = slashFuse.search(input).map((r) => r.item).filter((c) => c.value !== input);
      }
    }
    return { items, prefix: input };
  }
  const atIdx = input.lastIndexOf("@");
  if (atIdx >= 0) {
    const afterAt = input.slice(atIdx + 1);
    if (!afterAt.includes(" ")) {
      return { items: completeFilePath(afterAt), prefix: afterAt };
    }
  }
  return { items: [], prefix: "" };
}
