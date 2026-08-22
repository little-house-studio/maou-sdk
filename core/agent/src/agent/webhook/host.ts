/**
 * Webhook 宿主口 —— 消息结构体落到 Agent 完整能力。
 * WebUI AgentHub 与无 UI 的 WebhookAgentHost 都实现它。
 */
import type {
  Message,
  ToolMessage,
  WebhookAgentMessage,
  WebhookSendMode,
} from "@little-house-studio/types";
import type { WebhookTarget } from "./target.js";

export type WebhookAgentInfo = {
  name: string;
  switchId: string;
  group?: string;
  status?: string;
  projectPath?: string;
};

export type WebhookSessionInfo = {
  id: string;
  title: string;
  updatedAt?: string;
  messageCount: number;
  lastMsgAt?: string;
  parentSessionId?: string;
};

export type WebhookChatLine = Message & {
  id?: string;
  toolName?: string;
  toolOk?: boolean;
  toolMessage?: ToolMessage;
};

export type WebhookStatusInfo = {
  agent: string;
  switchId: string;
  sessionId: string | null;
  busy: boolean;
  provider: string;
  model: string;
  approvalMode: string;
  projectRoot: string;
};

export type WebhookSendResult = {
  status: "started" | "queued";
  sessionId: string;
  switchId: string;
  agent: string;
  queueId?: number;
  /** wait=true 时的助手正文 */
  text?: string;
};

export type WebhookQueuedItem = {
  id: number;
  message: string;
  mode: string;
  enqueuedAt: number;
  source: string;
};

export interface WebhookHost {
  listAgents(): WebhookAgentInfo[];
  resolveAgent(raw?: string | null): WebhookTarget;
  status(agent?: string, session?: string): WebhookStatusInfo;
  send(opts: {
    agent?: string;
    session?: string;
    message: WebhookAgentMessage;
    mode?: WebhookSendMode;
    wait?: boolean;
    timeoutMs?: number;
  }): Promise<WebhookSendResult>;
  abort(opts: { agent?: string; session?: string }): {
    aborted: boolean;
    sessionId: string | null;
  };
  enqueue(opts: {
    agent?: string;
    session?: string;
    message: WebhookAgentMessage;
    mode?: "queue" | "insert";
  }): { queueId: number; sessionId: string; switchId: string; agent: string };
  listSessions(agent?: string): WebhookSessionInfo[];
  newSession(opts: { agent?: string; title?: string }): { sessionId: string };
  switchSession(opts: { agent?: string; session: string }): { sessionId: string };
  clearSession(opts: { agent?: string; session?: string }): { sessionId: string };
  deleteSession(opts: {
    agent?: string;
    session: string;
  }): { deleted: boolean; sessionId: string | null };
  renameSession(opts: {
    agent?: string;
    session: string;
    title: string;
  }): { sessionId: string; title: string };
  sessionMessages(opts: {
    agent?: string;
    session?: string;
  }): { sessionId: string; messages: WebhookChatLine[] };
  sessionStats(opts: {
    agent?: string;
    session?: string;
  }): { sessionId: string; stats: Record<string, unknown> };
  exportSession(opts: {
    agent?: string;
    session?: string;
  }): { sessionId: string; text: string };
  getModel(): { provider: string; model: string };
  setModel(provider: string, model: string): { provider: string; model: string };
  listProviders(): Array<{ id: string; name?: string }>;
  listModels(provider?: string): Array<{ id: string; name?: string }>;
  getApprovalMode(): string;
  setApprovalMode(mode: string): string;
  listApprovals(): Array<Record<string, unknown>>;
  answerApproval(id: string, choice: string): boolean;
  listQueue(opts: { agent?: string; session?: string }): WebhookQueuedItem[];
  clearQueue(opts: { agent?: string; session?: string }): number;
  removeQueue(opts: {
    agent?: string;
    session?: string;
    queueId: number;
  }): boolean;
}
