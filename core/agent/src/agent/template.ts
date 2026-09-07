/**
 * Agent 模板实例化引擎 —— 引用模式。
 *
 * 实例化不再复制模板文件，而是写一个 `.agent.ref` 指向模板目录。
 * 运行时通过 `.agent.ref` 读取模板的 prompt/loop/hook 等文件。
 * 用户定制通过 `agent.custom.json` 覆盖模板的 `agent.json` 配置。
 *
 * 好处：
 * - 改模板即时生效，不需要重新实例化
 * - 实例目录极小，只有 .agent.ref + agent.custom.json + 运行时数据
 * - 模板更新不覆盖用户定制
 *
 * 用法：
 *   createAgentFromTemplate("coding", maouRoot, {
 *     templateDir: "/path/to/templates/coding",
 *   })
 */

import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveMicroCompactRounds } from "@little-house-studio/context";
import { getTemplateRef } from "./template-ref.js";
import { renderAgentPreview } from "./preview.js";
import { ensureAgentOverview } from "./overview.js";

// re-export 保持兼容
export { renderAgentPreview, watchAgentPreview } from "./preview.js";
export { getTemplateRef } from "./template-ref.js";

/** agent.custom.json 可覆盖的字段（含 terminal_mode / thinking_* 等模式）。 */
export const AGENT_CUSTOM_KEYS = [
  "round_limit",
  "max_retries",
  "terminal_mode",
  "thinking_level",
  "thinking_context_mode",
  "micro_compact_rounds",
  "role",
  "display_name",
  "reviewer_role",
  "tools",
  "tool_compression",
  "verify_command",
  "working_dir",
  "system_append",
  "system_override",
  "tools_add",
  "tools_remove",
  "mcp_tool_strategy",
  "mcp",
  "workspace_instructions",
] as const;

export type AgentCustomKey = (typeof AGENT_CUSTOM_KEYS)[number];

const AGENT_CUSTOM_KEY_SET = new Set<string>(AGENT_CUSTOM_KEYS);

export function isAgentCustomKey(key: string): key is AgentCustomKey {
  return AGENT_CUSTOM_KEY_SET.has(key);
}

export function readAgentWorkspaceInstructions(config: Record<string, unknown>): boolean | null {
  const camel = config.workspaceInstructions;
  if (typeof camel === "boolean") return camel;
  const snake = config.workspace_instructions;
  if (typeof snake === "boolean") return snake;
  return null;
}

export function readAgentMicroCompactRounds(config: Record<string, unknown>): number {
  return resolveMicroCompactRounds(config.micro_compact_rounds ?? config.microCompactRounds);
}

/** 把允许的字段写入实例 agent.custom.json，再返回合并后的配置。 */
export function patchAgentCustomConfig(
  agentDir: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  mkdirSync(agentDir, { recursive: true });
  const customPath = join(agentDir, "agent.custom.json");
  let custom: Record<string, unknown> = {};
  if (existsSync(customPath)) {
    try {
      custom = JSON.parse(readFileSync(customPath, "utf-8")) as Record<string, unknown>;
    } catch { /* ignore */ }
  }
  for (const [key, value] of Object.entries(fields)) {
    if (!isAgentCustomKey(key) || value === undefined) continue;
    custom[key] = value;
  }
  custom.updated_at = new Date().toISOString();
  writeFileSync(customPath, JSON.stringify(custom, null, 2), "utf-8");
  return resolveAgentConfig(agentDir);
}

export interface CreateAgentOptions {
  /** 模板源目录（必填，如 maou-agent/templates/coding/） */
  templateDir: string;
  displayName?: string;
  role?: string;
  /** 覆盖模板 system.md 内容（写入实例目录的 prompt/system/system.md） */
  systemPrompt?: string;
  /** 覆盖模板 before_user.md */
  beforeUser?: string;
  tools?: readonly string[];
  roundLimit?: number;
  maxRetries?: number;
  terminalMode?: "normal" | "auto" | "yolo";
  reviewerRole?: string;
  /** 已存在时是否强制覆盖（否则幂等跳过） */
  force?: boolean;
  /**
   * 是否自动生成 agent.custom.json。
   * true（默认）：将传入的参数（tools/role/roundLimit 等）写入 agent.custom.json，覆盖模板对应字段。
   * false：不写 agent.custom.json，运行时完全使用模板 agent.json 的值。
   * 设为 false 后，模板更新工具白名单等配置可即时生效。
   * 注意：即使设为 false，后续手动创建 agent.custom.json 仍会生效（resolveAgentConfig 会读取）。
   */
  noCustomConfig?: boolean;
  /**
   * 实例目录路径（可选）。默认 <maouRoot>/agents/<name>（全局）；
   * 传入则写到指定目录（如 <projectRoot>/.maou/agents/<name> 项目级）。
   */
  targetDir?: string;
}

/**
 * 创建 agent 实例：写 `.agent.ref` 指向模板目录。
 * 不复制模板文件。运行时读模板。
 * 返回实例目录路径。幂等：已存在且未 force 时直接返回。
 */
