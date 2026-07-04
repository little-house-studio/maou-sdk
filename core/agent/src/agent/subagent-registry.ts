/**
 * Subagent 系统 — 文件即子 Agent（对标 Vercel Eve）
 *
 * 约定：agent/subagents/<name>/ 目录即子 Agent
 * 子 Agent 拥有独立的 prompt/system/system.md、tools/、skills/
 * 父 Agent 通过内置的 "agent" 工具委托任务给子 Agent
 *
 * @example
 * agent/subagents/investigator/
 * ├── agent.ts            # defineAgent({ description: "调查数据异常" })
 * ├── prompt/system/system.md  # 子 Agent 的系统提示词（eve 结构）
 * └── tools/              # 子 Agent 专属工具
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import type { AgentRegistry } from "./registry.js";
import type { DefinedAgent } from "./define-agent.js";

// ─── 类型 ──────────────────────────────────────────────────────────────────

export interface SubagentEntry {
  /** 子 Agent 名（目录名） */
  name: string;
  /** 子 Agent 描述（从 agent.ts 的 defineAgent.description 提取） */
  description: string;
  /** 子 Agent 目录路径 */
  dir: string;
  /** 是否有 agent.ts */
  hasAgentTs: boolean;
  /** 子 Agent 工具列表 */
  tools: string[];
  /** 子 Agent 技能列表 */
  skills: string[];
}

// ─── SubagentRegistry ──────────────────────────────────────────────────────

/**
 * 子 Agent 注册表
 * 扫描 agent/subagents/ 目录，发现子 Agent 定义
 */
export class SubagentRegistry {
  private _subagents = new Map<string, SubagentEntry>();
  private _maouRoot: string;

  constructor(maouRoot: string) {
    this._maouRoot = maouRoot;
  }

  /**
   * 扫描指定 agent 的 subagents/ 目录
   */
  loadForAgent(agentName: string): number {
    this._subagents.clear();
    const subagentsDir = join(this._maouRoot, "agents", agentName, "subagents");
    if (!existsSync(subagentsDir)) return 0;

    let count = 0;
    try {
      const entries = readdirSync(subagentsDir).sort();
      for (const entry of entries) {
        const dir = join(subagentsDir, entry);
        try {
          if (!statSync(dir).isDirectory()) continue;
        } catch {
          continue;
        }

        const subagent = this._scanSubagentDir(dir, entry);
        if (subagent) {
          this._subagents.set(entry, subagent);
          count++;
        }
      }
    } catch { /* ignore */ }

    return count;
  }

  /**
   * 获取子 Agent
   */
  get(name: string): SubagentEntry | undefined {
    return this._subagents.get(name);
  }

  /**
   * 列出所有子 Agent
   */
  listAll(): SubagentEntry[] {
    return [...this._subagents.values()];
  }

  /** 子 Agent 数量 */
  get count(): number {
    return this._subagents.size;
  }

  /**
   * 生成子 Agent 的 LLM 工具 schema
   * 每个子 Agent 注册为一个 "agent" 工具的变体
   */
  toToolSchemas(): Array<Record<string, unknown>> {
    const schemas: Array<Record<string, unknown>> = [];
    for (const sub of this._subagents.values()) {
      schemas.push({
        name: `subagent_${sub.name}`,
        description: sub.description || `委托任务给子 Agent「${sub.name}」`,
        type: "object",
        properties: {
          task: {
            type: "string",
            description: `要委托给「${sub.name}」的任务描述`,
          },
        },
        required: ["task"],
        additionalProperties: false,
      });
    }
    return schemas;
  }

  // ── 内部 ──

  private _scanSubagentDir(dir: string, dirName: string): SubagentEntry | null {
    const agentTsPath = join(dir, "agent.ts");
    const toolsDir = join(dir, "tools");
    const skillsDir = join(dir, "skills");

    // 必须有 agent.ts 或 agent.json（eve 结构）
    const hasAgentTs = existsSync(agentTsPath);
    const hasAgentJson = existsSync(join(dir, "agent.json"));
    if (!hasAgentTs && !hasAgentJson) return null;

    // 提取描述
    let description = dirName;
    if (hasAgentJson) {
      try {
        const content = readFileSync(join(dir, "agent.json"), "utf-8");
        const data = JSON.parse(content);
        if (data.description) description = data.description;
        else if (data.display_name) description = data.display_name;
      } catch { /* ignore */ }
    }

    // 扫描工具
    const tools: string[] = [];
    if (existsSync(toolsDir)) {
      try {
        for (const entry of readdirSync(toolsDir)) {
          if (entry.endsWith(".ts") || entry.endsWith(".mjs")) {
            tools.push(basename(entry, entry.endsWith(".ts") ? ".ts" : ".mjs"));
          }
        }
      } catch { /* ignore */ }
    }

    // 扫描技能
    const skills: string[] = [];
    if (existsSync(skillsDir)) {
      try {
        for (const entry of readdirSync(skillsDir)) {
          if (entry.endsWith(".md")) {
            skills.push(basename(entry, ".md"));
          }
        }
      } catch { /* ignore */ }
    }

    return {
      name: dirName,
      description,
      dir,
      hasAgentTs,
      tools,
      skills,
    };
  }
}
