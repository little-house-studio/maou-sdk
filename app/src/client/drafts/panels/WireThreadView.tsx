/**
 * Draft-aligned thread rendering: groupThreadBlocks + MessageRow / AssistantTurn.
 * Used by ContextPanel (fixtures) and live ChatPanel (wire chrome) for UI parity.
 */
import React, { useEffect, useState } from "react";
import {
  ASK_PREVIEW_MAX,
  UserStick,
  askAnchorProps,
  clipAskPreview,
} from "../../conversation";
import type { DraftMessage } from "../types";
import {
  groupLoopTurns,
  groupThreadBlocks,
  isPlaceholderAssistantBody,
  replyTurnVisible,
} from "../thread-blocks";
import type { ReplyBlock } from "../thread-blocks";
import { DraftMarkdown } from "../DraftMarkdown";
import { ToolCard } from "./ToolCard";
import { extractToolCallIntent } from "../tool-card";
import { InfoHover } from "../InfoHover";
import {
  durationStr,
  formatLoopTip,
  formatMessageHead,
  formatRoundTip,
  loopTipRows,
  messageHeadEmpty,
  roundTipRows,
  summarizeLoop,
} from "../message-meta";
import { roleLabelZh, roleMarkKind, roleTone } from "../visual-marks";
import { RoleAvatar } from "../icons/Marks";

export type WireThreadViewProps = {
  messages: DraftMessage[];
  /** Empty-state titles when messages.length === 0 */
  emptyTitle?: string;
  emptySub?: string;
  /** Open agent terminal from tool card click (optional) */
  onOpenTerminal?: (id: string, agentName?: string) => void;
  className?: string;
  /** 当前用户回合仍在跑时，最后一组 loop 不画完成脚注 */
  agentBusy?: boolean;
};

