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
 *   - createAgentFromTemplate（引用模式物化，.agent.ref 指向包内模板）
 *   - Runtime 门面的 enableCompression + agentName + startSession
 *   - AgentHandle 通用句柄接口
 *   - runAgentCli 通用 CLI 驱动
 */

import {
  Runtime,
  createAgentFromTemplate,
} from "@little-house-studio/agent";
import type { AgentHandle } from "@little-house-studio/agent";
import type { Summarizer } from "@little-house-studio/context";
import type { SessionStore } from "@little-house-studio/context";
import type { ToolRegistry } from "@little-house-studio/tools";
import type { LLMClient } from "@little-house-studio/llm";
import type { ConfigStore } from "@little-house-studio/types";
import type { StreamEvent } from "@little-house-studio/types";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// /goal 监督模式：callMainAgent 闭包用此引用拿当前 send 的 AbortController。
// useAgent 每次 send 前调 setSupervisorAbortSignal 更新，使 Ctrl+C 能中断嵌套的主 Agent run。
let _currentAbortSignal: AbortSignal | undefined;
export function setSupervisorAbortSignal(sig: AbortSignal | undefined): void {
  _currentAbortSignal = sig;
}

/**
 * 解析包内 coding 模板目录的绝对路径。
 * dist/index.js → 回溯到包根的 templates/coding/。
 * templates 已加入 package.json files，随包发布。
 */
function resolveCodingTemplateDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/index.js → dist/ → 包根 → templates/coding
  return join(here, "..", "templates", "coding");
}

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
  "task_manage",
  "task_finish",
] as const;

/** coding agent 默认名称（即 ~/.maou/agents/<name>/）。 */
export const DEFAULT_CODING_AGENT_NAME = "coding";

/** coding agent 默认轮次上限。 */
export const DEFAULT_CODING_ROUND_LIMIT = 50;

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
  /** Runtime 日志函数。CLI 传 () => {} 静默（避免污染 Ink stdout）。 */
  log?: (level: string, message: string) => void;
  /** 是否启用 LLM postLogger（pino + raw.jsonl）。CLI 传 false 静默。 */
  enablePostLogger?: boolean;
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
 * 创建一个绑定到项目目录的编程 Agent。
 *
 * 用「引用模式」物化（.agent.ref 指向包内 coding 模板）：实例只存 ref + agent.custom.json，
 * 运行时读模板的 prompt/loop 等，改模板即时生效。覆盖项（roundLimit/toolCompression 等）
 * 写进 agent.custom.json，优先于模板。
 *
 * Runtime 门面自动按 enableCompression + agentName 装配双 Store + persistCallback。
 */
export function createCodingAgent(opts: CodingAgentOptions): CodingAgent {
  const name = opts.name ?? DEFAULT_CODING_AGENT_NAME;
  const projectRoot = opts.projectRoot ?? process.cwd();
  const maouRoot = opts.maouRoot ?? join(process.env.HOME ?? "", ".maou");
  const toolWhitelist = opts.toolWhitelist ?? CODING_TOOL_WHITELIST;

  // 引用模式物化：.agent.ref 指向包内 coding 模板。
  // noCustomConfig=true：不写 agent.custom.json，运行时完全使用模板 agent.json，
  // 这样模板更新工具白名单等配置后可即时生效（重启 CLI 即可）。
  // coding agent 只服务项目级：实例写到 <projectRoot>/.maou/agents/<name>。
  const targetDir = join(projectRoot, ".maou", "agents", name);
  createAgentFromTemplate(name, maouRoot, {
    templateDir: resolveCodingTemplateDir(),
    targetDir,
    displayName: "Coding Agent",
    role: "coding",
    tools: toolWhitelist,
    roundLimit: opts.roundLimit ?? DEFAULT_CODING_ROUND_LIMIT,
    force: opts.forceMaterialize,
    noCustomConfig: true,
  });

  // Runtime 门面自动按 enableCompression + agentName 装配：
  //   - HarnessSessionStore + TaskSessionStore
  //   - TASK_MANAGER 持久化回调（含 relatedBlockIds 合并）
  //   - startSession 自动恢复 task_plan
  // /goal 监督模式：callMainAgent 注入（复用 harness 逻辑：preset + yolo sandbox + initAgentName main）。
  // runtimeContainer 延迟引用：new Runtime 后赋值，让闭包能拿到 runtime 实例调 rt.run。
  const runtimeContainer: { ref: Runtime | null } = { ref: null };
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
    log: opts.log ?? ((level, msg) => console[level === "error" ? "error" : "log"](`[Runtime] ${msg}`)),
    enablePostLogger: opts.enablePostLogger ?? true,
    callMainAgent: (mainSessionId, message, abortSignal) => {
      const gen = (async function* () {
        const rt = runtimeContainer.ref;
        if (!rt) return "❌ Runtime 未初始化。";
        // 从 configStore 拿主 Agent preset（复用 harness/runtime.ts 逻辑）
        const config = opts.configStore.get();
        const presets = (config as { api?: { presets?: unknown[]; defaultPreset?: number } }).api?.presets ?? [];
        const idx = (config as { api?: { defaultPreset?: number } }).api?.defaultPreset ?? 0;
        const preset = (presets[idx] ?? presets[0]) as Record<string, unknown> | undefined;
        if (!preset) return "❌ 无可用 preset。";
        // 监督模式下主 agent 必须能自由跑 build/test/install，强制 yolo（否则命令全被"需确认"拦住）
        let finalOutput = "";
        try {
          for await (const event of rt.run({
            sessionId: mainSessionId,
            userMessage: message,
            preset,
            stream: true,
            // 合并外部 abortSignal（supervisor_chat_main 传的）+ 当前 send 的 abortSignal（Ctrl+C）
            abortSignal: abortSignal ?? _currentAbortSignal,
            sandboxMode: "yolo",
            initAgentName: "main",
          })) {
            yield event as StreamEvent;
            if (event.type === "assistant" && typeof (event as { content?: unknown }).content === "string") {
              finalOutput = (event as { content: string }).content;
            }
          }
        } catch (err) {
          return `❌ 主 Agent 执行失败: ${err instanceof Error ? err.message : String(err)}`;
        }
        return finalOutput || "(主 Agent 无输出)";
      })();
      return gen;
    },
  });
  runtimeContainer.ref = runtime;

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
