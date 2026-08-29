/**
 * 会话标题：draft → polished → user 钉住。不进模型历史。
 */

export type TitleSource = "draft" | "polished" | "user";

export function draftTitleFromText(content: string, max = 30): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function foldTitle(
  events: Array<{ type: string; data?: Record<string, unknown> }>,
): { title: string; source: TitleSource } | null {
  let latest: { title: string; source: TitleSource } | null = null;
  for (const ev of events) {
    if (ev.type !== "session/title") continue;
    const title = typeof ev.data?.title === "string" ? ev.data.title.trim() : "";
    const source = ev.data?.source;
    if (!title) continue;
    if (source === "draft" || source === "polished" || source === "user") {
      latest = { title: title.slice(0, 80), source };
    }
  }
  return latest;
}

export function titleIsPinned(
  events: Array<{ type: string; data?: Record<string, unknown> }>,
): boolean {
  return foldTitle(events)?.source === "user";
}

export async function polishSessionTitle(
  store: {
    setTitle: (id: string, title: string, source?: TitleSource) => boolean;
    readMeta: (id: string) => { title?: string; title_source?: TitleSource } | null;
  },
  sessionId: string,
  polish: (draft: string) => Promise<string>,
): Promise<boolean> {
  const meta = store.readMeta(sessionId);
  if (!meta || meta.title_source === "user") return false;
  const draft = (meta.title ?? "").trim();
  if (!draft) return false;
  const next = (await polish(draft)).replace(/\s+/g, " ").trim().slice(0, 80);
  if (!next) return false;
  return store.setTitle(sessionId, next, "polished");
}
