/** 渲染进程 API —— 对齐 DESIGN + CLI 工作流（会话/模型/审批/命令） */

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
  parentSessionId?: string;
};

export type ChatImage = { mimeType: string; data: string };

export type ChatHistoryLine = {
  id: string;
  role: string;
  content: string;
  ts?: string;
  /** 来自 session meta.tool_name（Agent 落盘） */
  toolName?: string;
  toolOk?: boolean;
  toolCallId?: string;
  /** tool_call 参数 description */
  toolDescription?: string;
  durationMs?: number;
  /** 助手消息上的 tool_calls，用来回填工具行意图 */
  toolCalls?: Array<{ id: string; description: string }>;
  images?: ChatImage[];
  usageInput?: number;
  usageOutput?: number;
};

export type CommandCatalogItem = {
  name: string;
  description: string;
  usage?: string;
  source?: "runtime" | "skill" | "local";
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
  kind?: "agent" | "human";
};

export type TerminalCapabilities = {
  humanShell: boolean;
  kind: "full" | "mini";
  degraded: boolean;
  reason?: string;
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
        ? "API 返回了 HTML（请用桌面客户端：pnpm --filter @little-house-studio/app dev）"
        : `API ${r.status}：host 未就绪（请用桌面客户端）`,
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
        ? "（请用桌面客户端）"
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
  /** 当前焦点 Agent 下正在生成的会话 */
  runningSessionIds: string[];
  allRunning?: Array<{
    sessionId: string;
    switchId: string;
    agentName: string;
  }>;
  agentsWithRunningTerminals?: string[];
}> {
  const r = await fetch("/api/sessions");
  const j = await jsonOrThrow<{
    ok: boolean;
    sessions?: SessionSummary[];
    activeSessionId?: string | null;
    runningSessionIds?: string[];
    allRunning?: Array<{
      sessionId: string;
      switchId: string;
      agentName: string;
    }>;
    agentsWithRunningTerminals?: string[];
  }>(r);
  return {
    sessions: j.sessions ?? [],
    activeSessionId: j.activeSessionId ?? null,
    runningSessionIds: j.runningSessionIds ?? [],
    allRunning: j.allRunning ?? [],
    agentsWithRunningTerminals: j.agentsWithRunningTerminals ?? [],
  };
}

/** 跨 Agent 运行态（chat run + 终端） */
export async function fetchRuntimeRunning(): Promise<{
  allRunning: Array<{
    sessionId: string;
    switchId: string;
    agentName: string;
  }>;
  busySwitchIds: string[];
  agentsWithRunningTerminals: string[];
}> {
  const r = await fetch("/api/runtime/running");
  const j = await jsonOrThrow<{
    ok?: boolean;
    allRunning?: Array<{
      sessionId: string;
      switchId: string;
      agentName: string;
    }>;
    busySwitchIds?: string[];
    agentsWithRunningTerminals?: string[];
  }>(r);
  return {
    allRunning: j.allRunning ?? [],
    busySwitchIds: j.busySwitchIds ?? [],
    agentsWithRunningTerminals: j.agentsWithRunningTerminals ?? [],
  };
}

export async function createSession(
  title?: string,
  opts?: { parentSessionId?: string; fork?: boolean },
): Promise<{
  sessionId: string;
  messages: ChatHistoryLine[];
  meta: Meta;
}> {
  const r = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      parentSessionId: opts?.parentSessionId,
      fork: opts?.fork,
    }),
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

/** Global LLM preset DTO (keys masked) — LLM 层单模型配置 */
export type LlmConfigPresetDto = {
  name: string;
  vendor: string;
  protocol: string;
  url: string;
  urlParams: string;
  model: string;
  maxContext: number;
  maxTokens: number;
  supportsImage: boolean;
  supportsAudio: boolean;
  supportsVideo: boolean;
  supportsReasoning: boolean;
  nativeToolCalling: boolean;
  inputPricePerMt: string;
  outputPricePerMt: string;
  cacheHitPricePerMt: string;
  maxConcurrent: string;
  temperature: string;
  topP: string;
  presencePenalty: string;
  frequencyPenalty: string;
  customRequestJson: string;
  keyMasked: string;
  hasKey: boolean;
};

