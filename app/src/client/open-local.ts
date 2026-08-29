/** 本机路径：开系统应用 / 在文件夹中显示 / 滚到工具卡。 */

export const LOCAL_PATH_RE =
  /(?<![A-Za-z0-9:/])((?:\.{1,2}\/|~\/|\/(?!\/)|[A-Za-z]:[\\/])[^\s`'"<>\]|,;:]+)/g;

export function looksLikeLocalPath(s: string): boolean {
  const t = s.trim();
  if (!t || /^https?:/i.test(t)) return false;
  return (
    t.startsWith("/") ||
    t.startsWith("./") ||
    t.startsWith("../") ||
    t.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(t)
  );
}

export function splitPathTokens(text: string): Array<{ text: string; path?: string }> {
  const out: Array<{ text: string; path?: string }> = [];
  const re = new RegExp(LOCAL_PATH_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + (m[0].length - (m[1]?.length ?? 0));
    if (start > last) out.push({ text: text.slice(last, start) });
    const path = (m[1] || "").replace(/[.,)]+$/, "");
    out.push({ text: path, path });
    last = start + path.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

export async function pickFolderNative(): Promise<string | null> {
  const fn = window.maouApp?.pickFolder;
  if (!fn) return null;
  const r = await fn();
  return r?.path ?? null;
}

export async function openLocalPath(path: string, reveal = false): Promise<void> {
  const p = path.trim();
  if (!p) return;
  if (reveal && window.maouApp?.revealInFolder) {
    await window.maouApp.revealInFolder(p);
    return;
  }
  if (window.maouApp?.openPath) {
    await window.maouApp.openPath(p);
  }
}

export function inspectToolCall(callId: string): boolean {
  const id = callId.trim();
  if (!id) return false;
  const el = document.querySelector<HTMLElement>(
    `[data-call-id="${CSS.escape(id)}"]`,
  );
  if (!el) return false;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add("is-inspect");
  window.setTimeout(() => el.classList.remove("is-inspect"), 1600);
  return true;
}

export function inspectPathInThread(path: string): boolean {
  const needle = path.trim();
  if (!needle) return false;
  const cards = document.querySelectorAll<HTMLElement>("[data-call-id]");
  for (const el of cards) {
    const marked = el.getAttribute("data-tool-path") || "";
    if (marked === needle || marked.endsWith(needle) || needle.endsWith(marked)) {
      const id = el.getAttribute("data-call-id") || "";
      return inspectToolCall(id);
    }
  }
  return false;
}
