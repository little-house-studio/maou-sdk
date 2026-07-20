/** 浏览器侧 API */

export type StreamEvent = {
  type: string;
  [k: string]: unknown;
};

export interface Meta {
  sessionId: string | null;
  provider: string;
  model: string;
  projectRoot: string;
  sandboxMode: string;
  agentName?: string;
}

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

export async function fetchMeta(): Promise<Meta> {
  const r = await fetch("/api/meta");
  if (!r.ok) throw new Error(`meta ${r.status}`);
  return r.json() as Promise<Meta>;
}

export async function abortChat(): Promise<void> {
  await fetch("/api/chat/abort", { method: "POST" });
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
  if (!r.ok) throw new Error(`terminals ${r.status}`);
  const j = (await r.json()) as { terminals?: TerminalInfo[] };
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
    throw new Error(t || `chat ${r.status}`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
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
}

/** 附着到 agent 终端会话 */
export function agentTerminalWsUrl(id: string, agent: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const q = new URLSearchParams({ id, agent });
  return `${proto}://${location.host}/ws/agent-terminal?${q}`;
}

/** Markdown FS API 已迁至 `./markdown/api` —— 请从 markdown 模块导入 */