export type LlmConfigRoles = {
  main?: string;
  fast?: string;
  vision?: string;
  helper?: string;
};

export type LlmConfigSnapshot = {
  configPath: string;
  defaultPreset: number;
  presets: LlmConfigPresetDto[];
  roles: LlmConfigRoles;
  vendors: Array<{
    id: string;
    label: string;
    protocol: string;
    defaultUrl: string;
  }>;
  roleDefs: Array<{ id: string; label: string; hint: string }>;
};

export type LlmConfigPresetWrite = {
  name: string;
  vendor?: string;
  protocol?: string;
  url: string;
  urlParams?: string;
  model: string;
  key?: string;
  maxContext?: number;
  maxTokens?: number;
  supportsImage?: boolean;
  supportsAudio?: boolean;
  supportsVideo?: boolean;
  supportsReasoning?: boolean;
  nativeToolCalling?: boolean;
  inputPricePerMt?: string;
  outputPricePerMt?: string;
  cacheHitPricePerMt?: string;
  maxConcurrent?: string;
  temperature?: string;
  topP?: string;
  presencePenalty?: string;
  frequencyPenalty?: string;
  customRequestJson?: string;
};

/** Load global LLM + Agent roles from config path (masked keys). */
export async function fetchLlmConfig(): Promise<LlmConfigSnapshot> {
  const r = await fetch("/api/config/llm");
  return jsonOrThrow<LlmConfigSnapshot & { ok: boolean }>(r);
}

export type LlmClipboardParseResult = {
  fields: Partial<
    Record<
      "api_key" | "base_url" | "protocol" | "model",
      { value: string; confidence: number; source: string; candidates?: string[] }
    >
  >;
  needsConfirm: string[];
};

