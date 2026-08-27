/**
 * 主动智能 client API
 */

import type {
  ProactiveBoard,
  ProactiveChatLine,
  ProactiveJobState,
  ProactiveSettings,
} from "./proactive-model";

export type ProactiveSnapshot = {
  ok: boolean;
  board: ProactiveBoard;
  settings: ProactiveSettings;
  job: ProactiveJobState;
  chat: ProactiveChatLine[];
  projectRoot: string;
};

async function readJson<T>(r: Response): Promise<T> {
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
        ? "API 返回了 HTML（请先启动后端）"
        : `API ${r.status}：后端未就绪`,
    );
  }
  let j: T & { ok?: boolean; error?: string };
  try {
    j = JSON.parse(text) as T & { ok?: boolean; error?: string };
  } catch {
    throw new Error(`API 非 JSON（${r.status}）`);
  }
  if (!r.ok || j.ok === false) {
    throw new Error(j.error || `http ${r.status}`);
  }
  return j;
}

export async function fetchProactive(): Promise<ProactiveSnapshot> {
  const r = await fetch("/api/proactive");
  return readJson<ProactiveSnapshot>(r);
}

export async function putProactiveSettings(
  patch: Partial<ProactiveSettings>,
): Promise<ProactiveSnapshot> {
  const r = await fetch("/api/proactive/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return readJson<ProactiveSnapshot>(r);
}

export async function patchProactiveItem(
  id: string,
  body: { queue?: boolean; done?: boolean },
): Promise<{ board: ProactiveBoard }> {
  const r = await fetch(`/api/proactive/items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson<{ ok: boolean; board: ProactiveBoard }>(r);
}

export async function startProactiveScan(opts?: {
  autoDispatch?: boolean;
}): Promise<ProactiveSnapshot> {
  const r = await fetch("/api/proactive/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoDispatch: Boolean(opts?.autoDispatch) }),
  });
  return readJson<ProactiveSnapshot>(r);
}

export async function startProactiveDispatch(opts: {
  itemIds?: string[];
  queuedOnly?: boolean;
  auto?: boolean;
}): Promise<ProactiveSnapshot> {
  const r = await fetch("/api/proactive/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  return readJson<ProactiveSnapshot>(r);
}

export async function abortProactive(): Promise<ProactiveSnapshot> {
  const r = await fetch("/api/proactive/abort", { method: "POST" });
  return readJson<ProactiveSnapshot>(r);
}

export async function* streamProactiveChat(
  message: string,
): AsyncGenerator<Record<string, unknown>> {
  const r = await fetch("/api/proactive/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!r.ok || !r.body) {
    throw new Error(`chat ${r.status}`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        yield JSON.parse(t) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
    }
  }
  if (buf.trim()) {
    try {
      yield JSON.parse(buf.trim()) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
}
