/**
 * 附属驻扎 runner：物化 nested subagent 后，用父主体 coding 的 Runtime 执行扫描。
 *
 * 原因：Runtime 注册表按 agents/<name> 解析顶层 agent；附属落在
 * agents/coding/subagents/proactive。执行侧走 parent Runtime + 驻扎 system 提示，
 * 会话标题标记 proactive，不把 proactive 注册为可切换主体。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StreamEvent } from "@little-house-studio/types";
import type { ConfigStore } from "@little-house-studio/types";
import type { SessionStore } from "@little-house-studio/context";
import type { ToolRegistry } from "@little-house-studio/tools";
import type { LLMClient } from "@little-house-studio/llm";
import { Runtime } from "../runtime-facade.js";
import {
  createCallMainAgent,
  createStandardAgentDeps,
  getDefaultPresetFromConfigStore,
  getRolePresetFromMaouConfig,
  listModelsForCli,
  listProvidersForCli,
  resolvePresetForCli,
} from "../../bootstrap/index.js";
import { resolveUserMaouRoot, runtimePresetRoute } from "@little-house-studio/types";
import {
  DEFAULT_PROACTIVE_AGENT_NAME,
  DEFAULT_PROACTIVE_PARENT_AGENT,
  PROACTIVE_SCAN_TOOL_WHITELIST,
} from "./defaults.js";
import {
  ensureProactiveStationed,
  type ProactiveStation,
} from "./station.js";

export type ProactiveRunnerOpts = {
  projectRoot: string;
  maouRoot?: string;
  parentAgentName?: string;
  agentName?: string;
  sandboxMode?: string;
  configStore?: ConfigStore;
  sessionStore?: SessionStore;
  toolRegistry?: ToolRegistry;
  llmClient?: LLMClient;
};

export type ProactiveRunner = {
  station: ProactiveStation;
  /** 父主体 Runtime（coding） */
  parentAgentName: string;
  affiliateName: string;
  projectRoot: string;
  abort: () => void;
  run: (userMessage: string) => AsyncGenerator<StreamEvent>;
};

function loadStationSystemPrompt(stationDir: string): string {
  const candidates = [
    join(stationDir, "prompt", "system", "system.md"),
    join(stationDir, "ROLE", "SYSTEM.md"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) return readFileSync(p, "utf8");
    } catch {
      /* ignore */
    }
  }
  return "";
}

/**
 * 创建附属驻扎 runner：ensure station + parent Runtime。
 */
export function createProactiveAffiliateRunner(
  opts: ProactiveRunnerOpts,
): ProactiveRunner {
  const projectRoot = opts.projectRoot;
  const maouRoot = opts.maouRoot ?? resolveUserMaouRoot();
  const parentAgentName =
    opts.parentAgentName ?? DEFAULT_PROACTIVE_PARENT_AGENT;
  const affiliateName = opts.agentName ?? DEFAULT_PROACTIVE_AGENT_NAME;
  const sandboxMode = opts.sandboxMode ?? "yolo";

  const station = ensureProactiveStationed({
    projectRoot,
    parentAgentName,
    name: affiliateName,
  });

  const deps =
    opts.configStore &&
    opts.sessionStore &&
    opts.toolRegistry &&
    opts.llmClient
      ? {
          configStore: opts.configStore,
          sessionStore: opts.sessionStore,
          toolRegistry: opts.toolRegistry,
          llmClient: opts.llmClient,
        }
      : createStandardAgentDeps(projectRoot, maouRoot, {
          reviewerOnMissingPreset: "approve",
        });

  // 主体 Runtime（coding）—— 工具/会话挂在主体上
  const runtimeContainer: { ref: Runtime | null } = { ref: null };
  const runtime = new Runtime({
    configStore: deps.configStore,
    sessionStore: deps.sessionStore,
    toolRegistry: deps.toolRegistry,
    llmClient: deps.llmClient,
    maouRoot,
    projectRoot,
    agentName: parentAgentName,
    enablePostLogger: false,
    fileDiffWatch: false,
    log: () => {},
    callMainAgent: createCallMainAgent({
      getRuntime: () => runtimeContainer.ref,
      getDefaultPreset: () =>
        getDefaultPresetFromConfigStore(deps.configStore),
      sandboxMode: "yolo",
    }),
  });
  runtimeContainer.ref = runtime;

  let abortCtrl: AbortController | null = null;
  let provider = "";
  let model = "";

  const bootstrapPreset = () => {
    try {
      const main = getRolePresetFromMaouConfig("main") as
        | { name?: string; model?: string; _providerName?: string }
        | undefined;
      const route = main ? runtimePresetRoute(main) : undefined;
      if (route?.provider && route.model) {
        provider = route.provider;
        model = route.model;
        return;
      }
    } catch {
      /* fall through */
    }
    const ps = listProvidersForCli();
    if (ps[0]) {
      provider = ps[0].id;
      const ms = listModelsForCli(ps[0].id);
      model = ms[0]?.id ?? "";
    }
  };

  const systemPrompt = loadStationSystemPrompt(station.dir);

  return {
    station,
    parentAgentName,
    affiliateName,
    projectRoot,
    abort() {
      abortCtrl?.abort();
      abortCtrl = null;
    },
    async *run(userMessage: string) {
      if (!provider) bootstrapPreset();
      abortCtrl?.abort();
      abortCtrl = new AbortController();
      const sessionId = runtime.startSession(
        `${affiliateName}@${parentAgentName}`,
      );
      const preset = resolvePresetForCli(provider, model) as Record<
        string,
        unknown
      >;
      const preamble = systemPrompt
        ? `${systemPrompt.trim()}\n\n---\n\n`
        : "";
      // 工具白名单：只读扫描（Runtime 侧 agent 是 parent，用消息约束 + 可选后续收紧）
      const toolNote =
        `\n[affiliate-tools] 本轮你是附属驻扎 agent「${affiliateName}」，` +
        `只使用只读分析工具：${PROACTIVE_SCAN_TOOL_WHITELIST.join(", ")}。` +
        `不要修改业务代码；落地由主体 ${parentAgentName} 执行。\n\n`;

      try {
        for await (const ev of runtime.run({
          sessionId,
          userMessage: preamble + toolNote + userMessage,
          preset,
          stream: true,
          abortSignal: abortCtrl.signal,
          source: "proactive-affiliate",
          sandboxMode,
          initAgentName: parentAgentName,
        })) {
          yield ev;
          if (ev.type === "done" || ev.type === "error") break;
        }
      } finally {
        abortCtrl = null;
      }
    },
  };
}