/** 粘贴识别。只填表，不写 config.json。 */
export async function parseLlmClipboard(text: string): Promise<LlmClipboardParseResult> {
  const r = await fetch("/api/config/llm/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return jsonOrThrow<LlmClipboardParseResult & { ok: boolean }>(r);
}

/** Persist presets + roles via saveGlobalApiConfig. */
export async function saveLlmConfig(body: {
  presets: LlmConfigPresetWrite[];
  defaultPreset?: number;
  roles?: LlmConfigRoles;
  replace?: boolean;
}): Promise<LlmConfigSnapshot> {
  const r = await fetch("/api/config/llm", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow<LlmConfigSnapshot & { ok: boolean }>(r);
}

/** 真实 chat 探测 LLM preset（含延迟） */
export type LlmConnectionTestResult = {
  ok: boolean;
  model: string;
  latencyMs: number;
  firstByteMs?: number;
  httpStatus?: number | null;
  protocol?: string;
  replyPreview?: string;
  error?: string;
};

export async function testLlmConnection(body: {
  name?: string;
  url?: string;
  model?: string;
  key?: string;
  protocol?: string;
  vendor?: string;
  urlParams?: string;
  maxTokens?: number;
  maxContext?: number;
  timeoutMs?: number;
  probeMessage?: string;
}): Promise<LlmConnectionTestResult> {
  const r = await fetch("/api/config/llm/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await jsonOrThrow<{
    ok?: boolean;
    error?: string;
    result?: LlmConnectionTestResult;
  }>(r);
  if (j.result) return j.result;
  if (j.ok === false || !r.ok) {
    return {
      ok: false,
      model: body.model || "",
      latencyMs: 0,
      error: j.error || `test ${r.status}`,
    };
  }
  return {
    ok: false,
    model: body.model || "",
    latencyMs: 0,
    error: "empty test result",
  };
}

/** 模型 SVG 降智探针：画廊条目 */
export type SvgProbeGalleryItem = {
  id: string;
  createdAt: string;
  model: string;
  presetName: string;
  subject: string;
  latencyMs: number;
  ok: boolean;
  extracted: boolean;
  error?: string;
  imageDataUrl?: string;
  isReference?: boolean;
};

export type ModelSvgProbeRunResult = {
  ok: boolean;
  error?: string;
  result?: {
    ok: boolean;
    model: string;
    subject: string;
    latencyMs: number;
    extracted: boolean;
    imageDataUrl?: string;
    error?: string;
    rawReply?: string;
  };
  shot?: SvgProbeGalleryItem;
  reference?: SvgProbeGalleryItem | null;
  defaultSubject?: string;
};

/**
 * 无上下文 SVG 生成 → 解析图片 → 写入画廊。
 * 注意：HTTP 200 + body.ok=false 是「请求通了但模型没画出 SVG」的正常业务结果，
 * 不能用 jsonOrThrow（会误报成无意义的 "http 200"）。
 */
export async function runLlmSvgProbe(body: {
  name?: string;
  url?: string;
  model?: string;
  key?: string;
  protocol?: string;
  vendor?: string;
  urlParams?: string;
  maxTokens?: number;
  subject?: string;
  timeoutMs?: number;
}): Promise<ModelSvgProbeRunResult> {
  const r = await fetch("/api/config/llm/svg-probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await readJsonBody<
    ModelSvgProbeRunResult & { ok?: boolean; error?: string }
  >(r);
  // 传输层失败
  if (!r.ok && !j.result) {
    return {
      ok: false,
      error: j.error || `画图探针请求失败（HTTP ${r.status}）`,
    };
  }
  // 业务结果：即便 ok=false（未抽出 SVG）也原样返回，由 UI 解释
  // 绝不要 throw "http 200"
  const extracted = Boolean(j.result?.ok && j.result?.extracted);
  const errText =
    j.error ||
    j.result?.error ||
    (extracted ? undefined : "模型未返回可解析的 SVG");
  return {
    ok: extracted,
    error: errText,
    result: j.result,
    shot: j.shot,
    reference: j.reference,
    defaultSubject: j.defaultSubject,
  };
}

export async function fetchSvgProbeGallery(q?: {
  model?: string;
  presetName?: string;
  limit?: number;
}): Promise<{
  items: SvgProbeGalleryItem[];
  reference: SvgProbeGalleryItem | null;
  defaultSubject?: string;
}> {
  const sp = new URLSearchParams();
  if (q?.model) sp.set("model", q.model);
  if (q?.presetName) sp.set("presetName", q.presetName);
  if (q?.limit) sp.set("limit", String(q.limit));
  const r = await fetch(`/api/config/llm/svg-probe/gallery?${sp.toString()}`);
  const j = await jsonOrThrow<{
    ok?: boolean;
    items?: SvgProbeGalleryItem[];
    reference?: SvgProbeGalleryItem | null;
    defaultSubject?: string;
    error?: string;
  }>(r);
  return {
    items: j.items ?? [],
    reference: j.reference ?? null,
    defaultSubject: j.defaultSubject,
  };
}

export async function setSvgProbeReference(
  shotId: string,
): Promise<SvgProbeGalleryItem> {
  const r = await fetch("/api/config/llm/svg-probe/reference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shotId }),
  });
  const j = await jsonOrThrow<{
    ok?: boolean;
    reference?: SvgProbeGalleryItem;
    error?: string;
  }>(r);
  if (!j.reference) throw new Error(j.error || "set reference failed");
  return j.reference;
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
    lastInputTokens?: number;
    lastOutputTokens?: number;
    contextUsed?: number;
    file?: string;
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
      lastInputTokens?: number;
      lastOutputTokens?: number;
      contextUsed?: number;
      file?: string;
    } | null;
    text?: string;
  }>(r);
  return {
    sessionId: j.sessionId ?? null,
    stats: j.stats ?? null,
    text: j.text ?? "",
  };
}

/** 中断指定会话 run；不传则中断当前焦点会话 */
export async function abortChat(sessionId?: string | null): Promise<void> {
  await fetch("/api/chat/abort", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sessionId ? { sessionId } : {}),
  });
}

