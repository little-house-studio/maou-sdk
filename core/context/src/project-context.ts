/**
 * 项目上下文加载器 —— 加载 .maou/context/ 下的文件
 *
 * 注入位置：系统提示词后面（作为 system 消息）
 * 文件：USER.md, PROJECT.md, RULE.md
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ─── 类型 ──────────────────────────────────────────────────────────────────

export interface ProjectContext {
  userContext: string;
  projectContext: string;
  ruleContext: string;
}

// ─── 常量 ────────────────────────────────────────────────────────────────────

const CONTEXT_FILES = [
  { name: "USER.md", key: "userContext" as const },
  { name: "PROJECT.md", key: "projectContext" as const },
  { name: "RULE.md", key: "ruleContext" as const },
];

// ─── 函数 ───────────────────────────────────────────────────────────────────

/**
 * 加载项目上下文
 * @param projectRoot 项目根目录
 * @returns 项目上下文内容
 */
export function loadProjectContext(projectRoot: string): ProjectContext {
  const contextDir = join(projectRoot, ".maou", "context");
  const result: ProjectContext = {
    userContext: "",
    projectContext: "",
    ruleContext: "",
  };

  if (!existsSync(contextDir)) {
    return result;
  }

  for (const { name, key } of CONTEXT_FILES) {
    const filePath = join(contextDir, name);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8").trim();
        if (content) {
          result[key] = content;
        }
      } catch {
        // 读取失败，跳过
      }
    }
  }

  return result;
}

/**
 * 编译项目上下文为注入文本
 * @param projectRoot 项目根目录
 * @returns 注入文本（空字符串表示无内容）
 */
export function compileProjectContext(projectRoot: string): string {
  const context = loadProjectContext(projectRoot);
  const parts: string[] = [];

  if (context.userContext) {
    parts.push(`<user_context>\n${context.userContext}\n</user_context>`);
  }

  if (context.projectContext) {
    parts.push(`<project_context>\n${context.projectContext}\n</project_context>`);
  }

  if (context.ruleContext) {
    parts.push(`<rule_context>\n${context.ruleContext}\n</rule_context>`);
  }

  if (parts.length === 0) {
    return "";
  }

  return parts.join("\n\n");
}
