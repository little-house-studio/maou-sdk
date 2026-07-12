/**
 * MessageRow —— logo 列版式 + 用户灰矩形 + 超长折叠 + 工具卡。
 */

import React, { memo, useMemo, useState, useRef } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import stringWidth from "string-width";
import { useTheme } from "../../theme/theme-context.js";
import type { ChatMessage, MessageAuthor } from "../../state/types.js";
import { MarkdownRenderer, estimateMarkdownLines } from "./MarkdownRenderer.js";
import { ToolCard } from "./ToolCard.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { CollapsibleText, estimateLines } from "./Collapsible.js";
import { MsgShell, MsgHead, MsgBody } from "./MsgLayout.js";
import { timecode, shortId, durationStr, loopMark, compact } from "../../layout/decorators.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";
import { useClickTarget } from "../../input/click-target.js";
import { useStore } from "../../state/store.js";
import { repairUtf8Mojibake } from "../../input/filtered-stdin.js";

/** 头栏身份标签：user | agent:xxx | system:xxx | tool:xxx */
function authorLabel(author: MessageAuthor | undefined, fallback: string): string {
  if (!author?.type) return fallback;
  const name = author.displayName || author.id;
  switch (author.type) {
    case "human":
      return name && name !== "user" ? `user:${name}` : "user";
    case "agent":
      return name ? `agent:${name}` : "agent";
    case "system":
      return name ? `system:${name}` : "system";
    case "tool":
      return name ? `tool:${name}` : "tool";
    default:
      return fallback;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** 展示前：HTML 实体 + 历史 UTF-8/latin1 乱码修复 */
function displayText(s: string): string {
  return decodeEntities(repairUtf8Mojibake(s || ""));
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

/** 用户气泡角钉（螺丝感）；左侧用连贯竖线 │ 标示用户块 */
const USER_SCREW = "⨁";
const USER_BAR = "│";

/** 用户气泡：左侧整列竖线 + 右上/右下 ⨁；正文超 10 行折叠 */
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
  const screwW = stringWidth(USER_SCREW) || 1;
  const barW = stringWidth(USER_BAR) || 1;
  // 竖线右侧内容区
  const innerW = Math.max(1, w - barW);
  const colW = Math.max(8, innerW - 1);
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

  // 角钉右缘内缩 1 格；左侧用 │ 贯穿上下（取代 ▸）
  const inset = 1;
  const headCore = fitVisual(` ${head}`, Math.max(1, innerW - screwW - inset));
  const bodyPainted = bodyLines.map((line) =>
    fitVisual(` ${line || " "}`, innerW),
  );
  const botMid = " ".repeat(Math.max(0, innerW - screwW - inset));
  const foldCore = need
    ? fitVisual(
        ` ${open ? `▲ 收起（共 ${total} 行）` : `▼ 展开全文（${total} 行 · 点击）`}`,
        innerW,
      )
    : null;
  const screwColor = t.muted;
  const barColor = t.accent; // 左侧竖线：用户块标识
  const pad1 = " ";

  /** 每行最左画 │，保证顶→底连贯 */
  const withBar = (rest: React.ReactNode, key?: string | number) => (
    <Box key={key} flexDirection="row" flexShrink={0}>
      <Text backgroundColor={bg} color={barColor}>{USER_BAR}</Text>
      {rest}
    </Box>
  );

  return (
    <Box ref={ref} flexDirection="column" flexShrink={0} marginTop={1}>
      {/* 顶行：│ + 头 + 右上 ⨁ + 右内缩 */}
      {withBar(
        <>
          <Text backgroundColor={bg} color={headFg} bold>{headCore}</Text>
          <Text backgroundColor={bg} color={screwColor}>{USER_SCREW}</Text>
          <Text backgroundColor={bg} color={bg}>{pad1}</Text>
        </>,
      )}
      {bodyPainted.map((line, i) =>
        withBar(
          <Text backgroundColor={bg} color={bodyFg}>{line}</Text>,
          i,
        ),
      )}
      {foldCore && withBar(
        <Text backgroundColor={bg} color={isHover ? t.accent : t.dim}>{foldCore}</Text>,
        "fold",
      )}
      {/* 底垫：│ + 中空 + 右下 ⨁（无左下钉） */}
      {withBar(
        <>
          <Text backgroundColor={bg} color={bg}>{botMid}</Text>
          <Text backgroundColor={bg} color={screwColor}>{USER_SCREW}</Text>
          <Text backgroundColor={bg} color={bg}>{pad1}</Text>
        </>,
        "bot",
      )}
    </Box>
  );
}

const ASSISTANT_FOLD_LINES = 12;

/** assistant 正文：流式纯文本；结束后 markdown；超长折叠仍渲染 MD（限行） */
function AssistantBody({ content, streaming }: { content: string; streaming: boolean }) {
  const t = useTheme();
  const term = useTerminalSize();
  const colW = Math.max(12, term.cols - 8);
  // 用 markdown 视觉行估算，避免「折叠时按原文 | 管道行」误判
  const total = useMemo(
    () => estimateMarkdownLines(content, colW),
    [content, colW],
  );
  const need = !streaming && total > ASSISTANT_FOLD_LINES;
  const [open, setOpen] = useState(false);
  const ref = useRef<DOMElement | null>(null);
  const cid = useClickTarget(ref, () => { if (need) setOpen((o) => !o); }, [need, open]);
  const isHover = useStore((s) => s.hoverId) === cid;

  if (!content) return null;

  if (streaming) {
    return <Text color={t.assistant} wrap="wrap">{content}</Text>;
  }

  // 折叠 / 展开：都走 MarkdownRenderer；折叠时 maxLines 截断（表格/标题仍按 MD 渲染）
  return (
    <Box ref={ref} flexDirection="column">
      <MarkdownRenderer
        md={content}
        maxLines={need && !open ? ASSISTANT_FOLD_LINES : undefined}
      />
      {need && (
        <Text color={isHover ? t.accent : t.dim}>
          {open
            ? ` ▲ 收起（共 ${total} 行 · 点击收起）`
            : ` ▼ 展开全文（已折叠约 ${total} 行 · 点击展开）`}
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
    // 非真人 user（wire 妥协）：按系统/agent 通知渲染，避免灰底用户气泡
    const kind = msg.kind ?? "human_user";
    const noticeKinds = new Set([
      "system_notice",
      "runtime_control",
      "agent_message",
      "compact",
      "unknown",
    ]);
    if (noticeKinds.has(kind) && kind !== "human_user" && kind !== "queued_user") {
      const who = authorLabel(msg.author, kind === "agent_message" ? "agent" : "system");
      const bodyText = displayText(msg.content || " ") || " ";
      return (
        <MsgShell marginTop={1}>
          <MsgHead logo="▣" color={t.system}>
            {`${shortId(msg.id)} | ${who} | ${ts}${msg.source ? ` · ${msg.source}` : ""}`}
          </MsgHead>
          <MsgBody>
            <CollapsibleText text={bodyText} color={t.system} bg={t.systemBg} maxLines={8} />
          </MsgBody>
        </MsgShell>
      );
    }
    const upTok = msg.usage ? compact(msg.usage.input) : "";
    const bodyText = displayText(msg.content || " ") || " ";
    const who = authorLabel(msg.author, "user");
    const head = `${shortId(msg.id)} | ${who} | ${ts}${upTok ? ` | ↑${upTok}` : ""}${kind === "queued_user" ? " | queued" : ""}`;
    return (
      <UserBubble
        width={blockW}
        bg={t.userBg}
        headFg={t.muted}
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
    // 空文本不渲染正文，避免头与工具卡之间空一行
    const content = displayText(msg.content || "").trim();
    const thinking = (msg.thinkingBlocks ?? []).filter((b) => b.content);
    const tools = msg.toolCalls ?? [];
    const who = authorLabel(
      msg.author ?? (msg.agentName ? { type: "agent", id: msg.agentName, displayName: msg.agentName } : undefined),
      "agent:ai",
    );

    return (
      // AI 消息头上方空一行，与上一条消息（用户/上一轮 ai）隔开
      <MsgShell marginTop={1}>
        {/* 不再画 ─ ↺ n ─ 轮次隔离线，轮次信息保留在头里 */}
        <MsgHead logo="◈" color={t.dim}>
          {`${loopMark(round, 0)} | ${who} | ${ts}${dur ? ` | (${dur})` : ""}${dnTok ? ` | ↓${dnTok}` : ""}${streaming ? " · …" : ""}`}
        </MsgHead>
        {thinking.length > 0 && (
          <MsgBody>
            {thinking.map((b) => (
              <ThinkingBlock key={b.id} block={b} />
            ))}
          </MsgBody>
        )}
        {content ? (
          <MsgBody>
            <AssistantBody content={content} streaming={streaming} />
          </MsgBody>
        ) : null}
        {/* think / 正文 与工具卡紧挨，中间不空行 */}
        {tools.length > 0 &&
          tools.map((tc) => (
            <MsgBody key={tc.id}>
              <ToolCard tool={tc} index={1} frame={frame} />
            </MsgBody>
          ))}
      </MsgShell>
    );
  }

  const sysText = displayText(msg.content || "");
  const who = authorLabel(msg.author, "system");
  return (
    <MsgShell>
      <MsgHead logo="▣" color={t.system}>
        {`${shortId(msg.id)} | ${who} | ${ts}`}
      </MsgHead>
      <MsgBody>
        <CollapsibleText text={sysText} color={t.system} bg={t.systemBg} maxLines={10} />
      </MsgBody>
    </MsgShell>
  );
}

// 默认浅比较 props；尺寸变化靠组件内 useTerminalSize 的 setState 自行重渲
export const MessageRow = memo(MessageRowImpl);