/** UI 发送模式：队列（等本轮结束）/ 插入（打断当前流） */
export type ChatSendMode = "queue" | "insert";

export type QueuedChatItem = {
  id: number;
  message: string;
  mode: string;
  enqueuedAt: number;
  source: string;
};

/** 运行中入队到 Agent MessageQueue（不新建 HTTP 流） */
export async function enqueueChat(
  message: string,
  mode: ChatSendMode = "queue",
): Promise<{
  ok: true;
  id: number;
  mode: ChatSendMode;
  queueMode: string;
  shouldAbort: boolean;
  shouldStopRun: boolean;
  queue: QueuedChatItem[];
}> {
  const r = await fetch("/api/chat/enqueue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, mode }),
  });
  const j = await jsonOrThrow<{
    ok?: boolean;
    error?: string;
    id?: number;
    mode?: ChatSendMode;
    queueMode?: string;
    shouldAbort?: boolean;
    shouldStopRun?: boolean;
    queue?: QueuedChatItem[];
  }>(r);
  if (!r.ok || j.ok === false) {
    throw new Error(j.error || `enqueue ${r.status}`);
  }
  return {
    ok: true,
    id: Number(j.id),
    mode: j.mode === "insert" ? "insert" : "queue",
    queueMode: String(j.queueMode ?? ""),
    shouldAbort: Boolean(j.shouldAbort),
    shouldStopRun: Boolean(j.shouldStopRun),
    queue: j.queue ?? [],
  };
}

export async function fetchChatQueue(): Promise<{
  busy: boolean;
  queue: QueuedChatItem[];
}> {
  const r = await fetch("/api/chat/queue");
  const j = await jsonOrThrow<{
    ok?: boolean;
    busy?: boolean;
    queue?: QueuedChatItem[];
  }>(r);
  return { busy: Boolean(j.busy), queue: j.queue ?? [] };
}

export async function clearChatQueue(): Promise<number> {
  const r = await fetch("/api/chat/queue", { method: "DELETE" });
  const j = await jsonOrThrow<{ cleared?: number }>(r);
  return Number(j.cleared ?? 0);
}

export async function removeChatQueueItem(id: number): Promise<boolean> {
  const r = await fetch(`/api/chat/queue/${encodeURIComponent(String(id))}`, {
    method: "DELETE",
  });
  const j = await jsonOrThrow<{ removed?: boolean }>(r);
  return Boolean(j.removed);
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

export async function fetchTerminalCapabilities(): Promise<TerminalCapabilities> {
  const r = await fetch("/api/terminals/capabilities");
  const j = await readJsonBody<TerminalCapabilities & { ok?: boolean }>(r);
  if (!r.ok) {
    return {
      humanShell: false,
      kind: "mini",
      degraded: true,
      reason: `capabilities ${r.status}`,
    };
  }
  return {
    humanShell: Boolean(j.humanShell),
    kind: j.kind === "full" ? "full" : "mini",
    degraded: Boolean(j.degraded),
    reason: j.reason,
  };
}

export async function stopTerminal(id: string, agent: string): Promise<void> {
  await fetch(`/api/terminals/${encodeURIComponent(id)}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent }),
  });
}

export async function fetchCommandCatalog(): Promise<CommandCatalogItem[]> {
  const r = await fetch("/api/commands");
  const j = await readJsonBody<{ ok?: boolean; commands?: CommandCatalogItem[] }>(
    r,
  );
  if (!r.ok) return [];
  return Array.isArray(j.commands) ? j.commands : [];
}

export async function* streamChat(
  message: string,
  signal?: AbortSignal,
  images?: ChatImage[],
): AsyncGenerator<StreamEvent> {
  const r = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      ...(images?.length ? { images } : {}),
    }),
    signal,
  });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => "");
    const trimmed = t.trimStart();
    if (trimmed.startsWith("<!") || trimmed.startsWith("<html")) {
      throw new Error(
        `chat ${r.status || ""}：host 未就绪（请用桌面客户端）`.trim(),
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

/** 人开壳 */
export function humanTerminalWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/terminal`;
}
