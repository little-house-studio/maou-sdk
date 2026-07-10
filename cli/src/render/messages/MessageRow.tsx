/**
 * MessageRow —— logo 列版式 + 用户灰矩形 + 超长折叠 + 工具卡。
 */

import React, { memo, useMemo, useState, useRef } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import stringWidth from "string-width";
import { useTheme } from "../../theme/theme-context.js";
import type { ChatMessage } from "../../state/types.js";
import { MarkdownRenderer } from "./MarkdownRenderer.js";
import { ToolCard } from "./ToolCard.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { CollapsibleText, estimateLines } from "./Collapsible.js";
import { MsgShell, MsgHead, MsgBody, LOGO_W, padLogo } from "./MsgLayout.js";
import { timecode, shortId, durationStr, loopMark, compact } from "../../layout/decorators.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";
import { useClickTarget } from "../../input/click-target.js";
import { useStore } from "../../state/store.js";

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function fitVisual(text: string, width: number): string {
  if (width <= 0) return "";
  let out = "";
  let used = 0;
  for (const ch of text) {
    const w = stringWidth(ch) || 1;
    if (used + w > width) break;
    out += ch;
    used += w;
  }
  if (used < width) out += " ".repeat(width - used);
  return out;
}

/** 用户气泡：整块灰矩形；正文超 10 行折叠 */
function UserBubble({
  width,
  bg,
  headFg,
  bodyFg,
  head,
  bodyText,
}: {
  width: number;
  bg: string;
  headFg: string;
  bodyFg: string;
  head: string;
  bodyText: string;
}) {
  const t = useTheme();
  const w = Math.max(8, width);
  const colW = Math.max(8, w - LOGO_W - 1);
  const total = estimateLines(bodyText, colW);
  const need = total > 10;
  const [open, setOpen] = useState(false);
  const ref = useRef<DOMElement | null>(null);
  const cid = useClickTarget(ref, () => { if (need) setOpen((o) => !o); }, [need, open]);
  const isHover = useStore((s) => s.hoverId) === cid;

  // 折叠时只取前 10 显示行
  let bodyLines = (bodyText || " ").split("\n");
  if (need && !open) {
    const preview: string[] = [];
    let used = 0;
    for (const raw of bodyLines) {
      if (used >= 10) break;
      const needL = Math.max(1, Math.ceil((stringWidth(raw) || 1) / colW));
      if (used + needL <= 10) {
        preview.push(raw);
        used += needL;
      } else {
        preview.push(raw.slice(0, Math.max(1, colW - 1)) + "…");
        used = 10;
        break;
      }
    }
    bodyLines = preview;
  }

  const top = "─".repeat(w);
  const headLine = fitVisual(`${padLogo("▸")}${head}`, w);
  const bodyPainted = bodyLines.map((line) =>
    fitVisual(`${" ".repeat(LOGO_W)} ${line || " "}`, w),
  );
  const pad = " ".repeat(w);
  const foldLine = need
    ? fitVisual(
        `${" ".repeat(LOGO_W)} ${open ? `▲ 收起（共 ${total} 行）` : `▼ 展开全文（${total} 行 · 点击）`}`,
        w,
      )
    : null;

  return (
    <Box ref={ref} flexDirection="column" flexShrink={0} marginTop={1}>
      <Text backgroundColor={bg} color={headFg}>{top}</Text>
      <Text backgroundColor={bg} color={headFg} bold>{headLine}</Text>
      {bodyPainted.map((line, i) => (
        <Text key={i} backgroundColor={bg} color={bodyFg}>{line}</Text>
      ))}
      {foldLine && (
        <Text backgroundColor={bg} color={isHover ? t.accent : t.dim}>{foldLine}</Text>
      )}
      <Text backgroundColor={bg} color={bg}>{pad}</Text>
    </Box>
  );
}