function MessageHeadLine({
  head,
}: {
  head: ReturnType<typeof formatMessageHead>;
}) {
  if (messageHeadEmpty(head)) return null;
  return (
    <div
      className={[
        "msg-head",
        head.live ? "is-live" : "",
        head.isError ? "is-error" : "",
        head.queued ? "is-queued" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {head.who ? <span className="msg-head-who">{head.who}</span> : null}
      {head.duration ? (
        <span className="msg-head-meta">{head.duration}</span>
      ) : null}
      {head.time ? <span className="msg-head-meta">{head.time}</span> : null}
      {head.live ? <span className="msg-head-live">进行中</span> : null}
      {head.queued ? <span className="msg-head-badge">排队</span> : null}
    </div>
  );
}

function MessageRow({
  message,
  onOpenTerminal,
}: {
  message: DraftMessage;
  onOpenTerminal?: WireThreadViewProps["onOpenTerminal"];
}) {
  const tone = roleTone(roleMarkKind(message.role));
  const isTool = message.role === "tool";
  const isSystem = message.role === "system";
  const isErr = message.role === "err";
  const head = formatMessageHead(message, message.agentName);
  const termId = message.tool?.name === "terminal" ? message.tag : undefined;

  return (
    <div
      className={[
        "bubble",
        "codex-bubble",
        "wire-msg",
        message.role,
        `tone-${tone}`,
        isSystem ? "is-telemetry" : "",
        head.live ? "is-live" : "",
        head.queued ? "is-queued" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-msg-id={message.id}
      data-msg-role={message.role}
      data-msg-preview={
        message.role === "user"
          ? message.body.replace(/\s+/g, " ").trim().slice(0, ASK_PREVIEW_MAX)
          : undefined
      }
    >
      <div className="msg-body">
        {!isTool ? <MessageHeadLine head={head} /> : null}
        <div
          className={`bubble-text${isTool ? " is-tool" : ""}${
            isErr ? " is-err" : ""
          }`}
        >
          {isTool ? (
            <ToolCard
              message={message}
              terminalId={termId}
              onOpenTerminal={
                termId && onOpenTerminal
                  ? () => onOpenTerminal(termId, message.agentName)
                  : undefined
              }
            />
          ) : (
            <>
              {message.images?.length ? (
                <div className="wire-msg-images">
                  {message.images.map((img, i) => (
                    <img
                      key={`${message.id}-img-${i}`}
                      className="wire-msg-image"
                      src={`data:${img.mimeType};base64,${img.data}`}
                      alt={img.name || `附图 ${i + 1}`}
                    />
                  ))}
                </div>
              ) : null}
              {message.body ? <DraftMarkdown source={message.body} /> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 思考行：默认折叠；头栏 = 图标动画 · Thought · 耗时 · token · 折叠 */
function ThinkingPart({ message }: { message: DraftMessage }) {
  const [thinkOpen, setThinkOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const streaming = Boolean(message.thinking?.streaming);

  useEffect(() => {
    if (!streaming) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [streaming]);

  const collapsed = !thinkOpen;
  const startedAt = message.thinking?.startedAt;
  const durationMs =
    message.thinking?.durationMs ??
    message.meta?.durationMs ??
    (streaming && startedAt != null ? Math.max(0, now - startedAt) : undefined);
  const outputTokens = message.thinking?.outputTokens;
  const durLabel =
    durationMs != null && Number.isFinite(durationMs)
      ? durationStr(durationMs) || "0ms"
      : streaming
        ? "…"
        : "";
  const tokLabel =
    outputTokens != null && outputTokens > 0
      ? `${outputTokens.toLocaleString()} tok`
      : "";

  return (
    <div
      className={[
        "wire-internal-part",
        "role-thinking",
        "tone-warn",
        streaming ? "is-streaming" : "",
        collapsed ? "is-collapsed" : "is-open",
      ]
        .filter(Boolean)
        .join(" ")}
      data-thinking="true"
      data-thinking-streaming={streaming ? "true" : "false"}
      data-thinking-collapsed={collapsed ? "true" : "false"}
    >
      <button
        type="button"
        className="wire-think-head"
        onClick={() => setThinkOpen((v) => !v)}
        aria-expanded={!collapsed}
        title={collapsed ? "展开思考" : "折叠思考"}
      >
        <span
          className={`wire-think-icon${streaming ? " is-spin" : ""}`}
          aria-hidden
        >
          <RoleAvatar kind="thinking" size={14} title="Thought" />
        </span>
        <span className="wire-think-label">
          {streaming ? "Thought..." : "Thought"}
        </span>
        {durLabel ? (
          <span className="wire-think-meta wire-think-dur">{durLabel}</span>
        ) : null}
        {tokLabel ? (
          <span className="wire-think-meta wire-think-tok">{tokLabel}</span>
        ) : null}
        <span className="wire-think-fold" aria-hidden>
          {collapsed ? "▶" : "▼"}
        </span>
      </button>
      {!collapsed ? (
        <div className="wire-internal-body is-thinking">
          <DraftMarkdown
            source={message.body || (streaming ? "…" : "（无思考内容）")}
          />
        </div>
      ) : null}
    </div>
  );
}

function InternalPart({ message }: { message: DraftMessage }) {
  const rKind = roleMarkKind(message.role);
  const label = roleLabelZh(rKind, message.tag);
  const isTool = message.role === "tool";
  const isThinking = message.role === "thinking";
  const isErr = message.role === "err";
  const tone = roleTone(rKind);

  if (isTool) {
    return (
      <div className="wire-internal-part role-tool tone-accent is-tool-card">
        <ToolCard message={message} />
      </div>
    );
  }

  if (isThinking) {
    return <ThinkingPart message={message} />;
  }

  return (
    <div
      className={[
        "wire-internal-part",
        `role-${message.role}`,
        `tone-${tone}`,
        isErr ? "is-err" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="wire-internal-label">
        <span>{label}</span>
      </div>
      <div className={`wire-internal-body${isErr ? " is-err" : ""}`}>
        <DraftMarkdown source={message.body} />
      </div>
    </div>
  );
}

function AssistantTurn({
  assistant,
  internals,
  round,
}: {
  assistant: DraftMessage | null;
  internals: DraftMessage[];
  round: number;
}) {
  const orphan = !assistant;
  const thinkParts = internals.filter((m) => m.role === "thinking");
  const otherInternals = internals.filter((m) => m.role !== "thinking");
  const head = assistant
    ? formatMessageHead(assistant, assistant.agentName)
    : {
        logo: "·",
        text: "内部步骤",
        live: false,
        streaming: false,
        isError: false,
        queued: false,
      };
  const startedAt = assistant?.meta?.ts;
  const [now, setNow] = useState(() => Date.now());
  const live = Boolean(head.live);
  useEffect(() => {
    if (!live || startedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [live, startedAt]);
  const durationMs =
    assistant?.meta?.durationMs ??
    (live && startedAt != null ? Math.max(0, now - startedAt) : undefined);
  const toolCount = internals.filter((m) => m.role === "tool").length;
  const tipInput = {
    round,
    startedAt,
    durationMs,
    toolCount,
    inputTokens: assistant?.meta?.usageInput,
    outputTokens: assistant?.meta?.usageOutput,
    live,
  };
  const tip = formatRoundTip(tipInput);
  const rows = roundTipRows(tipInput);
  const digits = String(round).length;
  const showBody =
    Boolean(assistant) && !isPlaceholderAssistantBody(assistant?.body);
  const hasColumn =
    orphan || thinkParts.length > 0 || showBody || otherInternals.length > 0;

  return (
    <div
      className={`wire-reply-turn${orphan ? " is-orphan" : ""}${
        live ? " is-live" : ""
      }${hasColumn ? "" : " is-chip-only"}`}
      data-orphan={orphan ? "true" : "false"}
      data-round={round}
    >
      <InfoHover rows={rows} label={tip}>
        <span
          className={`wire-round-chip${live ? " is-live" : ""}`}
          data-round-chip=""
          data-digits={digits}
        >
          {round}
        </span>
      </InfoHover>
      {hasColumn ? (
        <div
          className={`bubble codex-bubble wire-msg assistant${
            orphan ? " is-orphan" : ""
          }${live ? " is-live" : ""}`}
          data-msg-id={assistant?.id}
          data-msg-role={assistant ? "assistant" : "orphan"}
        >
          <div className="msg-body wire-reply-body">
            {orphan ? (
              <div className="msg-role wire-orphan-label">内部步骤</div>
            ) : null}

            {thinkParts.length > 0 ? (
              <div
                className="wire-reply-internals wire-reply-thinking"
                data-count={thinkParts.length}
              >
                {thinkParts.map((part) => (
                  <InternalPart key={part.id} message={part} />
                ))}
              </div>
            ) : null}

            {showBody ? (
              <div className="bubble-text">
                <DraftMarkdown source={assistant!.body} />
              </div>
            ) : null}

            {otherInternals.length > 0 ? (
              <div
                className="wire-reply-internals"
                data-count={otherInternals.length}
              >
                {otherInternals.map((part) => (
                  <InternalPart key={part.id} message={part} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function repliesAreLive(replies: ReplyBlock[]): boolean {
  return replies.some(
    (block) =>
      Boolean(block.assistant?.meta?.streaming) ||
      block.internals.some((part) => part.thinking?.streaming),
  );
}

function LoopFoot({
  replies,
  roundCount,
}: {
  replies: ReplyBlock[];
  roundCount: number;
}) {
  const summary = { ...summarizeLoop(replies), roundCount };
  const tip = formatLoopTip(summary);
  const dur = durationStr(summary.durationMs);
  return (
    <div className="wire-loop-foot" data-loop-foot="">
      <InfoHover rows={loopTipRows(summary)} label={tip}>
        <span className="wire-loop-foot-time">用时 {dur || "—"}</span>
      </InfoHover>
    </div>
  );
}

function LoopBlock({
  user,
  replies,
  complete,
  onOpenTerminal,
}: {
  user: DraftMessage | null;
  replies: ReplyBlock[];
  complete: boolean;
  onOpenTerminal?: WireThreadViewProps["onOpenTerminal"];
}) {
  const shown = replies.filter(replyTurnVisible);
  const showFoot = complete && shown.length > 0;
  return (
    <div
      className="wire-loop"
      data-loop=""
      data-loop-complete={showFoot ? "true" : "false"}
      {...(user ? askAnchorProps(user.id, clipAskPreview(user.body)) : {})}
    >
      {user ? (
        <UserStick>
          <MessageRow message={user} onOpenTerminal={onOpenTerminal} />
        </UserStick>
      ) : null}
      {shown.map((block, i) => (
        <AssistantTurn
          key={block.assistant?.id ?? block.internals[0]?.id ?? `reply-${i}`}
          assistant={block.assistant}
          internals={block.internals}
          round={i + 1}
        />
      ))}
      {showFoot ? (
        <LoopFoot replies={replies} roundCount={shown.length} />
      ) : null}
    </div>
  );
}

/** Shared thread list for draft ContextPanel parity */
export const WireThreadView = React.memo(function WireThreadView({
  messages,
  emptyTitle = "还没有消息",
  emptySub = "在下方输入开始对话。",
  onOpenTerminal,
  className = "",
  agentBusy = false,
}: WireThreadViewProps) {
  const blocks = groupThreadBlocks(messages);
  const segments = groupLoopTurns(blocks);
  const empty = messages.length === 0;
  const lastLoopIdx = (() => {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i]!.kind === "loop") return i;
    }
    return -1;
  })();

  if (empty) {
    return (
      <div className={`wire-empty-hero empty-hint ${className}`.trim()}>
        <p className="wire-empty-k">空单元</p>
        <h2 className="empty-title">{emptyTitle}</h2>
        <p className="empty-sub">{emptySub}</p>
      </div>
    );
  }

  return (
    <>
      <div className="wire-thread-lead" aria-hidden />
      {segments.map((seg, i) => {
        if (seg.kind === "solo") {
          const m = seg.message;
          if (m.role === "user") {
            return (
              <UserStick
                key={m.id}
                ask={{ id: m.id, preview: clipAskPreview(m.body) }}
              >
                <MessageRow message={m} onOpenTerminal={onOpenTerminal} />
              </UserStick>
            );
          }
          return (
            <MessageRow
              key={m.id}
              message={m}
              onOpenTerminal={onOpenTerminal}
            />
          );
        }
        const live =
          repliesAreLive(seg.replies) || (i === lastLoopIdx && agentBusy);
        const complete = Boolean(seg.user) && seg.replies.length > 0 && !live;
        return (
          <LoopBlock
            key={seg.user?.id ?? seg.replies[0]?.assistant?.id ?? `loop-${i}`}
            user={seg.user}
            replies={seg.replies}
            complete={complete}
            onOpenTerminal={onOpenTerminal}
          />
        );
      })}
    </>
  );
});

/**
 * 从工具行正文解析工具名（与 ChatPanel.extractToolNameFromText 同语义，避免环依赖）。
 * 自动获取，不硬编码具体工具名列表。
 */
export function extractToolNameFromToolBody(text: string): string | undefined {
  const t = (text || "").trim();
  if (!t) return undefined;
  // Prefer explicit 「工具 name」 (runtime / Chinese errors use ❌ 工具 foo)
  const m =
    t.match(/(?:^|[\s▶✓✗×❌xX])工具\s+([a-zA-Z_][\w.-]*)/) ||
    t.match(/^[▶✓✗×❌xX]\s*[·•]?\s*([a-zA-Z_][\w.-]*)/) ||
    t.match(/^([a-zA-Z_][\w.-]*)\s*[·•]/);
  const name = m?.[1]?.trim();
  if (!name || name === "tool") return undefined;
  return name;
}

function resolveToolDisplayName(line: {
  toolName?: string;
  terminalId?: string;
  text?: string;
}): string {
  const field = (line.toolName || "").trim();
  if (field && field !== "tool" && field !== "terminal") return field;
  const fromBody = extractToolNameFromToolBody(line.text || "");
  if (fromBody) return fromBody;
  if (line.terminalId) return "use_terminal";
  if (field === "terminal") return "use_terminal";
  return field || "tool";
}

/** Map live ChatLine-like rows into DraftMessage for grouping. */
export function chatLinesToDraftMessages(
  lines: Array<{
    id: string;
    role: string;
    text: string;
    err?: boolean;
    terminalId?: string;
    agentName?: string;
    toolName?: string;
    toolCallId?: string;
    toolDescription?: string;
    thinkStartedAt?: number;
    thinkDurationMs?: number;
    thinkOutputTokens?: number;
    startedAt?: number;
    durationMs?: number;
    usageInput?: number;
    usageOutput?: number;
    round?: number;
    images?: Array<{ mimeType: string; data: string; name?: string }>;
  }>,
  opts?: { agentBusy?: boolean; agentName?: string },
): DraftMessage[] {
  const busy = Boolean(opts?.agentBusy);
  const agent = opts?.agentName || "coding";
  let lastAssistantIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }
  let assistantRound = 0;
  return lines.map((l, idx) => {
    // Tool rows keep role=tool even when err — badge must show real tool name
    if (l.err && l.role !== "tool") {
      return {
        id: l.id,
        role: "err" as const,
        body: l.text || "",
        meta: { authorLabel: "error" },
      };
    }
    if (l.role === "tool") {
      const toolName = resolveToolDisplayName(l);
      const isErr =
        Boolean(l.err) ||
        /^[✗×❌]/.test((l.text || "").trim()) ||
        /缺少必填|失败|error|❌/i.test(l.text || "");
      const body = l.text || "";
      const inFlight = /^▶/.test(body.trim()) || (busy && body.trim().length === 0);
      const description =
        (l.toolDescription || "").trim() ||
        extractToolCallIntent(body) ||
        undefined;
      return {
        id: l.id,
        role: "tool" as const,
        body,
        tag: l.terminalId || toolName || undefined,
        clickable: false,
        agentName: l.agentName || agent,
        tool: {
          name: toolName,
          result: body,
          done: !inFlight,
          isError: isErr,
          description,
          durationMs: l.durationMs,
        },
      };
    }
    if (l.role === "thinking") {
      // 默认折叠；流式中仅头栏动画，正文仍隐藏直到用户点开
      const streaming = Boolean(busy);
      return {
        id: l.id,
        role: "thinking" as const,
        body: l.text || "",
        thinking: {
          streaming,
          collapsed: true,
          durationMs: l.thinkDurationMs,
          outputTokens: l.thinkOutputTokens,
          startedAt: l.thinkStartedAt,
        },
      };
    }
    if (l.role === "assistant") {
      assistantRound += 1;
      const placeholder = isPlaceholderAssistantBody(l.text);
      const streaming = busy && placeholder && idx === lastAssistantIdx;
      return {
        id: l.id,
        role: "assistant" as const,
        body: placeholder ? "" : l.text,
        agentName: l.agentName || agent,
        meta: {
          authorLabel: `agent:${agent}`,
          streaming,
          round: l.round ?? assistantRound,
          ts: l.startedAt,
          durationMs: l.durationMs,
          usageInput: l.usageInput,
          usageOutput: l.usageOutput,
        },
      };
    }
    if (l.role === "user") {
      return {
        id: l.id,
        role: "user" as const,
        body: l.text || "",
        meta: { authorLabel: "user" },
        ...(l.images?.length ? { images: l.images } : {}),
      };
    }
    return {
      id: l.id,
      role: "system" as const,
      body: l.text || "",
    };
  });
}
