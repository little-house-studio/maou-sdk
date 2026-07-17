/**
 * 项目上下文加载器 —— 加载 `.maou/project/` 下的说明文件。
 *
 * 注入位置：系统提示词后的独立 system 消息（见 message-builder）。
 * 默认文件：USER / PROJECT / RULE / DESIGN / EXPERIENCE。
 * 兼容旧路径：`.maou/context/`（仅当 project 目录不存在时回退）。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ─── 类型 ──────────────────────────────────────────────────────────────────

export interface ProjectContext {
  userContext: string;
  projectContext: string;
  ruleContext: string;
  designContext: string;
  experienceContext: string;
}

// ─── 常量 ────────────────────────────────────────────────────────────────────

const CONTEXT_FILES = [
  { name: "USER.md", key: "userContext" as const, tag: "user" },
  { name: "PROJECT.md", key: "projectContext" as const, tag: "project" },
  { name: "RULE.md", key: "ruleContext" as const, tag: "rules" },
  { name: "DESIGN.md", key: "designContext" as const, tag: "design" },
  { name: "EXPERIENCE.md", key: "experienceContext" as const, tag: "experience" },
] as const;

// ─── 函数 ───────────────────────────────────────────────────────────────────

function emptyContext(): ProjectContext {
  return {
    userContext: "",
    projectContext: "",
    ruleContext: "",
    designContext: "",
    experienceContext: "",
  };
}

function loadFromDir(dir: string): ProjectContext {
  const result = emptyContext();
  if (!existsSync(dir)) return result;

  for (const { name, key } of CONTEXT_FILES) {
    const filePath = join(dir, name);
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath, "utf-8").trim();
      if (content) result[key] = content;
    } catch {
      // 读取失败，跳过
    }
  }
  return result;
}

/**
 * 加载项目上下文。
 * 优先 `.maou/project/`；若目录不存在则回退 `.maou/context/`（旧布局）。
 */
export function loadProjectContext(projectRoot: string): ProjectContext {
  const projectDir = join(projectRoot, ".maou", "project");
  if (existsSync(projectDir)) {
    return loadFromDir(projectDir);
  }
  // 兼容旧路径
  return loadFromDir(join(projectRoot, ".maou", "context"));
}

/**
 * 编译项目上下文为注入文本（xml 包裹）。
 * @returns 注入文本；无内容时返回空串
 */
export function compileProjectContext(projectRoot: string): string {
  const context = loadProjectContext(projectRoot);
  const parts: string[] = [];

  for (const { key, tag } of CONTEXT_FILES) {
    const body = context[key];
    if (!body) continue;
    parts.push(`<${tag}>\n${body}\n</${tag}>`);
  }

  if (parts.length === 0) return "";

  return (
    `<project_info>\n` +
    `以下是本项目的持久说明（.maou/project/）。请遵守 rules；user/project/design/experience 作为工作背景。\n\n` +
    `${parts.join("\n\n")}\n` +
    `</project_info>`
  );
}
