/**
 * Draft-aligned thread rendering: groupThreadBlocks + MessageRow / AssistantTurn.
 * Used by ContextPanel (fixtures) and live ChatPanel (wire chrome) for UI parity.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ASK_PREVIEW_MAX,
  UserStick,
  askAnchorProps,
  clipAskPreview,
  offsetInScroll,
} from "../../conversation";
import type { DraftMessage } from "../types";
import {
  groupLoopTurns,
  groupThreadBlocks,
  isModelCallProgressText,
  isPlaceholderAssistantBody,
  replyBlockLive,
  pinReleasedLastTurn,
  replyTurnFoldable,
  replyTurnOpen,
  replyTurnVisible,
  summarizeReplyTurn,
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
  formatUserTurnTip,
  loopTipRows,
  messageHeadEmpty,
  roundTipRows,
  summarizeLoop,
  userTurnTipRows,
} from "../message-meta";
import { roleLabelZh, roleMarkKind, roleTone } from "../visual-marks";
import { RoleAvatar } from "../icons/Marks";

/** 调试面板打开哪一份账本内容。 */
export type PayloadRequest = {
  /** request = 这一轮发出去的 POST；response = 这一轮收回来的内容（含 tool） */
  view: "request" | "response";
  /** 落盘 entry id（新会话有） */
  payloadId?: string;
  /** id 缺失时的回落定位：助手轮在全会话里的 0 基下标 */
  payloadIndex?: number;
  /** 面板标题用：#3 提问 / 第 2 轮 */
  title: string;
};

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
  /** 打开 POST 请求 / 返回内容调试面板；不传时编号只做展示不可点 */
  onInspectPayload?: (req: PayloadRequest) => void;
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
  lead,
}: {
  message: DraftMessage;
  onOpenTerminal?: WireThreadViewProps["onOpenTerminal"];
  /** 贴在气泡左上角的角标（用户提问编号方块） */
  lead?: React.ReactNode;
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
        {lead}
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
  onInspectPayload,
  expanded,
  foldable,
  onToggleFold,
}: {
  assistant: DraftMessage | null;
  internals: DraftMessage[];
  round: number;
  onInspectPayload?: WireThreadViewProps["onInspectPayload"];
  /** 本轮是否展开（最后一轮 / live / 用户点过）。LoopBlock 写。 */
  expanded: boolean;
  /** 更早轮次才出折叠行。 */
  foldable: boolean;
  onToggleFold?: () => void;
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
    cacheRead: assistant?.meta?.cacheRead,
    cacheWrite: assistant?.meta?.cacheWrite,
    cacheReported: assistant?.meta?.cacheReported,
    live,
  };
  const tip = formatRoundTip(tipInput);
  const payloadId = assistant?.meta?.payloadId;
  const payloadIndex = assistant?.meta?.payloadIndex;
  const inspectable =
    Boolean(onInspectPayload) && (Boolean(payloadId) || payloadIndex != null);
  const rows = [
    ...roundTipRows(tipInput),
    {
      label: "返回体",
      value: inspectable ? "点击查看" : live ? "待落盘" : "不可用",
    },
  ];
  const digits = String(round).length;
  const chipProps = {
    className: `wire-round-chip${live ? " is-live" : ""}${
      inspectable ? " is-inspectable" : ""
    }`,
    "data-round-chip": "",
    "data-digits": digits,
  } as const;
  const showBody =
    Boolean(assistant) && !isPlaceholderAssistantBody(assistant?.body);
  const hasColumn =
    orphan || thinkParts.length > 0 || showBody || otherInternals.length > 0;
  const folded = foldable && !expanded;
  const chipOnly = !hasColumn && expanded && !foldable;
  const summary = summarizeReplyTurn({
    kind: "reply",
    assistant,
    internals,
  });

  return (
    <div
      className={`wire-reply-turn${orphan ? " is-orphan" : ""}${
        live ? " is-live" : ""
      }${chipOnly ? " is-chip-only" : ""}${foldable ? " has-fold" : ""}${
        folded ? " is-folded" : ""
      }`}
      data-orphan={orphan ? "true" : "false"}
      data-round={round}
      data-turn-folded={folded ? "true" : "false"}
    >
      <InfoHover rows={rows} label={tip}>
        {inspectable ? (
          <button
            type="button"
            {...chipProps}
            aria-label={`第 ${round} 轮 · 查看本轮返回体`}
            title="查看本轮返回内容（含工具调用）"
            onClick={() =>
              onInspectPayload!({
                view: "response",
                ...(payloadId ? { payloadId } : {}),
                ...(payloadIndex != null ? { payloadIndex } : {}),
                title: `第 ${round} 轮`,
              })
            }
          >
            {round}
          </button>
        ) : (
          <span {...chipProps}>{round}</span>
        )}
      </InfoHover>
      {foldable ? (
        <button
          type="button"
          className="wire-turn-fold"
          data-turn-fold=""
          aria-expanded={!folded}
          aria-label={
            folded ? `展开第 ${round} 轮` : `收起第 ${round} 轮`
          }
          title={folded ? "展开此轮" : "收起此轮"}
          onClick={onToggleFold}
        >
          <span className="wire-turn-fold-text">{summary}</span>
          <span className="wire-turn-fold-mark" aria-hidden>
            {folded ? "▶" : "▼"}
          </span>
        </button>
      ) : null}
      {expanded && hasColumn ? (
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

/**
 * 用户提问的方块编号 —— 与下方轮次圆做法对齐（同一列、同一 InfoHover 语汇），
 * 方 vs 圆区分「我发出去的」与「模型跑的每一轮」。点开是本轮完整 POST 请求。
 */
function UserTurnMark({
  ordinal,
  summary,
  live,
  payloadId,
  payloadIndex,
  onInspectPayload,
}: {
  ordinal: number;
  summary: ReturnType<typeof summarizeLoop>;
  live: boolean;
  payloadId?: string;
  payloadIndex?: number;
  onInspectPayload?: WireThreadViewProps["onInspectPayload"];
}) {
  const inspectable =
    Boolean(onInspectPayload) && (Boolean(payloadId) || payloadIndex != null);
  const tipInput = {
    ...summary,
    ordinal,
    live,
    hasRequest: inspectable,
  };
  const rows = userTurnTipRows(tipInput);
  const label = formatUserTurnTip(tipInput);
  const digits = String(ordinal).length;
  const markProps = {
    className: `wire-user-chip${live ? " is-live" : ""}${
      inspectable ? " is-inspectable" : ""
    }`,
    "data-user-chip": "",
    "data-digits": digits,
  } as const;
  return (
    <InfoHover rows={rows} label={label} className="wire-user-chip-hover">
      {inspectable ? (
        <button
          type="button"
          {...markProps}
          aria-label={`第 ${ordinal} 条提问 · 查看本轮 POST 请求`}
          title="查看本轮发送的完整 POST 请求"
          onClick={(e) => {
            // 捕获阶段由 UserStick 放行 button；这里再挡一次冒泡，
            // 免得外层把「看请求体」当成「跳回提问」
            e.stopPropagation();
            onInspectPayload!({
              view: "request",
              ...(payloadId ? { payloadId } : {}),
              ...(payloadIndex != null ? { payloadIndex } : {}),
              title: `#${ordinal} 提问`,
            });
          }}
        >
          {ordinal}
        </button>
      ) : (
        <span {...markProps}>{ordinal}</span>
      )}
    </InfoHover>
  );
}

function repliesAreLive(replies: ReplyBlock[]): boolean {
  return replies.some(replyBlockLive);
}

function loopOpts(user: DraftMessage | null): {
  sentAt?: number;
  durationMs?: number;
} {
  return {
    ...(user?.meta?.ts != null ? { sentAt: user.meta.ts } : {}),
    ...(user?.meta?.durationMs != null ? { durationMs: user.meta.durationMs } : {}),
  };
}

function LoopFoot({
  replies,
  roundCount,
  user,
}: {
  replies: ReplyBlock[];
  roundCount: number;
  user: DraftMessage | null;
}) {
  const summary = { ...summarizeLoop(replies, loopOpts(user)), roundCount };
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

/** In-flow bar from the user box left edge through every round. Not sticky. */
function LoopSpine() {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const spine = ref.current;
    const host = spine?.parentElement;
    if (!spine || !host) return;

    const paint = () => {
      const stick = host.querySelector<HTMLElement>(".wire-user-stick");
      host.style.setProperty(
        "--user-stick-h",
        `${stick ? stick.offsetHeight : 0}px`,
      );
      const box = host.querySelector<HTMLElement>(
        ".wire-user-stick .bubble.user .msg-body",
      );
      const endEl =
        host.querySelector<HTMLElement>(
          ".wire-loop-rounds > .wire-reply-turn:last-child",
        ) ?? host.querySelector<HTMLElement>(".wire-loop-rounds");
      if (!box || !endEl) {
        spine.hidden = true;
        return;
      }
      const top = offsetInScroll(box, host);
      const end = offsetInScroll(endEl, host) + endEl.offsetHeight;
      spine.hidden = false;
      spine.style.top = `${top}px`;
      spine.style.bottom = "auto";
      spine.style.height = `${Math.max(0, end - top)}px`;
    };

    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(host);
    const stickEl = host.querySelector(".wire-user-stick");
    if (stickEl) ro.observe(stickEl);
    const rounds = host.querySelector(".wire-loop-rounds");
    if (rounds) ro.observe(rounds);
    return () => ro.disconnect();
  }, []);
  return <span className="wire-loop-spine" ref={ref} aria-hidden />;
}

function LoopBlock({
  user,
  replies,
  complete,
  onOpenTerminal,
  userOrdinal,
  live,
  onInspectPayload,
  foldOpen,
  setFoldOpen,
}: {
  user: DraftMessage | null;
  replies: ReplyBlock[];
  complete: boolean;
  onOpenTerminal?: WireThreadViewProps["onOpenTerminal"];
  /** 本会话第几条用户消息（1 基） */
  userOrdinal: number;
  live: boolean;
  onInspectPayload?: WireThreadViewProps["onInspectPayload"];
  foldOpen: Record<string, boolean>;
  setFoldOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const shown = replies.filter(replyTurnVisible);
  const showFoot = complete && shown.length > 0;
  const lastIdx = shown.length - 1;
  const foldPrefix = user?.id ?? "loop";
  const lastFoldKey =
    lastIdx >= 0
      ? `${foldPrefix}::${
          shown[lastIdx]!.assistant?.id ??
          shown[lastIdx]!.internals[0]?.id ??
          `reply-${lastIdx}`
        }`
      : null;
  const prevLastFoldKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    const prev = prevLastFoldKey.current;
    prevLastFoldKey.current = lastFoldKey;
    if (!prev || prev === lastFoldKey) return;
    setFoldOpen((m) => pinReleasedLastTurn(m, prev, lastFoldKey));
  }, [lastFoldKey]);
  // 用户发的那一份 POST 就是本轮首个 round 的请求体
  const firstAssistant = replies.find((r) => r.assistant)?.assistant ?? null;
  const mark = user ? (
    <UserTurnMark
      ordinal={userOrdinal}
      summary={summarizeLoop(replies, loopOpts(user))}
      live={live}
      payloadId={firstAssistant?.meta?.payloadId}
      payloadIndex={firstAssistant?.meta?.payloadIndex}
      onInspectPayload={onInspectPayload}
    />
  ) : null;
  return (
    <div
      className={`wire-loop${live ? " is-live" : ""}`}
      data-loop=""
      data-loop-complete={showFoot ? "true" : "false"}
      {...(user ? askAnchorProps(user.id, clipAskPreview(user.body)) : {})}
    >
      <LoopSpine />
      {user ? (
        <UserStick>
          <MessageRow
            message={user}
            onOpenTerminal={onOpenTerminal}
            lead={mark}
          />
        </UserStick>
      ) : null}
      {shown.length > 0 ? (
        <div className="wire-loop-rounds">
          {shown.map((block, i) => {
            const key =
              `${foldPrefix}::${
                block.assistant?.id ?? block.internals[0]?.id ?? `reply-${i}`
              }`;
            const isLast = i === lastIdx;
            const turnLive = replyBlockLive(block);
            const expanded = replyTurnOpen({
              isLastVisible: isLast,
              turnLive,
              loopLive: live,
              userOpen: key in foldOpen ? foldOpen[key] : undefined,
            });
            return (
              <AssistantTurn
                key={key}
                assistant={block.assistant}
                internals={block.internals}
                round={i + 1}
                onInspectPayload={onInspectPayload}
                expanded={expanded}
                foldable={replyTurnFoldable({
                  isLastVisible: isLast,
                  turnLive,
                })}
                onToggleFold={() =>
                  setFoldOpen((prev) => ({ ...prev, [key]: !expanded }))
                }
              />
            );
          })}
        </div>
      ) : null}
      {showFoot ? (
        <LoopFoot replies={replies} roundCount={shown.length} user={user} />
      ) : null}
    </div>
  );
}

/**
 * 用户提问编号：账本回填了 meta.ordinal 就用真值（分页只加载末尾也不会串号），
 * 没有回填时按可见 transcript 顺延，并从已知真值处对齐。
 */
export function userOrdinalMap(
  messages: readonly DraftMessage[],
): Map<string, number> {
  const users = messages.filter((m) => m.role === "user");
  let offset = 0;
  for (let i = 0; i < users.length; i++) {
    const known = users[i]!.meta?.ordinal;
    if (known != null && known > 0) {
      offset = known - (i + 1);
      break;
    }
  }
  const out = new Map<string, number>();
  users.forEach((m, i) => {
    out.set(m.id, Math.max(1, i + 1 + offset));
  });
  return out;
}

/** Shared thread list for draft ContextPanel parity */
export const WireThreadView = React.memo(function WireThreadView({
  messages,
  emptyTitle = "还没有消息",
  emptySub = "在下方输入开始对话。",
  onOpenTerminal,
  className = "",
  agentBusy = false,
  onInspectPayload,
}: WireThreadViewProps) {
  const blocks = groupThreadBlocks(messages);
  const segments = groupLoopTurns(blocks);
  const empty = messages.length === 0;
  const userOrdinals = userOrdinalMap(messages);
  const [foldOpen, setFoldOpen] = useState<Record<string, boolean>>({});
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
                <MessageRow
                  message={m}
                  onOpenTerminal={onOpenTerminal}
                  lead={
                    <UserTurnMark
                      ordinal={userOrdinals.get(m.id) ?? 1}
                      summary={summarizeLoop([], loopOpts(m))}
                      live={false}
                      onInspectPayload={onInspectPayload}
                    />
                  }
                />
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
            userOrdinal={
              seg.user ? (userOrdinals.get(seg.user.id) ?? 1) : 1
            }
            live={live}
            onInspectPayload={onInspectPayload}
            foldOpen={foldOpen}
            setFoldOpen={setFoldOpen}
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
    cacheRead?: number;
    cacheWrite?: number;
    cacheReported?: boolean;
    payloadId?: string;
    payloadIndex?: number;
    ordinal?: number;
    images?: Array<{ mimeType: string; data: string; name?: string }>;
  }>,
  opts?: { agentBusy?: boolean; agentName?: string },
): DraftMessage[] {
  const busy = Boolean(opts?.agentBusy);
  const agent = opts?.agentName || "coding";
  const visible = lines.filter(
    (l) =>
      !(l.role === "system" && isModelCallProgressText(l.text || "")),
  );
  let lastAssistantIdx = -1;
  for (let i = visible.length - 1; i >= 0; i--) {
    if (visible[i]!.role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }
  let lastThinkingAfterAsst = -1;
  const thinkFrom = lastAssistantIdx >= 0 ? lastAssistantIdx + 1 : 0;
  for (let i = thinkFrom; i < visible.length; i++) {
    if (visible[i]!.role === "thinking") lastThinkingAfterAsst = i;
  }
  let assistantRound = 0;
  return visible.map((l, idx) => {
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
        meta: {
          ...(l.startedAt != null ? { ts: l.startedAt } : {}),
          ...(l.durationMs != null ? { durationMs: l.durationMs } : {}),
        },
      };
    }
    if (l.role === "thinking") {
      const streaming = Boolean(busy && idx === lastThinkingAfterAsst);
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
      const streaming = busy && idx === lastAssistantIdx;
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
          ...(l.cacheRead != null ? { cacheRead: l.cacheRead } : {}),
          ...(l.cacheWrite != null ? { cacheWrite: l.cacheWrite } : {}),
          ...(l.cacheReported != null
            ? { cacheReported: l.cacheReported }
            : {}),
          ...(l.payloadId ? { payloadId: l.payloadId } : {}),
          ...(l.payloadIndex != null ? { payloadIndex: l.payloadIndex } : {}),
        },
      };
    }
    if (l.role === "user") {
      return {
        id: l.id,
        role: "user" as const,
        body: l.text || "",
        meta: {
          authorLabel: "user",
          ...(l.startedAt != null ? { ts: l.startedAt } : {}),
          ...(l.durationMs != null ? { durationMs: l.durationMs } : {}),
          ...(l.ordinal != null ? { ordinal: l.ordinal } : {}),
        },
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
