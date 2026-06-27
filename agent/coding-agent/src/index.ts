/**
 * @little-house-studio/coding-agent — 编程 Agent
 *
 * 绑定项目目录后驻扎的编码服务。基于 agent 层的通用 Runtime 门面，
 * 通过「文件即 Agent」约定物化一个编程 agent 定义，使 AgentRuntime 自动拾取：
 *   - 编程工具白名单（PERMISSION.jsonc，真正强制）
 *   - 编程系统提示词（ROLE/SYSTEM.md）
 *   - 轮次上限等元数据（agent.json）
 *
 * 定位是「服务」：界面少，CLI 调试接口见 ./cli。
 *
 * 重构说明：本包仅保留 coding 特化部分（白名单 + 系统提示词 + 名称常量），
 * 通用骨架已上提到 agent 层：
 *   - materializeAgent（通用物化）
 *   - Runtime 门面的 enableCompression + agentName + startSession
 *   - AgentHandle 通用句柄接口
 *   - runAgentCli 通用 CLI 驱动
 */

import {
  Runtime,
  materializeAgent,
} from "@little-house-studio/agent";
import type { AgentHandle } from "@little-house-studio/agent";
import type { Summarizer } from "@little-house-studio/context";
import type { SessionStore } from "@little-house-studio/context";
import type { ToolRegistry } from "@little-house-studio/tools";
import type { LLMClient } from "@little-house-studio/llm";
import type { ConfigStore } from "@little-house-studio/types";
import { join } from "node:path";

/**
 * 编程场景默认工具白名单。
 * 工具名对齐 @little-house-studio/tools 内置实现的真实 name 字段
 * （reader/write_file/edit_file/glob/grep/find_code/use_terminal/search_internet/...）。
 */
export const CODING_TOOL_WHITELIST = [
  "reader",
  "write_file",
  "edit_file",
  "glob",
  "grep",
  "find_code",
  "use_terminal",
  "search_internet",
  "use_skill",
  "find_skill",
  "task_finish",
] as const;

/** coding agent 默认名称（即 ~/.maou/agents/<name>/）。 */
export const DEFAULT_CODING_AGENT_NAME = "coding";

/** coding agent 默认轮次上限。 */
export const DEFAULT_CODING_ROUND_LIMIT = 50;

/**
 * 编程系统提示词 —— 物化到 ROLE/SYSTEM.md，由 PromptCompiler 编译。
 * 保持精炼且聚焦：人设 + 工作方式 + 工具纪律 + 项目绑定意识。
 */
export const CODING_SYSTEM_PROMPT = `# 编程 Agent

你是一个驻扎在项目目录里的编程 agent，擅长阅读代码库、实现需求、修复缺陷、重构与验证。

## 工作方式
- **先理解再动手**：改动前先用 grep/glob/read 摸清相关文件与现有约定，模仿周边代码风格，不要凭空假设。
- **小步可验证**：优先做最小可用改动，改完即用终端/测试验证，失败如实报告，不谎报成功。
- **绑定项目根**：你驻扎在当前项目目录，所有路径以项目根为基准。

## 工具纪律
- 只使用授权工具（见工具白名单）。读文件优先 read，检索优先 grep/glob，跑命令用 bash/terminal。
- 破坏性或对外操作（删除、覆盖、推送）先确认，除非已被明确授权。
- 完成一个完整任务后调用 task_finish 收尾。

## 输出
- 用简洁中文说明你做了什么、为什么、验证结果。引用代码用 file_path:line 形式。
`;

export interface CodingAgentOptions {
  /** coding agent 名称（即 ~/.maou/agents/<name>/）。默认 "coding"。 */
  name?: string;
  /** 绑定的项目根目录（驻扎位置）。默认 process.cwd()。 */
  projectRoot?: string;
  /** ~/.maou 根目录。默认 $HOME/.maou。 */
  maouRoot?: string;
  /** 轮次上限。默认 50。 */
  roundLimit?: number;
  /** 覆盖默认编程工具白名单。 */
  toolWhitelist?: readonly string[];
  /** 强制重写已存在的 agent 定义（默认仅在缺失时创建）。 */
  forceMaterialize?: boolean;
  /** 工具输出压缩级别（写进 agent.json tool_compression）：off/normal/aggressive。默认 normal。 */
  toolCompression?: "off" | "normal" | "aggressive";
  /** 启用 ContextEngine 压缩闭环（默认 true）。关闭则回退 maybeCompress（truncate）。 */
  enableCompression?: boolean;
  /** 可插拔 LLM 摘要器（缺省回退确定性 truncate）。 */
  summarizer?: Summarizer;
  // ── 基础设施依赖（由应用层装配后注入）──
  configStore: ConfigStore;
  sessionStore: SessionStore;
  toolRegistry: ToolRegistry;
  llmClient: LLMClient;
}