/** assistant 正文：流式纯文本；结束后 markdown；超 10 行折叠 */
function AssistantBody({ content, streaming }: { content: string; streaming: boolean }) {
  const t = useTheme();
  const term = useTerminalSize();
  const colW = Math.max(12, term.cols - 8);
  const total = useMemo(() => estimateLines(content, colW), [content, colW]);
  const need = !streaming && total > 10;
  const [open, setOpen] = useState(false);
  const ref = useRef<DOMElement | null>(null);
  const cid = useClickTarget(ref, () => { if (need) setOpen((o) => !o); }, [need, open]);
  const isHover = useStore((s) => s.hoverId) === cid;

  if (!content) return null;

  if (streaming) {
    return <Text color={t.assistant} wrap="wrap">{content}</Text>;
  }

  // 折叠：纯文本预览（避免半截 markdown 乱版）；展开/短文：完整 markdown
  if (need && !open) {
    const preview: string[] = [];
    let used = 0;
    for (const raw of content.split("\n")) {
      if (used >= 10) break;
      const needL = Math.max(1, Math.ceil((stringWidth(raw) || 1) / colW));
      if (used + needL <= 10) {
        preview.push(raw);
        used += needL;
      } else {
        preview.push(raw.slice(0, Math.max(1, colW - 1)) + "…");
        break;
      }
    }
    return (
      <Box ref={ref} flexDirection="column">
        {preview.map((l, i) => (
          <Text key={i} color={t.assistant}>{l || " "}</Text>
        ))}
        <Text color={isHover ? t.accent : t.dim}>
          {` ▼ 展开全文（已折叠 ${total} 行 · 点击展开）`}
        </Text>
      </Box>
    );
  }

  return (
    <Box ref={ref} flexDirection="column">
      <MarkdownRenderer md={content} />
      {need && (
        <Text color={isHover ? t.accent : t.dim}>
          {` ▲ 收起（共 ${total} 行 · 点击收起）`}
        </Text>
      )}
    </Box>
  );
}

function MessageRowImpl({ msg, frame }: { msg: ChatMessage; frame: number }) {
  const t = useTheme();
  const term = useTerminalSize();
  const ts = timecode(new Date(msg.ts));
  const blockW = Math.max(16, term.cols - 2);

  if (msg.role === "user") {
    const upTok = msg.usage ? compact(msg.usage.input) : "";
    const bodyText = decodeEntities(msg.content || " ");
    const head = `${shortId(msg.id)} | user | ${ts}${upTok ? ` | ↑${upTok}` : ""}`;
    return (
      <UserBubble
        width={blockW}
        bg={t.userBg}
        headFg={t.warn}
        bodyFg={t.user}
        head={head}
        bodyText={bodyText}
      />
    );
  }

  if (msg.role === "assistant") {
    const dnTok = msg.usage ? compact(msg.usage.output) : "";
    const dur = durationStr(msg.duration);
    const round = msg.round ?? 0;
    const streaming = !!msg.streaming;
    const content = decodeEntities(msg.content || "");

    // 单行 loop 分隔，禁止 wrap 成两行
    const loopLine = fitVisual(
      `${padLogo("─")}${"─".repeat(6)} ↺ ${round} ${"─".repeat(Math.max(4, blockW))}`,
      blockW,
    );

    return (
      <MsgShell>
        <Text color={t.dim}>{loopLine}</Text>
        <MsgHead logo="◈" color={t.dim}>
          {`${loopMark(round, 0)} | ai | ${ts}${dur ? ` | (${dur})` : ""}${dnTok ? ` | ↓${dnTok}` : ""}${streaming ? " · …" : ""}`}
        </MsgHead>
        {msg.thinkingBlocks && msg.thinkingBlocks.length > 0 && msg.thinkingBlocks.some((b) => b.content) && (
          <MsgBody>
            {msg.thinkingBlocks.filter((b) => b.content).map((b) => (
              <ThinkingBlock key={b.id} block={b} />
            ))}
          </MsgBody>
        )}
        {content ? (
          <MsgBody>
            <AssistantBody content={content} streaming={streaming} />
          </MsgBody>
        ) : null}
        {msg.toolCalls?.map((tc) => (
          <MsgBody key={tc.id}>
            <ToolCard tool={tc} index={1} frame={frame} />
          </MsgBody>
        ))}
      </MsgShell>
    );
  }

  const sysText = decodeEntities(msg.content || "");
  return (
    <MsgShell>
      <MsgHead logo="▣" color={t.system}>
        <CollapsibleText text={sysText} color={t.system} bg={t.systemBg} maxLines={10} />
      </MsgHead>
    </MsgShell>
  );
}

export const MessageRow = memo(MessageRowImpl, (a, b) => {
  return a.msg === b.msg && a.frame === b.frame;
});
