/** 浏览器侧 API —— 对齐 DESIGN + CLI 工作流（会话/模型/审批/命令） */

export type StreamEvent = {
  type: string;
  [k: string]: unknown;
};

export type ApprovalMode = "normal" | "auto" | "yolo";

export interface Meta {
  sessionId: string | null;
  provider: string;
  model: string;
  projectRoot: string;
  sandboxMode: string;
  approvalMode?: ApprovalMode;
  agentName?: string;
  providers?: { id: string; name?: string }[];
  models?: { id: string; name?: string }[];
  /** getMeta 可选附带（启动恢复） */
  messages?: ChatHistoryLine[];
}

export type SessionSummary = {
  id: string;
  title: string;
  updatedAt?: string;
  messageCount: number;
  lastMsgAt?: string;
};

export type ChatHistoryLine = {
  id: string;
  role: string;
  content: string;
  ts?: string;
};

export type PendingApproval = {
  id: string;
  command: string;
  agentName: string;
  cwd?: string;
  risk?: "low" | "high";
  summary?: string;
  label?: string;
  reason?: string;
  createdAt: number;
};

export type TerminalInfo = {
  id: string;
  agentName: string;
  command: string;
  description: string;
  state: string;
  exitCode: number | null;
  cwd: string;
  createdAt: string;
  updatedAt: string;
};

/** Parse JSON body; surface a clear error when Vite returns HTML (backend down). */
async function readJsonBody<T>(r: Response): Promise<T> {
  const text = await r.text();
  const trimmed = text.trimStart();
  if (
    !trimmed ||
    trimmed.startsWith("<!") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<HTML")
  ) {
    throw new Error(
      r.ok
        ? "API 返回了 HTML（请先启动后端: pnpm run dev:server 或 maou-web :8787）"
        : `API ${r.status}：后端未就绪（开发模式需 8787 代理）`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `API 响应不是 JSON（${r.status}）：${text.slice(0, 80).replace(/\s+/g, " ")}`,
    );
  }
}

async function jsonOrThrow<T>(r: Response): Promise<T> {
  const j = await readJsonBody<T & { ok?: boolean; error?: string }>(r);
  if (!r.ok || (j as { ok?: boolean }).ok === false) {
    throw new Error(
      (j as { error?: string }).error || `http ${r.status}`,
    );
  }
  return j;
}

export async function fetchMeta(): Promise<Meta> {
  const r = await fetch("/api/meta");
  if (!r.ok) {
    const hint =
      r.status === 404 || r.status === 502 || r.status === 504
        ? "（请先启动后端 :8787）"
        : "";
    throw new Error(`meta ${r.status}${hint}`);
  }
  return readJsonBody<Meta>(r);
}

export async function setModel(
  provider: string,
  model: string,
): Promise<Meta> {
  const r = await fetch("/api/model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, model }),
  });
  return jsonOrThrow<Meta & { ok: boolean }>(r);
}

export async function fetchModels(provider?: string): Promise<{
  providers: { id: string; name?: string }[];
  models: { id: string; name?: string }[];
  meta: Meta;
}> {
  const q = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  const r = await fetch(`/api/models${q}`);
  const j = await jsonOrThrow<{
    ok: boolean;
    providers?: { id: string; name?: string }[];
    models?: { id: string; name?: string }[];
  } & Meta>(r);
  return {
    providers: j.providers ?? [],
    models: j.models ?? [],
    meta: j,
  };
}

export async function fetchSessions(): Promise<{
  sessions: SessionSummary[];
  activeSessionId: string | null;
}> {
  const r = await fetch("/api/sessions");
  const j = await jsonOrThrow<{
    ok: boolean;
    sessions?: SessionSummary[];
    activeSessionId?: string | null;
  }>(r);
  return {
    sessions: j.sessions ?? [],
    activeSessionId: j.activeSessionId ?? null,
  };
}

