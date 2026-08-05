/**
 * @little-house-studio/ops-agent — 机器级电脑管家 Agent。
 */

import {
  Runtime,
  createAgentFromTemplate,
  createCallMainAgent,
  getDefaultPresetFromConfigStore,
} from "@little-house-studio/agent";
import type { AgentHandle } from "@little-house-studio/agent";
import {
  HarnessSessionStore,
  TaskSessionStore,
} from "@little-house-studio/context";
import type { Summarizer, SessionStore } from "@little-house-studio/context";
import { machineOpenPathGuard } from "@little-house-studio/tools";
import type { ToolRegistry } from "@little-house-studio/tools";
import type { LLMClient } from "@little-house-studio/llm";
import type { ConfigStore } from "@little-house-studio/types";
import {
  resolveUserMaouRoot,
  resolveUserOpsRoot,
  resolveUserOpsSessionsDir,
} from "@little-house-studio/types";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";

function resolveOpsTemplateDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "templates", "ops");
}

function installTemplateResources(templateDir: string, targetDir: string): void {
  for (const resource of ["subagents", "skills", "connections"]) {
    const source = join(templateDir, resource);
    const target = join(targetDir, resource);
    if (!existsSync(source)) continue;
    // 整目录不存在 → 整拷；skills 已存在时合并缺失的 skill 包（不覆盖用户改过的）
    if (!existsSync(target)) {
      mkdirSync(targetDir, { recursive: true });
      cpSync(source, target, { recursive: true });
      continue;
    }
    if (resource === "skills") {
      try {
        for (const name of readdirSync(source)) {
          const srcSkill = join(source, name);
          const dstSkill = join(target, name);
          if (!existsSync(dstSkill)) {
            cpSync(srcSkill, dstSkill, { recursive: true });
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
}

export { DEFAULT_OPS_AGENT_NAME, DEFAULT_OPS_ROUND_LIMIT, OPS_TOOL_WHITELIST } from "./defaults.js";
import { DEFAULT_OPS_AGENT_NAME, DEFAULT_OPS_ROUND_LIMIT, OPS_TOOL_WHITELIST } from "./defaults.js";

export interface OpsAgentOptions {
  name?: string;
  maouRoot?: string;
  opsRoot?: string;
  roundLimit?: number;
  toolWhitelist?: readonly string[];
  forceMaterialize?: boolean;
  enableCompression?: boolean;
  summarizer?: Summarizer;
  log?: (level: string, message: string) => void;
  enablePostLogger?: boolean;
  configStore: ConfigStore;
  sessionStore: SessionStore;
  toolRegistry: ToolRegistry;
  llmClient: LLMClient;
}

export type OpsAgent = AgentHandle;

export function createOpsAgent(opts: OpsAgentOptions): OpsAgent {
  const name = opts.name ?? DEFAULT_OPS_AGENT_NAME;
  const maouRoot = opts.maouRoot ?? resolveUserMaouRoot();
  const opsRoot = opts.opsRoot ?? resolveUserOpsRoot(maouRoot);
  const toolWhitelist = opts.toolWhitelist ?? OPS_TOOL_WHITELIST;

  // 首次启动也要有固定数据根；spawn TUI 时 cwd 不存在会报 ENOENT（误以为二进制缺失）。
  mkdirSync(opsRoot, { recursive: true });
  mkdirSync(resolveUserOpsSessionsDir(maouRoot), { recursive: true });

  const templateDir = resolveOpsTemplateDir();
  const targetDir = join(maouRoot, "agents", name);
  createAgentFromTemplate(name, maouRoot, {
    templateDir,
    targetDir,
    displayName: "Ops Agent",
    role: "ops",
    tools: toolWhitelist,
    roundLimit: opts.roundLimit ?? DEFAULT_OPS_ROUND_LIMIT,
    force: opts.forceMaterialize,
    noCustomConfig: true,
  });
  installTemplateResources(templateDir, targetDir);

  const runtimeContainer: { ref: Runtime | null } = { ref: null };
  const runtime = new Runtime({
    configStore: opts.configStore,
    sessionStore: opts.sessionStore,
    toolRegistry: opts.toolRegistry,
    llmClient: opts.llmClient,
    maouRoot,
    projectRoot: opsRoot,
    agentName: name,
    agentScope: "global",
    // Ops 的 ContextEngine/任务状态也固定在 <MAOU_HOME>/ops，避免混入全局 coding 会话。
    harnessStore: new HarnessSessionStore({ maouRoot: opsRoot }),
    taskStore: new TaskSessionStore(opsRoot, name),
    enableCompression: opts.enableCompression,
    summarizer: opts.summarizer,
    fileDiffWatch: false,
    log: opts.log ?? ((level, message) => {
      console[level === "error" ? "error" : "log"](`[OpsRuntime] ${message}`);
    }),
    enablePostLogger: opts.enablePostLogger ?? true,
    callMainAgent: createCallMainAgent({
      getRuntime: () => runtimeContainer.ref,
      getDefaultPreset: () => getDefaultPresetFromConfigStore(opts.configStore),
      sandboxMode: "yolo",
    }),
  });
  runtimeContainer.ref = runtime;

  // 机器管家：reader/glob/grep/write 等路径可访问全机（相对路径仍落在 opsRoot）。
  // 安全靠 use_terminal 审批 / DCG / 写操作确认，不硬锁在 ~/.maou/ops。
  runtime.setDefaultPathGuard(machineOpenPathGuard({ projectRoot: opsRoot }));

  return {
    runtime,
    agentName: name,
    projectRoot: opsRoot,
    toolWhitelist,
    startSession: (title?: string) => runtime.startSession(name, title),
  };
}

export { runAgentCli } from "@little-house-studio/agent";
export type { AgentHandle, AgentCliOptions } from "@little-house-studio/agent";
