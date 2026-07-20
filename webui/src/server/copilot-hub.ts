/**
 * 文档 Copilot AgentHub
 * - 独立 agent 实例：doc-copilot（项目级会话，与主 chat 分离）
 * - 注入当前文件 / 正文上下文，工具复用 coding 白名单
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

export interface CopilotHubOpts {
  projectRoot?: string;
  maouRoot?: string;
  sandboxMode?: string;
}

export type CopilotChatContext = {
  filePath?: string;
  /** 当前编辑器正文（可截断） */
  content?: string;
  /** 批注文本 */
  annotations?: string;
};

const COPILOT_AGENT_NAME = "doc-copilot";

const COPILOT_PREAMBLE = `你是 Maou 文档工作台的 **Copilot**（文档助手），不是主聊天 Agent。
职责：
- 阅读 / 编辑 / 覆写项目内 Markdown 与需求文档
- 按用户批注细化、对齐、补充验收标准
- 可用 use_terminal、读写文件、搜索代码与联网（若工具可用）
- 项目级会话：记住本项目上下文，不绑定单一文件
- 支持用户指令如 /goal（按目标推进文档）
回答简洁，改文档时优先用工具落盘，并说明改了哪些文件。`;

export class CopilotHub {
  readonly projectRoot: string;
  readonly maouRoot: string;
  readonly sandboxMode: string;
  readonly agentName = COPILOT_AGENT_NAME;

  private handle: ReturnType<typeof createCodingAgent> | null = null;
  private sessionId: string | null = null;
  private abort: AbortController | null = null;
  private provider = "";
  private model = "";

  constructor(opts: CopilotHubOpts = {}) {
    this.projectRoot = opts.projectRoot ?? process.cwd();
    this.maouRoot = opts.maouRoot ?? join(homedir(), ".maou");
    this.sandboxMode = opts.sandboxMode ?? "yolo";
  }

  private ensureAgent() {
    if (this.handle) return this.handle;
    const deps = createStandardAgentDeps(this.projectRoot, this.maouRoot, {
      reviewerOnMissingPreset: "approve",
    });
    this.handle = createCodingAgent({
      name: COPILOT_AGENT_NAME,
      projectRoot: this.projectRoot,
      maouRoot: this.maouRoot,
      configStore: deps.configStore,
      sessionStore: deps.sessionStore,
      toolRegistry: deps.toolRegistry,
      llmClient: deps.llmClient,
      log: () => {},
      enablePostLogger: false,
      // 文档场景轮次可稍少
      roundLimit: 40,
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
    if (!this.provider) {
      try {
        this.bootstrapPreset();
      } catch {
        /* ignore */
      }
    }
    return {
      sessionId: this.sessionId,
      provider: this.provider,
      model: this.model,
      projectRoot: this.projectRoot,
      sandboxMode: this.sandboxMode,
      agentName: this.agentName,
    };
  }

  setModel(provider: string, model: string) {
    this.provider = provider;
    this.model = model;
  }

  /** 新开会话（项目级重置） */
  newSession() {
    this.abortRun();
    this.sessionId = null;
  }

  abortRun() {
    this.abort?.abort();
    this.abort = null;
  }

  private buildUserMessage(message: string, ctx?: CopilotChatContext): string {
    const parts = [COPILOT_PREAMBLE, "", "---", ""];
    parts.push(`项目根目录: ${this.projectRoot}`);
    if (ctx?.filePath) {
      parts.push(`当前打开文件: ${ctx.filePath}`);
    }
    if (ctx?.annotations?.trim()) {
      parts.push("", "用户批注:", ctx.annotations.trim());
    }
    if (ctx?.content != null && ctx.content.length > 0) {
      const body =
        ctx.content.length > 14000
          ? ctx.content.slice(0, 14000) + "\n…(截断)"
          : ctx.content;
      parts.push("", "当前编辑器正文:", "```markdown", body, "```");
    }
    parts.push("", "---", "", "用户消息:", message.trim());
    return parts.join("\n");
  }

  async *runChat(
    message: string,
    ctx?: CopilotChatContext,
  ): AsyncGenerator<StreamEvent> {
    const agent = this.ensureAgent();
    const text = message.trim();
    if (!text) return;

    this.abort?.abort();
    this.abort = new AbortController();

    if (!this.sessionId) {
      this.sessionId = agent.startSession("doc-copilot");
    }
    const sessionId = this.sessionId;
    const preset = resolvePresetForCli(this.provider, this.model) as Record<
      string,
      unknown
    >;
    const userMessage = this.buildUserMessage(text, ctx);

    try {
      for await (const ev of agent.runtime.run({
        sessionId,
        userMessage,
        preset,
        stream: true,
        abortSignal: this.abort.signal,
        source: "webui-copilot",
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
