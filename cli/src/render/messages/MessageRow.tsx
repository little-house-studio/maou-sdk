/**
 * MessageRow —— logo 列版式 + 用户灰矩形 + 超长折叠 + 工具卡。
 */

import React, { memo, useMemo, useState, useRef } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import stringWidth from "string-width";
import { useTheme } from "../../theme/theme-context.js";
import type { ChatMessage, MessageAuthor } from "../../state/types.js";
import { MarkdownRenderer, estimateMarkdownLines, hasStructuredMarkdown } from "./MarkdownRenderer.js";
import { MdPaper, mdPaperLayout } from "./MdPaper.js";
import { ToolCard } from "./ToolCard.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { CollapsibleText, estimateLines } from "./Collapsible.js";
import { MsgShell, MsgHead, MsgBody } from "./MsgLayout.js";
import { timecode, shortId, durationStr, loopMark, compact } from "../../layout/decorators.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";
import { useClickTarget } from "../../input/click-target.js";
import { useStore } from "../../state/store.js";
import { repairUtf8Mojibake } from "../../input/filtered-stdin.js";
import { useAnimFrame, spinnerChar, neonRgb } from "../../hooks/useAnimFrame.js";
import { chatInnerCols, chatBodyCols } from "../../layout/chat-width.js";

/** 流式 LIVE 徽章：酸性霓虹色扫过 */
function LiveBadge({ frame }: { frame: number }) {
  const label = " LIVE ";
  const chars = [...label];
  return (
    <Text bold>
      {chars.map((ch, i) => {
        const [r, g, b] = neonRgb(frame * 0.35 + i * 0.45);
        const hex = `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
        return (
          <Text key={i} color={hex} backgroundColor="#1A1A1A">
            {ch}
          </Text>
        );
      })}
    </Text>
  );
}

/** 助手消息头：流式时 spinner + LIVE 霓虹 */
function AssistantHead({
  logoColor,
  streaming,
  text,
}: {
  logoColor: string;
  streaming: boolean;
  text: string;
}) {
  const frame = useAnimFrame(streaming, 120);
  const spin = spinnerChar(frame);
  return (
    <MsgHead logo={streaming ? spin : "◈"} color={logoColor}>
      <Text color={logoColor}>
        {text}
        {streaming ? " · " : ""}
      </Text>
      {streaming ? <LiveBadge frame={frame} /> : null}
    </MsgHead>
  );
}

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
  const cid = useClickTarget(
    ref,
    () => {
      if (!need) return;
      setOpen((o) => !o);
      useStore.getState().bumpContentLayout();
    },
    [need, open],
  );
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

/** assistant 正文：普通文字无缩进；仅结构化 MD 走居中纸面（左右对称留白） */
function AssistantBody({ content, streaming }: { content: string; streaming: boolean }) {
  const t = useTheme();
  const term = useTerminalSize();
  // 流式光标动画（hooks 必须无条件调用）；略慢一点减卡
  const streamFrame = useAnimFrame(streaming, 110);
  // 正文列：对话区内层 − logo，绝不吃到右边框
  const plainW = chatBodyCols(term.cols);
  const paper = mdPaperLayout(plainW);
  const colW = paper.contentW;

  const asMd = useMemo(
    () => !streaming && hasStructuredMarkdown(content),
    [content, streaming],
  );
  const total = useMemo(
    () => (asMd ? estimateMarkdownLines(content, colW) : estimateLines(content, plainW)),
    [asMd, content, colW, plainW],
  );
  const need = !streaming && asMd && total > ASSISTANT_FOLD_LINES;
  const [open, setOpen] = useState(false);
  const ref = useRef<DOMElement | null>(null);
  const cid = useClickTarget(
    ref,
    () => {
      if (!need) return;
      setOpen((o) => !o);
      useStore.getState().bumpContentLayout();
    },
    [need, open],
  );
  const isHover = useStore((s) => s.hoverId) === cid;

  if (!content && !streaming) return null;

  // 流式：霓虹扫尾光标 + 正文
  if (streaming) {
    const cursor = spinnerChar(streamFrame);
    const [cr, cg, cb] = neonRgb(streamFrame * 0.4);
    const cursorColor = `#${[cr, cg, cb].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
    return (
      <Text color={t.assistant} wrap="wrap">
        {content}
        <Text color={cursorColor} bold>{` ${cursor}`}</Text>
      </Text>
    );
  }
  if (!asMd) {
    return (
      <CollapsibleText
        text={content}
        color={t.assistant}
        maxLines={ASSISTANT_FOLD_LINES}
      />
    );
  }

  // 结构化 MD：左竖线标示 + 限宽折行，整块不铺底（避免右侧空填色）
  return (
    <Box ref={ref} flexDirection="column" alignSelf="flex-start">
      <MdPaper width={plainW}>
        <MarkdownRenderer
          md={content}
          contentWidth={colW}
          maxLines={need && !open ? ASSISTANT_FOLD_LINES : undefined}
        />
      </MdPaper>
      {need && (
        <Box marginLeft={2}>
          <Text color={isHover ? t.accent : t.dim}>
            {open
              ? ` ▲ 收起（共 ${total} 行 · 点击收起）`
              : ` ▼ 展开全文（已折叠约 ${total} 行 · 点击展开）`}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function MessageRowImpl({ msg, frame }: { msg: ChatMessage; frame: number }) {
  const t = useTheme();
  const term = useTerminalSize();
  const ts = timecode(new Date(msg.ts));
  // 外层 Chat 有 single 边框，内容区 = cols-2
  const blockW = chatInnerCols(term.cols);

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
    // 流式头动画（MessageRowImpl 每次都跑 hooks 的话会破坏 hook 顺序——只能放子组件）
    return (
      // AI 消息头上方空一行，与上一条消息（用户/上一轮 ai）隔开
      <MsgShell marginTop={1}>
        <AssistantHead
          logoColor={streaming ? t.accent : t.dim}
          streaming={streaming}
          text={`${loopMark(round, 0)} | ${who} | ${ts}${dur ? ` | (${dur})` : ""}${dnTok ? ` | ↓${dnTok}` : ""}`}
        />
        {thinking.length > 0 && (
          <MsgBody>
            {thinking.map((b) => (
              <ThinkingBlock key={b.id} block={b} />
            ))}
          </MsgBody>
        )}
        {(content || streaming) ? (
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

// 默认浅比较 props；frame 仅兜底静态值，不参与比较（避免父级 frame 抖动打穿 memo）
export const MessageRow = memo(MessageRowImpl, (a, b) => a.msg === b.msg);