export async function createSession(title?: string): Promise<{
  sessionId: string;
  messages: ChatHistoryLine[];
  meta: Meta;
}> {
  const r = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const j = await jsonOrThrow<
    { ok: boolean; sessionId: string; messages?: ChatHistoryLine[] } & Meta
  >(r);
  return {
    sessionId: j.sessionId,
    messages: j.messages ?? [],
    meta: j,
  };
}

export async function switchSession(id: string): Promise<{
  sessionId: string;
  messages: ChatHistoryLine[];
  meta: Meta;
}> {
  const r = await fetch("/api/sessions/switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const j = await jsonOrThrow<
    { ok: boolean; sessionId: string; messages?: ChatHistoryLine[] } & Meta
  >(r);
  return {
    sessionId: j.sessionId,
    messages: j.messages ?? [],
    meta: j,
  };
}

export async function clearSession(id?: string): Promise<{
  sessionId: string;
  messages: ChatHistoryLine[];
  meta: Meta;
}> {
  const r = await fetch("/api/sessions/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const j = await jsonOrThrow<
    { ok: boolean; sessionId: string; messages?: ChatHistoryLine[] } & Meta
  >(r);
  return {
    sessionId: j.sessionId,
    messages: j.messages ?? [],
    meta: j,
  };
}

export async function deleteSession(id: string): Promise<{
  sessionId: string | null;
  messages: ChatHistoryLine[];
  meta: Meta;
  sessions: SessionSummary[];
}> {
  const r = await fetch("/api/sessions/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const j = await jsonOrThrow<
    {
      ok: boolean;
      sessionId?: string | null;
      messages?: ChatHistoryLine[];
      sessions?: SessionSummary[];
    } & Meta
  >(r);
  return {
    sessionId: j.sessionId ?? null,
    messages: j.messages ?? [],
    meta: j,
    sessions: j.sessions ?? [],
  };
}

export async function renameSession(
  id: string,
  title: string,
): Promise<{ sessions: SessionSummary[]; title: string }> {
  const r = await fetch("/api/sessions/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, title }),
  });
  const j = await jsonOrThrow<{
    ok: boolean;
    title?: string;
    sessions?: SessionSummary[];
  }>(r);
  return {
    title: j.title ?? title,
    sessions: j.sessions ?? [],
  };
}

export async function exportTranscript(): Promise<string> {
  const r = await fetch("/api/sessions/active/export");
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(t || `export ${r.status}`);
  }
  return r.text();
}

export async function fetchApproval(): Promise<{
  mode: ApprovalMode;
  pending: PendingApproval[];
}> {
  const r = await fetch("/api/approval");
  const j = await jsonOrThrow<{
    ok: boolean;
    mode?: ApprovalMode;
    pending?: PendingApproval[];
  }>(r);
  return {
    mode: (j.mode as ApprovalMode) || "yolo",
    pending: j.pending ?? [],
  };
}

export async function setApprovalMode(mode: ApprovalMode): Promise<Meta> {
  const r = await fetch("/api/approval", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  return jsonOrThrow<Meta & { ok: boolean }>(r);
}

export async function answerApproval(
  id: string,
  choice: "once" | "always" | "deny" | "blacklist",
): Promise<PendingApproval[]> {
  const r = await fetch(`/api/approvals/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ choice }),
  });
  const j = await jsonOrThrow<{ ok: boolean; pending?: PendingApproval[] }>(r);
  return j.pending ?? [];
}

export async function runCommand(
  id: string,
  args?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const r = await fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, args }),
  });
  return jsonOrThrow(r);
}

export async function fetchSessionStats(): Promise<{
  sessionId: string | null;
  stats: {
    messageCount: number;
    userTurns: number;
    assistantTurns: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    cacheRead: number;
  } | null;
  text: string;
}> {
  const r = await fetch("/api/sessions/active/stats");
  const j = await jsonOrThrow<{
    ok: boolean;
    sessionId?: string | null;
    stats?: {
      messageCount: number;
      userTurns: number;
      assistantTurns: number;
      toolCalls: number;
      inputTokens: number;
      outputTokens: number;
      cacheRead: number;
    } | null;
    text?: string;
  }>(r);
  return {
    sessionId: j.sessionId ?? null,
    stats: j.stats ?? null,
    text: j.text ?? "",
  };
}

export async function abortChat(): Promise<void> {
  await fetch("/api/chat/abort", { method: "POST" });
}

/** Live agent row from GET /api/agents (CLI ops list + presence). */
export type LiveAgentInfo = {
  id: string;
  name: string;
  displayName: string;
  role: string;
  status:
    | "idle"
    | "running"
    | "done_unread"
    | "done_read"
    | "blocked"
    | "needs_reply";
  group: "system" | "project";
  parent?: string;
  projectPath?: string;
  projectName?: string;
  overview?: string;
  stale?: boolean;
  /** CLI switch_id when present */
  switchId?: string;
};

export async function fetchAgents(): Promise<{
  agents: LiveAgentInfo[];
  activeAgentName: string | null;
  activeSwitchId: string | null;
  activeProjectPath: string | null;
}> {
  const r = await fetch("/api/agents");
  const j = await jsonOrThrow<{
    ok: boolean;
    agents?: LiveAgentInfo[];
    activeAgentName?: string | null;
    activeSwitchId?: string | null;
    activeProjectPath?: string | null;
  }>(r);
  return {
    agents: j.agents ?? [],
    activeAgentName: j.activeAgentName ?? null,
    activeSwitchId: j.activeSwitchId ?? null,
    activeProjectPath: j.activeProjectPath ?? null,
  };
}

/** Activate by CLI switch_id (project:<path>:<name>) or bare name. */
export async function setActiveAgent(switchIdOrName: string): Promise<{
  activeAgentName: string;
  activeSwitchId: string;
  activeProjectPath: string | null;
  meta: Meta;
  agents: LiveAgentInfo[];
}> {
  const r = await fetch("/api/agents/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ switchId: switchIdOrName, name: switchIdOrName }),
  });
  const j = await jsonOrThrow<{
    ok: boolean;
    activeAgentName?: string;
    activeSwitchId?: string;
    activeProjectPath?: string | null;
    agents?: LiveAgentInfo[];
  } & Meta>(r);
  return {
    activeAgentName: j.activeAgentName ?? switchIdOrName,
    activeSwitchId: j.activeSwitchId ?? switchIdOrName,
    activeProjectPath: j.activeProjectPath ?? null,
    meta: j,
    agents: j.agents ?? [],
  };
}

export async function fetchTerminals(
  agent?: string,
  opts?: { all?: boolean },
): Promise<TerminalInfo[]> {
  const params = new URLSearchParams();
  if (opts?.all) params.set("all", "1");
  else if (agent) params.set("agent", agent);
  const q = params.toString() ? `?${params}` : "";
  const r = await fetch(`/api/terminals${q}`);
  const j = await readJsonBody<{ terminals?: TerminalInfo[]; ok?: boolean }>(r);
  if (!r.ok) throw new Error(`terminals ${r.status}`);
  return j.terminals ?? [];
}

export async function stopTerminal(id: string, agent: string): Promise<void> {
  await fetch(`/api/terminals/${encodeURIComponent(id)}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent }),
  });
}

export async function* streamChat(
  message: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const r = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal,
  });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => "");
    const trimmed = t.trimStart();
    if (trimmed.startsWith("<!") || trimmed.startsWith("<html")) {
      throw new Error(
        `chat ${r.status || ""}：后端未就绪（请启动 maou-web / dev:server :8787）`.trim(),
      );
    }
    throw new Error(t.slice(0, 200) || `chat ${r.status}`);
  }
  const reader = r.body.getReader();
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort);
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          yield JSON.parse(line) as StreamEvent;
        } catch {
          /* skip */
        }
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    void reader.cancel().catch(() => {});
  }
}

/** 附着到 agent 终端会话 */
export function agentTerminalWsUrl(id: string, agent: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const q = new URLSearchParams({ id, agent });
  return `${proto}://${location.host}/ws/agent-terminal?${q}`;
}
