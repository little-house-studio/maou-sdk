/**
 * @little-house-studio/install-agent — 安装员工厂。
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
  resolveUserInstallRoot,
  resolveUserInstallSessionsDir,
} from "@little-house-studio/types";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  DEFAULT_INSTALL_AGENT_NAME,
  DEFAULT_INSTALL_ROUND_LIMIT,
  INSTALL_TOOL_WHITELIST,
} from "./defaults.js";

function resolveInstallTemplateDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "templates", "install");
}

export interface InstallAgentOptions {
  name?: string;
  maouRoot?: string;
  /** 用户选定的安装目录；相对路径落点。未定时用数据根。 */
  projectRoot?: string;
  dataRoot?: string;
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

export type InstallAgent = AgentHandle;

export function createInstallAgent(opts: InstallAgentOptions): InstallAgent {
  const name = opts.name ?? DEFAULT_INSTALL_AGENT_NAME;
  const maouRoot = opts.maouRoot ?? resolveUserMaouRoot();
  const dataRoot = opts.dataRoot ?? resolveUserInstallRoot(maouRoot);
  const destRoot = opts.projectRoot ?? dataRoot;
  const toolWhitelist = opts.toolWhitelist ?? INSTALL_TOOL_WHITELIST;

  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(destRoot, { recursive: true });
  mkdirSync(resolveUserInstallSessionsDir(maouRoot), { recursive: true });

  const templateDir = resolveInstallTemplateDir();
  const targetDir = join(maouRoot, "agents", name);
  createAgentFromTemplate(name, maouRoot, {
    templateDir,
    targetDir,
    displayName: "Install Agent",
    role: "install",
    tools: toolWhitelist,
    roundLimit: opts.roundLimit ?? DEFAULT_INSTALL_ROUND_LIMIT,
    terminalMode: "auto",
    force: opts.forceMaterialize,
    noCustomConfig: true,
  });

  const runtimeContainer: { ref: Runtime | null } = { ref: null };
  const runtime = new Runtime({
    configStore: opts.configStore,
    sessionStore: opts.sessionStore,
    toolRegistry: opts.toolRegistry,
    llmClient: opts.llmClient,
    maouRoot,
    projectRoot: destRoot,
    agentName: name,
    agentScope: "global",
    harnessStore: new HarnessSessionStore({ maouRoot: dataRoot }),
    taskStore: new TaskSessionStore(dataRoot, name),
    enableCompression: opts.enableCompression,
    summarizer: opts.summarizer,
    fileDiffWatch: false,
    log: opts.log ?? ((level, message) => {
      console[level === "error" ? "error" : "log"](`[InstallRuntime] ${message}`);
    }),
    enablePostLogger: opts.enablePostLogger ?? true,
    callMainAgent: createCallMainAgent({
      getRuntime: () => runtimeContainer.ref,
      getDefaultPreset: () => getDefaultPresetFromConfigStore(opts.configStore),
      sandboxMode: "auto",
    }),
  });
  runtimeContainer.ref = runtime;
  runtime.setDefaultPathGuard(machineOpenPathGuard({ projectRoot: destRoot }));

  return {
    runtime,
    agentName: name,
    projectRoot: destRoot,
    toolWhitelist,
    startSession: (title?: string) => runtime.startSession(name, title),
  };
}
