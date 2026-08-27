/** 文档 Copilot 客户端 API */

import type { StreamEvent } from "../api";

export type CopilotChatBody = {
  message: string;
  filePath?: string | null;
  content?: string | null;
  annotations?: string | null;
};

export async function* streamCopilotChat(
  body: CopilotChatBody,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const r = await fetch("/api/copilot/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: body.message,
      filePath: body.filePath ?? undefined,
      content: body.content ?? undefined,
      annotations: body.annotations ?? undefined,
    }),
    signal,
  });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => "");
    throw new Error(t || `copilot chat ${r.status}`);
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

export async function abortCopilotChat(): Promise<void> {
  await fetch("/api/copilot/abort", { method: "POST" });
}

export async function newCopilotSession(): Promise<void> {
  await fetch("/api/copilot/session/new", { method: "POST" });
}

export async function fetchCopilotMeta(): Promise<{
  sessionId: string | null;
  provider: string;
  model: string;
  agentName: string;
  projectRoot: string;
}> {
  const r = await fetch("/api/copilot/meta");
  if (!r.ok) throw new Error(`copilot meta ${r.status}`);
  return r.json();
}
