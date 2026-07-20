/**
 * AgentHub —— Web 侧会话与流式 run（复用 coding-agent）。
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
  createStandardAgentDeps,
  getRolePresetFromMaouConfig,
  resolvePresetForCli,
  listProvidersForCli,
  listModelsForCli,
} from "@little-house-studio/agent";
import type { StreamEvent } from "@little-house-studio/types";
import { createCodingAgent } from "@little-house-studio/coding-agent";

export interface AgentHubOpts {
  projectRoot?: string;
  maouRoot?: string;
  /** 默认 yolo：本机 Web 工具，减少审批打断；可改 normal */
  sandboxMode?: string;
}

export class AgentHub {
  readonly projectRoot: string;
  readonly maouRoot: string;
  readonly sandboxMode: string;
  /** coding-agent 实例名（terminal-engine 按此过滤） */
  readonly agentName: string;
  private handle: ReturnType<typeof createCodingAgent> | null = null;
  private sessionId: string | null = null;
  private abort: AbortController | null = null;
  private provider = "";
  private model = "";

  constructor(opts: AgentHubOpts = {}) {
    this.projectRoot = opts.projectRoot ?? process.cwd();
    this.maouRoot = opts.maouRoot ?? join(homedir(), ".maou");
    this.sandboxMode = opts.sandboxMode ?? "yolo";
    this.agentName = "coding";
  }

  private ensureAgent() {
    if (this.handle) return this.handle;
    const deps = createStandardAgentDeps(this.projectRoot, this.maouRoot, {
      reviewerOnMissingPreset: "approve",
    });
    this.handle = createCodingAgent({
      projectRoot: this.projectRoot,
      maouRoot: this.maouRoot,
      configStore: deps.configStore,
      sessionStore: deps.sessionStore,
      toolRegistry: deps.toolRegistry,
      llmClient: deps.llmClient,
      log: () => {},
      enablePostLogger: false,
    });
    this.bootstrapPreset();
    return this.handle;
  }

  private bootstrapPreset() {
    try {
      const main = getRolePresetFromMaouConfig("main") as {
        name?: string;
        model?: string;
      } | undefined;
      if (main?.name && main?.model) {
        this.provider = main.name;
        this.model = main.model;
        return;
      }
    } catch {
      /* fall through */
    }
    const ps = listProvidersForCli();
    if (ps[0]) {
      this.provider = ps[0].id;
      const ms = listModelsForCli(ps[0].id);
      this.model = ms[0]?.id ?? "";
    }
  }

  getMeta() {
    return {
      sessionId: this.sessionId,
      provider: this.provider,
      model: this.model,
      projectRoot: this.projectRoot,
      sandboxMode: this.sandboxMode,
      agentName: this.agentName,
      providers: listProvidersForCli(),
    };
  }

  setModel(provider: string, model: string) {
    this.provider = provider;
    this.model = model;
  }

  abortRun() {
    this.abort?.abort();
    this.abort = null;
  }

  /**
   * 流式跑一轮用户消息；yield StreamEvent。
   */
  async *runChat(message: string): AsyncGenerator<StreamEvent> {
    const agent = this.ensureAgent();
    const text = message.trim();
    if (!text) return;

    this.abort?.abort();
    this.abort = new AbortController();

    if (!this.sessionId) {
      this.sessionId = agent.startSession();
    }
    const sessionId = this.sessionId;
    const preset = resolvePresetForCli(this.provider, this.model) as Record<
      string,
      unknown
    >;

    try {
      for await (const ev of agent.runtime.run({
        sessionId,
        userMessage: text,
        preset,
        stream: true,
        abortSignal: this.abort.signal,
        source: "webui",
        sandboxMode: this.sandboxMode,
      })) {
        yield ev;
        if (ev.type === "done" || ev.type === "error") break;
      }
    } finally {
      this.abort = null;
    }
  }
}
