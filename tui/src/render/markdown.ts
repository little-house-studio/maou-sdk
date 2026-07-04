// ── Markdown 渲染 ──────────────────────────────────────────────────────
//
// - 流式消息（streaming=true）：按 msgId 缓存实例，复用 Pi Markdown 的
//   streaming lex cache（频繁 new 会丢流式前缀缓存）。
// - finalize 消息：不缓存实例，靠 Pi Markdown 模块级 L2 LRU（跨实例存活）。
// 失败降级纯文本手动 wrap。
//
// mdCache 由 App 持有并传入（保持缓存生命周期与 app 一致）。

import { Markdown, visibleWidth } from "@oh-my-pi/pi-tui";
import { markdownTheme } from "../theme/themes.js";
import { trunc } from "./decorators.js";

export type MdCache = Map<string, { content: string; width: number; instance: Markdown }>;

export function renderMarkdown(
  msgId: string,
  content: string,
  width: number,
  streaming: boolean,
  mdCache: MdCache,
): readonly string[] {
  const renderWidth = width - 1;
  // 流式：命中缓存（同 content+width）则复用实例
  if (streaming) {
    const cached = mdCache.get(msgId);
    if (cached && cached.content === content && cached.width === renderWidth) {
      try { return cached.instance.render(renderWidth); } catch { mdCache.delete(msgId); }
    }
  }
  // 新建实例（finalize 走 Pi L2 LRU；流式则存回 mdCache）
  try {
    const md = new Markdown(content, 1, 0, markdownTheme);
    const rows = md.render(renderWidth);
    if (streaming) mdCache.set(msgId, { content, width: renderWidth, instance: md });
    return rows.length > 0 ? rows : [content];
  } catch {
    // 降级：纯文本手动 wrap
    try {
      return content.split("\n").flatMap(line => {
        if (line.length === 0) return [""];
        const wrapped: string[] = [];
        let remaining = line;
        while (visibleWidth(remaining) > renderWidth) {
          const truncated = trunc(remaining, renderWidth);
          wrapped.push(truncated);
          remaining = remaining.slice(truncated.length);
        }
        if (remaining.length > 0) wrapped.push(remaining);
        return wrapped;
      });
    } catch {
      return content.split("\n");
    }
  }
}