export function createAgentFromTemplate(name: string, maouRoot: string, opts: CreateAgentOptions): string {
  const templateDir = opts.templateDir;
  // targetDir 优先（项目级），否则默认全局 <maouRoot>/agents/<name>
  const target = opts.targetDir ?? join(maouRoot, "agents", name);

  // 幂等：已有 .agent.ref 且未 force → 直接返回
  if (existsSync(join(target, ".agent.ref")) && !opts.force) {
    return target;
  }

  if (!existsSync(templateDir)) {
    throw new Error(`agent 模板目录不存在: ${templateDir}`);
  }

  mkdirSync(target, { recursive: true });

  // 写 .agent.ref（模板路径引用）
  writeFileSync(join(target, ".agent.ref"), templateDir, "utf-8");

  // 如果有覆盖项，写入 agent.custom.json（noCustomConfig 时跳过）
  const custom: Record<string, unknown> = {};
  if (!opts.noCustomConfig) {
    if (typeof opts.roundLimit === "number") custom.round_limit = opts.roundLimit;
    if (typeof opts.maxRetries === "number") custom.max_retries = opts.maxRetries;
    if (opts.terminalMode) custom.terminal_mode = opts.terminalMode;
    if (opts.reviewerRole) custom.reviewer_role = opts.reviewerRole;
    if (opts.role) custom.role = opts.role;
    if (opts.displayName) custom.display_name = opts.displayName;
    if (opts.tools) custom.tools = [...opts.tools];
  }

  // 如果有提示词覆盖，写入实例目录（运行时优先读实例的覆盖文件）
  if (opts.systemPrompt) {
    mkdirSync(join(target, "prompt", "system"), { recursive: true });
    writeFileSync(join(target, "prompt", "system", "system.md"), opts.systemPrompt, "utf-8");
  }
  if (opts.beforeUser) {
    mkdirSync(join(target, "prompt", "before_user"), { recursive: true });
    writeFileSync(join(target, "prompt", "before_user", "before_user.md"), opts.beforeUser, "utf-8");
  }

  // 写 agent.custom.json（只写有覆盖项的字段）
  if (Object.keys(custom).length > 0) {
    custom.updated_at = new Date().toISOString();
    writeFileSync(join(target, "agent.custom.json"), JSON.stringify(custom, null, 2), "utf-8");
  }

  // 首次实例化：写 OVERVIEW.md（Agent 列表灰色概述）
  try {
    ensureAgentOverview(target, {
      name,
      displayName: opts.displayName,
      role: opts.role,
      seed: opts.displayName ? `${opts.displayName} agent` : undefined,
    });
  } catch { /* ignore */ }

  // 渲染 PREVIEW（从模板读取，写入实例的 .cache/ 目录）
  try { renderAgentPreview(target, templateDir); } catch { /* 渲染失败不影响创建 */ }

  return target;
}

/**
 * 解析 agent 的 promptRoot：
 * 1. 如果实例目录有 prompt/system/system.md（用户覆盖）→ 用实例目录的 prompt/
 * 2. 如果有 .agent.ref → 用模板目录的 prompt/
 * 3. 否则用实例目录的 prompt/（旧模式兼容）
 */
export function resolvePromptRoot(agentDir: string): { promptRoot: string; entrypoint: string } {
  // 1. 实例目录有覆盖的 system.md
  if (existsSync(join(agentDir, "prompt", "system", "system.md"))) {
    return { promptRoot: join(agentDir, "prompt"), entrypoint: "system/system.md" };
  }

  // 2. 有 .agent.ref → 读模板
  const templateDir = getTemplateRef(agentDir);
  if (templateDir) {
    if (existsSync(join(templateDir, "prompt", "system", "system.md"))) {
      return { promptRoot: join(templateDir, "prompt"), entrypoint: "system/system.md" };
    }
    // 模板可能有旧结构
    if (existsSync(join(templateDir, "ROLE", "SYSTEM.md"))) {
      return { promptRoot: join(templateDir, "ROLE"), entrypoint: "SYSTEM.md" };
    }
  }

  // 3. 旧模式兼容：实例目录自身有 prompt/
  return { promptRoot: join(agentDir, "prompt"), entrypoint: "system/system.md" };
}

/**
 * 合并 agent.json（模板）+ agent.custom.json（实例覆盖）。
 * 返回合并后的配置对象。
 */
export function resolveAgentConfig(agentDir: string): Record<string, unknown> {
  const templateDir = getTemplateRef(agentDir);

  // 1. 读模板的 agent.json（基础配置）
  let base: Record<string, unknown> = {};
  const templateAgentJson = templateDir ? join(templateDir, "agent.json") : null;
  if (templateAgentJson && existsSync(templateAgentJson)) {
    try { base = JSON.parse(readFileSync(templateAgentJson, "utf-8")); } catch { /* ignore */ }
  }

  // 也读实例目录的 agent.json（旧模式兼容或用户直接改的）
  const instanceAgentJson = join(agentDir, "agent.json");
  if (existsSync(instanceAgentJson)) {
    try {
      const inst = JSON.parse(readFileSync(instanceAgentJson, "utf-8"));
      base = { ...base, ...inst };
    } catch { /* ignore */ }
  }

  // 2. 读 agent.custom.json（覆盖项）
  const customPath = join(agentDir, "agent.custom.json");
  if (existsSync(customPath)) {
    try {
      const custom = JSON.parse(readFileSync(customPath, "utf-8"));
      for (const key of AGENT_CUSTOM_KEYS) {
        if (custom[key] !== undefined) {
          base[key] = custom[key];
        }
      }
      // tools_add / tools_remove 特殊处理
      if (Array.isArray(custom.tools_add) || Array.isArray(custom.tools_remove)) {
        let tools = Array.isArray(base.tools) ? [...base.tools as string[]] : [];
        if (Array.isArray(custom.tools_add)) tools.push(...custom.tools_add as string[]);
        if (Array.isArray(custom.tools_remove)) {
          tools = tools.filter(t => !(custom.tools_remove as string[]).includes(t));
        }
        base.tools = tools;
      }
    } catch { /* ignore */ }
  }

  return base;
}
