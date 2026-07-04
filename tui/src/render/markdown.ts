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

/**
 * 内容安全上限（字符数）。超过此长度的 content 在交给 Pi Markdown（Rust
 * native sliceWithWidth/truncateToWidth）之前先在 JS 层按字符截断。
 *
 * 原因：pi-natives 的 Rust 实现在超长 CJK+ANSI 串上用字节索引切片，
 * 与 Node 下 Bun.stringWidth shim 的列宽计算在某些边界字符上不一致，
 * 算出的偏移落到多字节字符中间 → str::get panic → 进程 abort。
 * 191KB 的 assistant 消息曾触发此 bug（见 terminal.rs:372 panic）。
 * 流式消息极少需要看完整超长内容，截到 4000 字符（约 8k 显示列）足够。
 */
const MAX_CONTENT_CHARS = 4000;
const TRUNC_TAIL_NOTE = "\n\n…[内容过长已截断，完整内容见 raw 日志]";

/** JS 层字符级截断（绕过 Rust native 的字节切片）。 */
function safeTruncate(s: string): string {
  if (s.length <= MAX_CONTENT_CHARS) return s;
  return s.slice(0, MAX_CONTENT_CHARS) + TRUNC_TAIL_NOTE;
}

export function renderMarkdown(
  msgId: string,
  content: string,
  width: number,
  streaming: boolean,
  mdCache: MdCache,
): readonly string[] {
  const renderWidth = width - 1;
  // 安全截断：超长 content 先在 JS 层按字符截，避免 Rust native 字节切片 panic
  const safeContent = safeTruncate(content);
  // 流式：命中缓存（同 content+width）则复用实例
  if (streaming) {
    const cached = mdCache.get(msgId);
    if (cached && cached.content === safeContent && cached.width === renderWidth) {
      try { return cached.instance.render(renderWidth); } catch { mdCache.delete(msgId); }
    }
  }
  // 新建实例（finalize 走 Pi L2 LRU；流式则存回 mdCache）
  try {
    const md = new Markdown(safeContent, 1, 0, markdownTheme);
    const rows = md.render(renderWidth);
    if (streaming) mdCache.set(msgId, { content: safeContent, width: renderWidth, instance: md });
    return rows.length > 0 ? rows : [safeContent];
  } catch {
    // 降级：纯文本手动 wrap
    try {
      return safeContent.split("\n").flatMap(line => {
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
      return safeContent.split("\n");
    }
  }
}
