/**
 * 主动智能驻扎 —— 用 Agent 层 defineSubagent + materializeSubagent
 * 挂靠 parent（默认 coding）的 nested 附属，list_in_manager=false。
 *
 * 落盘：
 *   <project>/.maou/agents/<parent>/subagents/proactive/
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineSubagent } from "../define-subagent.js";
import {
  materializeSubagent,
  resolveSubagentDir,
  type MaterializeResult,
} from "../subagent-lifecycle.js";
import {
  DEFAULT_PROACTIVE_AGENT_NAME,
  DEFAULT_PROACTIVE_PARENT_AGENT,
  DEFAULT_PROACTIVE_ROUND_LIMIT,
  PROACTIVE_SCAN_TOOL_WHITELIST,
} from "./defaults.js";

function defaultSystemPrompt(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/agent/proactive → ../../../templates/subagents/proactive/...
    const p = join(
      here,
      "..",
      "..",
      "..",
      "templates",
      "subagents",
      "proactive",
      "prompt",
      "system",
      "system.md",
    );
    if (existsSync(p)) return readFileSync(p, "utf8");
  } catch {
    /* fall through */
  }
  return (
    `# 主动智能（附属驻扎 Agent）\n\n` +
    `你是挂靠主 coding 的附属驻扎 agent，不是可切换主体。` +
    `只读分析项目并输出 proactive-json 改进项；不直接改业务代码。\n`
  );
}

export type EnsureProactiveStationedOpts = {
  /** 项目根（驻扎在项目 .maou 下） */
  projectRoot: string;
  parentAgentName?: string;
  name?: string;
  force?: boolean;
};

export type ProactiveStation = {
  /** 实例目录 */
  dir: string;
  agentName: string;
  parentAgentName: string;
  /** project 的 .maou 根（materialize 时作为 agents 根） */
  projectMaouRoot: string;
  created: boolean;
  /** 相对主体的 nested 路径语义 */
  storageScope: "nested";
  stationed: true;
};

/**
 * 确保主动智能已作为附属 subagent 驻扎在 parent 下。
 */
export function ensureProactiveStationed(
  opts: EnsureProactiveStationedOpts,
): ProactiveStation {
  const projectRoot = opts.projectRoot;
  const parentAgentName =
    opts.parentAgentName ?? DEFAULT_PROACTIVE_PARENT_AGENT;
  const name = opts.name ?? DEFAULT_PROACTIVE_AGENT_NAME;
  const projectMaouRoot = join(projectRoot, ".maou");

  // 保证 parent 目录存在（coding 主体可稍后物化）
  mkdirSync(join(projectMaouRoot, "agents", parentAgentName), {
    recursive: true,
  });

  const defined = defineSubagent({
    kind: "task",
    name,
    displayName: "主动智能（附属驻扎）",
    description:
      "挂靠主 coding 的持久附属扫描 agent；非可切换主体；落地由主 coding 执行。",
    parentAgentName,
    permission: "readonly",
    toolPreset: "explore",
    tools: [...PROACTIVE_SCAN_TOOL_WHITELIST],
    persistContext: true,
    enableLoop: true,
    ephemeral: false,
    storageScope: "nested",
    roundLimit: DEFAULT_PROACTIVE_ROUND_LIMIT,
    systemPrompt: defaultSystemPrompt(),
    // toAgentJson 中 extra 覆盖 list_in_manager
    extra: {
      list_in_manager: false,
      stationed: true,
      role: "proactive",
      parent: parentAgentName,
    },
  });

  const result: MaterializeResult = materializeSubagent(defined, {
    maouRoot: projectMaouRoot,
    force: opts.force,
  });

  // 强制写回 list_in_manager=false（task 默认 true，extra 应已覆盖；再保险）
  const dir =
    result.dir ||
    resolveSubagentDir({
      maouRoot: projectMaouRoot,
      parentAgentName,
      name,
      storageScope: "nested",
      ephemeral: false,
    });

  return {
    dir,
    agentName: name,
    parentAgentName,
    projectMaouRoot,
    created: result.created,
    storageScope: "nested",
    stationed: true,
  };
}

/** 解析驻扎目录（不物化） */
export function resolveProactiveStationDir(
  projectRoot: string,
  parentAgentName = DEFAULT_PROACTIVE_PARENT_AGENT,
  name = DEFAULT_PROACTIVE_AGENT_NAME,
): string {
  return resolveSubagentDir({
    maouRoot: join(projectRoot, ".maou"),
    parentAgentName,
    name,
    storageScope: "nested",
    ephemeral: false,
  });
}