/**
 * 编程 Agent 句柄：复用通用 AgentHandle 接口。
 * 不再独立定义 CodingAgent 字段（与 AgentHandle 完全一致），
 * 仅作为类型别名以便消费方按需引用。
 */
export type CodingAgent = AgentHandle;

/**
 * 物化「文件即 Agent」定义到 <maouRoot>/agents/<name>/。
 *
 * 薄包装：调用 agent 层的通用 materializeAgent，传入编程特化参数。
 * 保留此函数是为了向后兼容（已存在的调用方仍可用）。
 */
export function materializeCodingAgent(
  name: string,
  maouRoot: string,
  opts?: {
    roundLimit?: number;
    toolWhitelist?: readonly string[];
    force?: boolean;
    toolCompression?: "off" | "normal" | "aggressive";
  },
): void {
  materializeAgent(name, maouRoot, {
    systemPrompt: CODING_SYSTEM_PROMPT,
    toolWhitelist: opts?.toolWhitelist ?? CODING_TOOL_WHITELIST,
    role: "coding",
    displayName: "Coding Agent",
    description: "绑定项目目录驻扎的编码 agent",
    roundLimit: opts?.roundLimit ?? DEFAULT_CODING_ROUND_LIMIT,
    toolCompression: opts?.toolCompression ?? "normal",
    force: opts?.force ?? false,
  });
}

/**
 * 创建一个绑定到项目目录的编程 Agent。
 *
 * 物化编程 agent 定义（白名单/prompt 真正生效）+ 构建通用 Runtime 门面，
 * 返回带会话工厂的句柄。
 *
 * 重构后内部委托给 agent 层：
 *   - materializeAgent 物化骨架
 *   - Runtime 构造函数自动按 enableCompression + agentName 装配双 Store + persistCallback
 *   - runtime.startSession helper 自动恢复 task_plan
 */
export function createCodingAgent(opts: CodingAgentOptions): CodingAgent {
  const name = opts.name ?? DEFAULT_CODING_AGENT_NAME;
  const projectRoot = opts.projectRoot ?? process.cwd();
  const maouRoot = opts.maouRoot ?? join(process.env.HOME ?? "", ".maou");
  const toolWhitelist = opts.toolWhitelist ?? CODING_TOOL_WHITELIST;

  // 物化「文件即 Agent」定义 —— 使 AgentRuntime 自动拾取白名单 + 编程 prompt。
  materializeCodingAgent(name, maouRoot, {
    roundLimit: opts.roundLimit,
    toolWhitelist,
    force: opts.forceMaterialize,
    toolCompression: opts.toolCompression,
  });

  // Runtime 门面自动按 enableCompression + agentName 装配：
  //   - HarnessSessionStore + TaskSessionStore
  //   - TASK_MANAGER 持久化回调（含 relatedBlockIds 合并）
  //   - startSession 自动恢复 task_plan
  const runtime = new Runtime({
    configStore: opts.configStore,
    sessionStore: opts.sessionStore,
    toolRegistry: opts.toolRegistry,
    llmClient: opts.llmClient,
    maouRoot,
    projectRoot,
    enableCompression: opts.enableCompression,
    agentName: name,
    summarizer: opts.summarizer,
  });

  return {
    runtime,
    agentName: name,
    projectRoot,
    toolWhitelist,
    startSession: (title?: string) => runtime.startSession(name, title),
  };
}

// 透传通用 Runtime / CLI 驱动类型，便于消费方按需引用。
export { Runtime } from "@little-house-studio/agent";
export type { AppRuntimeOptions, AgentHandle } from "@little-house-studio/agent";
export { runAgentCli } from "@little-house-studio/agent";
export type { AgentCliOptions } from "@little-house-studio/agent";

// CLI 调试接口（编程特化薄包装）
export { runCodingAgentCli } from "./cli/index.js";
export type { CodingCliOptions } from "./cli/index.js";
