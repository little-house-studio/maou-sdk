/**
 * Agent 自定义指令执行 —— eve 的 command/ 目录。
 * 文件名 = 指令名。用户发 /<name> 时执行 command/<name>.{sh,mjs,ts,md}。
 *
 * .md：
 * - 默认：固定回复（command 命中后直接 echo，不进 AI）
 * - frontmatter `mode: task`：把正文当作「任务提示」注入，由 runtime 当作用户消息继续跑 AI
 *
 * 脚本：执行后返回 stdout/stderr。无此命令返回 null。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TIMEOUT_MS = 30_000;

export type AgentCommandKind = "reply" | "task";

export interface AgentCommandFileResult {
  /** 展示/注入的正文（task 模式为任务提示词；reply 为固定回复） */
  content: string;
  kind: AgentCommandKind;
  /** 源文件路径（调试） */
  sourcePath: string;
}

/**
 * 解析 markdown 指令：支持 YAML frontmatter。
 * ```
 * ---
 * mode: task
 * description: ...
 * ---
 * body...
 * ```
 */
export function parseCommandMarkdown(raw: string): {
  body: string;
  kind: AgentCommandKind;
  meta: Record<string, string>;
} {
  const text = raw.replace(/^﻿/, "");
  if (!text.startsWith("---")) {
    return { body: text.trim(), kind: "reply", meta: {} };
  }
  const end = text.indexOf("\n---", 3);
  if (end < 0) {
    return { body: text.trim(), kind: "reply", meta: {} };
  }
  const fm = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  const meta: Record<string, string> = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    meta[m[1]!.toLowerCase()] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
  const mode = (meta.mode || meta.kind || "reply").toLowerCase();
  const kind: AgentCommandKind =
    mode === "task" || mode === "prompt" || mode === "agent" ? "task" : "reply";
  return { body: body.trim(), kind, meta };
}

/** 在单个 agent 目录（或模板目录）下查找并执行指令。 */
export async function runAgentCommandInDir(
  agentDir: string,
  name: string,
  argline: string,
  cwd: string,
): Promise<AgentCommandFileResult | null> {
  const cmdDir = join(agentDir, "command");
  const candidates: Array<[string, "md" | "sh" | "node" | "tsx"]> = [
    [`${name}.md`, "md"],
    [`${name}.sh`, "sh"],
    [`${name}.mjs`, "node"],
    [`${name}.js`, "node"],
    [`${name}.ts`, "tsx"],
  ];
  for (const [file, kind] of candidates) {
    const p = join(cmdDir, file);
    if (!existsSync(p)) continue;
    if (kind === "md") {
      try {
        const raw = readFileSync(p, "utf-8");
        const parsed = parseCommandMarkdown(raw);
        let content = parsed.body || `(指令 /${name} 正文为空)`;
        if (argline.trim()) {
          content = `${content}\n\n## 用户附加参数\n\n${argline.trim()}`;
        }
        return { content, kind: parsed.kind, sourcePath: p };
      } catch {
        return {
          content: `(无法读取指令 ${name})`,
          kind: "reply",
          sourcePath: p,
        };
      }
    }
    const { execFile } = await import("node:child_process");
    const cmd = kind === "sh" ? "sh" : kind === "tsx" ? "npx" : "node";
    const args = kind === "tsx" ? ["tsx", p, argline] : [p, argline];
    const out = await new Promise<string>((resolve) => {
      const child = execFile(
        cmd,
        args,
        { cwd, timeout: TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const text = `${stdout ?? ""}${stderr ?? ""}`.trim();
          resolve(
            text ||
              (err
                ? `指令 /${name} 执行失败: ${err}`
                : `指令 /${name} 已执行（无输出）`),
          );
        },
      );
      child.on("error", () => resolve(`无法执行指令 /${name}`));
    });
    return { content: out, kind: "reply", sourcePath: p };
  }
  return null;
}

/**
 * 兼容旧签名：只返回文本；task/reply 信息会丢。
 * 新代码请用 runAgentCommandInDir / resolveAndRunAgentCommand。
 */
export async function runAgentCommand(
  agentDir: string,
  name: string,
  argline: string,
  cwd: string,
): Promise<string | null> {
  const r = await runAgentCommandInDir(agentDir, name, argline, cwd);
  return r?.content ?? null;
}

/**
 * 按优先级查找指令：
 * 1. 项目实例 `<project>/.maou/agents/<name>/command`
 * 2. 全局实例 `~/.maou/agents/<name>/command`
 * 3. 上述目录的 `.agent.ref` 指向的**模板** `command/`（引用模式）
 */
export async function resolveAndRunAgentCommand(opts: {
  name: string;
  argline: string;
  agentName: string;
  maouRoot: string;
  projectRoot: string;
}): Promise<AgentCommandFileResult | null> {
  const { name, argline, agentName, maouRoot, projectRoot } = opts;
  const dirs: string[] = [];
  const projectAgent = join(projectRoot, ".maou", "agents", agentName || "main");
  const globalAgent = join(maouRoot, "agents", agentName || "main");
  if (existsSync(projectAgent)) dirs.push(projectAgent);
  if (existsSync(globalAgent) && globalAgent !== projectAgent) dirs.push(globalAgent);

  const tried = new Set<string>();
  for (const dir of dirs) {
    if (tried.has(dir)) continue;
    tried.add(dir);
    const hit = await runAgentCommandInDir(dir, name, argline, projectRoot);
    if (hit) return hit;
    // 引用模式：跟模板 command/
    const refPath = join(dir, ".agent.ref");
    if (existsSync(refPath)) {
      try {
        const templateDir = readFileSync(refPath, "utf-8").trim();
        if (templateDir && existsSync(templateDir) && !tried.has(templateDir)) {
          tried.add(templateDir);
          const th = await runAgentCommandInDir(templateDir, name, argline, projectRoot);
          if (th) return th;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}
