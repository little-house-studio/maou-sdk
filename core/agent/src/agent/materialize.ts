/**
 * materializeAgent —— 「文件即 Agent」约定的通用物化骨架。
 *
 * 把一个 agent 定义物化到 <maouRoot>/agents/<name>/ 目录：
 *   - agent.json        元数据（role/round_limit/tools/tool_compression）
 *   - ROLE/SYSTEM.md    系统提示词（PromptCompiler 入口）
 *   - PERMISSION.jsonc  工具白名单（真正强制）
 *
 * 幂等：默认仅在缺失时创建；force=true 时重写。
 *
 * 各场景特化 agent（coding / reviewer / security-auditor / ...）只需传入
 * 自己的 systemPrompt + toolWhitelist + role 即可复用此骨架，
 * 不必各自实现一遍物化逻辑。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface MaterializeAgentOptions {
  /** 系统提示词正文（写入 ROLE/SYSTEM.md）。 */
  systemPrompt: string;
  /** 工具白名单（写入 PERMISSION.jsonc.tool_whitelist + agent.json.tools）。 */
  toolWhitelist: readonly string[];
  /** agent.json 中的 role 字段（如 "coding" / "reviewer"）。默认 "default"。 */
  role?: string;
  /** agent.json 中的 display_name。默认取 name 首字母大写。 */
  displayName?: string;
  /** agent.json 中的 description。默认空字符串。 */
  description?: string;
  /** 轮次上限（写入 agent.json.round_limit）。默认 50。 */
  roundLimit?: number;
  /** 工具输出压缩级别（写入 agent.json.tool_compression）。默认 "normal"。 */
  toolCompression?: "off" | "normal" | "aggressive";
  /** 强制重写已存在的文件。默认 false（仅在缺失时创建）。 */
  force?: boolean;
}

/** 默认轮次上限 */
export const DEFAULT_AGENT_ROUND_LIMIT = 50;

/**
 * 物化「文件即 Agent」定义到 <maouRoot>/agents/<name>/。
 *
 * @param name agent 名称（即目录名）
 * @param maouRoot ~/.maou 根目录
 * @param opts 特化参数（prompt / 白名单 / role / round_limit / ...）
 */
export function materializeAgent(
  name: string,
  maouRoot: string,
  opts: MaterializeAgentOptions,
): void {
  const dir = join(maouRoot, "agents", name);
  const roleDir = join(dir, "ROLE");
  const systemPath = join(roleDir, "SYSTEM.md");
  const agentJsonPath = join(dir, "agent.json");
  const permissionPath = join(dir, "PERMISSION.jsonc");
  const whitelist = opts.toolWhitelist;
  const roundLimit = opts.roundLimit ?? DEFAULT_AGENT_ROUND_LIMIT;
  const toolCompression = opts.toolCompression ?? "normal";
  const role = opts.role ?? "default";
  const force = opts.force ?? false;
  const displayName = opts.displayName ?? name.charAt(0).toUpperCase() + name.slice(1);
  const description = opts.description ?? "";

  mkdirSync(roleDir, { recursive: true });

  if (force || !existsSync(agentJsonPath)) {
    const now = new Date().toISOString();
    const agentEntry = {
      name,
      display_name: displayName,
      status: "idle",
      role,
      team: "",
      parent: "",
      personality: "",
      scope: "project",
      description,
      notes: "",
      round_limit: roundLimit,
      tools: [...whitelist],
      // 工具输出压缩级别（摄入层省 token）：off/normal/aggressive
      tool_compression: toolCompression,
      created_at: now,
      updated_at: now,
    };
    writeFileSync(agentJsonPath, JSON.stringify(agentEntry, null, 2), "utf-8");
  }

  if (force || !existsSync(systemPath)) {
    writeFileSync(systemPath, opts.systemPrompt, "utf-8");
  }

  if (force || !existsSync(permissionPath)) {
    const permission = {
      permission_preset: "full",
      tool_whitelist: [...whitelist],
    };
    writeFileSync(permissionPath, JSON.stringify(permission, null, 2), "utf-8");
  }
}
