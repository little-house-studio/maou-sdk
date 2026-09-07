/**
 * Draft-aligned thread rendering: groupThreadBlocks + MessageRow / AssistantTurn.
 * Used by ContextPanel (fixtures) and live ChatPanel (wire chrome) for UI parity.
 */
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ASK_PREVIEW_MAX,
  MSG_ENTER_CLASS,
  UserMsgClip,
  UserStick,
  askAnchorProps,
  clipAskPreview,
  offsetInScroll,
  useEnterIds,
} from "../../conversation";
import type { DraftMessage } from "../types";
import {
  groupLoopTurns,
  groupThreadBlocks,
  isModelCallProgressText,
  isPlaceholderAssistantBody,
  replyBlockLive,
  formatReplyPackFold,
  formatReplyPackMeta,
  formatReplyTurnFold,
  packReplyStats,
  pickPlanReviewAnchorId,
  replyAnchorId,
  replyPackOpen,
  replyPackable,
  replyTurnFoldable,
  replyTurnOpen,
  replyTurnVisible,
  replyWaitStatus,
  reuseThreadSegments,
} from "./thread-blocks";
import type { ReplyBlock, ThreadSegment } from "./thread-blocks";
import { DraftMarkdown } from "../DraftMarkdown";
import { ToolCard } from "./ToolCard";
import { extractToolCallIntent } from "./tool-card";
import { InfoHover } from "./InfoHover";
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
} from "./message-meta";
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
  /** Session id; enter animation resets when this changes. */
  threadKey?: string;
  /** 计划报告挂在写出它的那一轮，不跟在整棵树后面。 */
  planReview?: ReactNode;
  /** 待审且线程里还没有 submit_plan 时，才跟到当前最后一轮。 */
  planReviewFollow?: boolean;
};

type ChatLineLike = {
  id: string;
  role: string;
  text: string;
  err?: boolean;
  terminalId?: string;
  agentName?: string;
  toolName?: string;
  toolCallId?: string;
  toolDescription?: string;
  toolArgs?: string;
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

const MessageRow = React.memo(function MessageRow({
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
  const textClass = `bubble-text${isTool ? " is-tool" : ""}${
    isErr ? " is-err" : ""
  }`;
  const body = isTool ? (
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
  );

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
        {message.role === "user" ? (
          <UserMsgClip className={textClass}>{body}</UserMsgClip>
        ) : (
          <div className={textClass}>{body}</div>
        )}
      </div>
    </div>
  );
}, (prev, next) => prev.message === next.message && prev.onOpenTerminal === next.onOpenTerminal);

function useLiveNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** 思考行：默认折叠；头栏 = 图标动画 · Thought · 耗时 · token · 折叠 */
function ThinkingPart({ message }: { message: DraftMessage }) {
  const [thinkOpen, setThinkOpen] = useState(false);
  const streaming = Boolean(message.thinking?.streaming);
  const now = useLiveNow(streaming);
  const fallbackStart = useRef<number | null>(null);
  if (streaming && fallbackStart.current == null) {
    fallbackStart.current = now;
  }

  const collapsed = !thinkOpen;
  const startedAt =
    message.thinking?.startedAt ??
    (streaming ? fallbackStart.current ?? now : undefined);
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
            streaming={streaming}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Same gray think strip, ticking while the model or a tool has not returned. */
function WaitStatus({
  label,
  startedAt,
}: {
  label: string;
  startedAt?: number;
}) {
  const now = useLiveNow(true);
  const startRef = useRef(startedAt ?? now);
  if (startedAt != null) startRef.current = startedAt;
  const durLabel = durationStr(Math.max(0, now - startRef.current)) || "0ms";
  return (
    <div
      className="wire-internal-part role-thinking tone-warn is-streaming is-wait"
      data-thinking="true"
      data-thinking-streaming="true"
      data-wait=""
      data-live-cursor=""
    >
      <div className="wire-think-head" role="status" aria-live="polite">
        <span className="wire-think-icon is-spin" aria-hidden>
          <RoleAvatar kind="thinking" size={14} title={label} />
        </span>
        <span className="wire-think-label">{label}</span>
        <span className="wire-think-meta wire-think-dur">{durLabel}</span>
      </div>
    </div>
  );
}

/** memo：AssistantTurn 的秒表每 500ms 重渲染一次，工具卡 / 思考行没变就别跟着重画。 */
const InternalPart = React.memo(function InternalPart({
  message,
}: {
  message: DraftMessage;
}) {
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
});

const AssistantTurn = React.memo(function AssistantTurn({
  assistant,
  internals,
  round,
  onInspectPayload,
  expanded,
  foldable,
  onToggleFold,
  loopLive = false,
  packedAway = false,
  planReview = null,
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
  loopLive?: boolean;
  /** 总包收起：整轮藏起来，正文仍挂着。 */
  packedAway?: boolean;
  planReview?: ReactNode;
}) {
  const orphan = !assistant;
  const thinkParts = internals.filter((m) => m.role === "thinking");
  const otherInternals = internals.filter((m) => m.role !== "thinking");
  const wait = replyWaitStatus(
    { kind: "reply", assistant, internals },
    loopLive,
  );
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
  const live = Boolean(head.live) || loopLive || Boolean(wait);
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
    thinkParts.length > 0 ||
    showBody ||
    otherInternals.length > 0 ||
    Boolean(wait);
  const waitOnly =
    Boolean(wait) &&
    !showBody &&
    thinkParts.length === 0 &&
    otherInternals.length === 0;
  const folded = foldable && !expanded;
  const showLiveCursor =
    live &&
    expanded &&
    !folded &&
    !wait &&
    (showBody || otherInternals.length > 0 || thinkParts.length > 0);
  const chipOnly = !hasColumn && !planReview && expanded && !foldable;
  const summary = formatReplyTurnFold({
    kind: "reply",
    assistant,
    internals,
  });

  return (
    <div
      className={`wire-reply-turn${orphan ? " is-orphan" : ""}${
        live ? " is-live" : ""
      }${chipOnly ? " is-chip-only" : ""}${hasColumn ? " has-body" : ""}${
        planReview ? " has-plan" : ""
      }${foldable ? " has-fold" : ""}${folded ? " is-folded" : ""}${
        packedAway ? " is-pack-away" : ""
      }`}
      data-orphan={orphan ? "true" : "false"}
      data-round={round}
      data-turn-folded={folded ? "true" : "false"}
      data-pack-away={packedAway ? "true" : undefined}
      hidden={packedAway || undefined}
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
      {hasColumn ? (
        <div
          className={`bubble codex-bubble wire-msg assistant${
            orphan ? " is-orphan" : ""
          }${live ? " is-live" : ""}${waitOnly ? " is-wait-only" : ""}`}
          data-msg-id={assistant?.id}
          data-msg-role={assistant ? "assistant" : "orphan"}
          data-turn-body=""
          hidden={folded || packedAway || undefined}
        >
          <div className="msg-body wire-reply-body">
            {orphan && (thinkParts.length > 0 || otherInternals.length > 0) ? (
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

            {wait ? (
              <div
                className="wire-reply-internals wire-reply-thinking"
                data-count="1"
                data-wait-strip=""
              >
                <WaitStatus label={wait.label} startedAt={wait.startedAt} />
              </div>
            ) : null}

            {showBody ? (
              <div className="bubble-text">
                <DraftMarkdown
                  source={assistant!.body}
                  streaming={Boolean(assistant!.meta?.streaming)}
                />
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

            {showLiveCursor ? (
              <span
                className="wire-live-cursor"
                data-live-cursor=""
                role="status"
                aria-label="正在生成"
              >
                <span className="wire-think-icon is-spin" aria-hidden>
                  <RoleAvatar kind="thinking" size={12} title="正在生成" />
                </span>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      {planReview ? (
        <div className="wire-reply-plan" data-plan-in-thread="">
          {planReview}
        </div>
      ) : null}
    </div>
  );
}, (prev, next) => (
  prev.assistant === next.assistant &&
  prev.internals.length === next.internals.length &&
  prev.internals.every((m, i) => m === next.internals[i]) &&
  prev.round === next.round &&
  prev.expanded === next.expanded &&
  prev.foldable === next.foldable &&
  prev.packedAway === next.packedAway &&
  prev.loopLive === next.loopLive &&
  prev.planReview === next.planReview &&
  prev.onInspectPayload === next.onInspectPayload
));

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

function ReplyPackFold({
  blocks,
  fromRound,
  toRound,
  open,
  onToggle,
}: {
  blocks: ReplyBlock[];
  fromRound: number;
  toRound: number;
  open: boolean;
  onToggle: () => void;
}) {
  const stats = packReplyStats(blocks);
  const summary = formatReplyPackFold(blocks);
  const meta = formatReplyPackMeta(blocks);
  const dur = durationStr(stats.durationMs);
  return (
    <div
      className={`wire-reply-pack${open ? " is-open" : ""}`}
      data-reply-pack=""
      data-pack-folded={open ? "false" : "true"}
      data-pack-from={fromRound}
      data-pack-to={toRound}
    >
      <InfoHover
        rows={[
          { label: "轮次", value: `${fromRound}–${toRound}` },
          { label: "用时", value: dur || "—" },
          { label: "工具", value: String(stats.toolCount) },
        ]}
        label={summary}
      >
        <button
          type="button"
          className="wire-reply-pack-toggle"
          data-reply-pack-fold=""
          aria-expanded={open}
          aria-label={
            open
              ? `收起第 ${fromRound} 到 ${toRound} 轮`
              : `展开第 ${fromRound} 到 ${toRound} 轮`
          }
          onClick={onToggle}
        >
          <span className="wire-pack-chevron" aria-hidden>
            ▶
          </span>
          <span className="wire-pack-meta" data-pack-meta="">
            {meta}
          </span>
        </button>
      </InfoHover>
    </div>
  );
}

/**
 * memo：段对象经 reuseThreadSegments 复用后，只有正在变的那一 loop 会重渲染。
 * 依赖默认浅比较 —— 所有 props 在内容不变时都保持引用稳定（foldOpen 例外，
 * 它是整棵树共享的折叠表，翻一次所有 loop 一起刷，和从前一致）。
 */
const LoopBlock = React.memo(function LoopBlock({
  user,
  replies,
  complete,
  onOpenTerminal,
  userOrdinal,
  live,
  onInspectPayload,
  foldOpen,
  setFoldOpen,
  enter = false,
  planReview = null,
  planAnchorId = null,
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
  enter?: boolean;
  planReview?: ReactNode;
  planAnchorId?: string | null;
}) {
  const shown = replies.filter((block, i) => {
    if (planAnchorId && replyAnchorId(block) === planAnchorId) return true;
    return replyTurnVisible(block, live && i === replies.length - 1);
  });
  const showFoot = complete && shown.length > 0;
  const lastIdx = shown.length - 1;
  const foldPrefix = user?.id ?? "loop";
  const packKey = `${foldPrefix}::__pack`;
  const foldableBlocks = shown.filter((block, i) => {
    if (planReview && planAnchorId && replyAnchorId(block) === planAnchorId) {
      return false;
    }
    return replyTurnFoldable({
      isLastVisible: i === lastIdx,
      turnLive: replyBlockLive(block),
    });
  });
  const packable = replyPackable(foldableBlocks.length);
  const packedOpen = replyPackOpen({
    packable,
    userOpen: packKey in foldOpen ? foldOpen[packKey] : undefined,
  });
  const packFrom = packable ? shown.indexOf(foldableBlocks[0]!) + 1 : 0;
  const packTo = packable
    ? shown.indexOf(foldableBlocks[foldableBlocks.length - 1]!) + 1
    : 0;
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
      className={`wire-loop${live ? " is-live" : ""}${
        enter ? ` ${MSG_ENTER_CLASS}` : ""
      }`}
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
          {packable ? (
            <div
              className={`wire-reply-pack-block${
                packedOpen ? " is-open" : ""
              }`}
              data-reply-pack-block=""
              data-pack-open={packedOpen ? "true" : "false"}
            >
              <ReplyPackFold
                blocks={foldableBlocks}
                fromRound={packFrom}
                toRound={packTo}
                open={packedOpen}
                onToggle={() =>
                  setFoldOpen((prev) => ({ ...prev, [packKey]: !packedOpen }))
                }
              />
            </div>
          ) : null}
          {shown.map((block, i) => {
            const key =
              `${foldPrefix}::${
                block.assistant?.id ?? block.internals[0]?.id ?? `reply-${i}`
              }`;
            const isLast = i === lastIdx;
            const turnLive = replyBlockLive(block);
            const foldable = replyTurnFoldable({
              isLastVisible: isLast,
              turnLive,
            });
            const holdPlan =
              Boolean(planReview) &&
              Boolean(planAnchorId) &&
              replyAnchorId(block) === planAnchorId;
            const packedAway =
              packable && foldable && !packedOpen && !holdPlan;
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
                foldable={foldable}
                packedAway={packedAway}
                loopLive={live && isLast}
                onToggleFold={() =>
                  setFoldOpen((prev) => ({ ...prev, [key]: !expanded }))
                }
                planReview={holdPlan ? planReview : null}
              />
            );
          })}
        </div>
      ) : live ? (
        <div className="wire-loop-rounds">
          <AssistantTurn
            assistant={null}
            internals={[]}
            round={1}
            onInspectPayload={onInspectPayload}
            expanded
            foldable={false}
            loopLive
            planReview={!planAnchorId ? planReview : null}
          />
        </div>
      ) : null}
      {showFoot ? (
        <LoopFoot replies={replies} roundCount={shown.length} user={user} />
      ) : null}
    </div>
  );
});

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
  threadKey = "",
  planReview = null,
  planReviewFollow = false,
}: WireThreadViewProps) {
  // 结构复用：没变的 loop 沿用上一份 segment（含 replies 数组），LoopBlock 的 memo 才有用。
  const segmentsRef = useRef<ThreadSegment[]>([]);
  const segments = useMemo(() => {
    const next = reuseThreadSegments(
      segmentsRef.current,
      groupLoopTurns(groupThreadBlocks(messages)),
    );
    segmentsRef.current = next;
    return next;
  }, [messages]);
  const planAnchorId = useMemo(
    () =>
      planReview
        ? pickPlanReviewAnchorId(segments, { fallback: planReviewFollow })
        : null,
    [planReview, planReviewFollow, segments],
  );
  const placePlan = Boolean(planReview) && (Boolean(planAnchorId) || planReviewFollow);
  const empty = messages.length === 0;
  const userOrdinals = useMemo(() => userOrdinalMap(messages), [messages]);
  const userIds = useMemo(
    () => messages.filter((m) => m.role === "user").map((m) => m.id),
    [messages],
  );
  const enterIds = useEnterIds(threadKey, userIds);
  const [foldOpen, setFoldOpen] = useState<Record<string, boolean>>({});
  const lastLoopIdx = (() => {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i]!.kind === "loop") return i;
    }
    return -1;
  })();

  if (empty) {
    return (
      <>
        <div className={`wire-empty-hero empty-hint ${className}`.trim()}>
          <p className="wire-empty-k">空单元</p>
          <h2 className="empty-title">{emptyTitle}</h2>
          <p className="empty-sub">{emptySub}</p>
        </div>
        {placePlan ? planReview : null}
      </>
    );
  }

  return (
    <>
      <div className="wire-thread-lead" aria-hidden />
      {segments.map((seg, i) => {
        if (seg.kind === "solo") {
          const m = seg.message;
          if (m.role === "user") {
            if (i === segments.length - 1 && agentBusy) {
              return (
                <LoopBlock
                  key={m.id}
                  user={m}
                  replies={[]}
                  complete={false}
                  onOpenTerminal={onOpenTerminal}
                  userOrdinal={userOrdinals.get(m.id) ?? 1}
                  live
                  onInspectPayload={onInspectPayload}
                  foldOpen={foldOpen}
                  setFoldOpen={setFoldOpen}
                  enter={enterIds.has(m.id)}
                  planReview={placePlan ? planReview : null}
                  planAnchorId={planAnchorId}
                />
              );
            }
            return (
              <UserStick
                key={m.id}
                className={enterIds.has(m.id) ? MSG_ENTER_CLASS : ""}
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
            enter={Boolean(seg.user && enterIds.has(seg.user.id))}
            planReview={placePlan ? planReview : null}
            planAnchorId={planAnchorId}
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
  lines: ChatLineLike[],
  opts?: {
    agentBusy?: boolean;
    agentName?: string;
    reuse?: {
      lines: readonly ChatLineLike[];
      messages: readonly DraftMessage[];
      agentBusy?: boolean;
      agentName?: string;
    };
  },
): DraftMessage[] {
  const busy = Boolean(opts?.agentBusy);
  const agent = opts?.agentName || "coding";
  const reuse = opts?.reuse;
  const canReuse =
    reuse &&
    reuse.agentBusy === busy &&
    (reuse.agentName || "coding") === agent;
  const previousLineById = canReuse
    ? new Map(reuse.lines.map((line) => [line.id, line]))
    : undefined;
  const previousMessageById = canReuse
    ? new Map(reuse.messages.map((message) => [message.id, message]))
    : undefined;
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
    // A streaming update normally replaces only the tail ChatLine object.
    // Reuse the already mapped DraftMessage for every unchanged line. The
    // two streaming flags are the only derived values that can change while
    // the source object remains identical (for example when a new turn is
    // appended or busy changes).
    const previousLine = previousLineById?.get(l.id);
    const previousMessage = previousMessageById?.get(l.id);
    const expectedStreaming =
      l.role === "assistant"
        ? busy && idx === lastAssistantIdx
        : l.role === "thinking"
          ? busy && idx === lastThinkingAfterAsst
          : undefined;
    const previousStreaming =
      previousMessage?.role === "assistant"
        ? previousMessage.meta?.streaming
        : previousMessage?.role === "thinking"
          ? previousMessage.thinking?.streaming
          : undefined;
    if (
      previousLine === l &&
      previousMessage &&
      (expectedStreaming === undefined || expectedStreaming === previousStreaming)
    ) {
      if (l.role === "assistant") assistantRound += 1;
      return previousMessage;
    }
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
          args: (l.toolArgs || "").trim() || undefined,
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

function sameDraftMeta(
  a?: DraftMessage["meta"],
  b?: DraftMessage["meta"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    a.ts === b.ts &&
    a.durationMs === b.durationMs &&
    a.usageInput === b.usageInput &&
    a.usageOutput === b.usageOutput &&
    a.round === b.round &&
    a.streaming === b.streaming &&
    a.payloadId === b.payloadId &&
    a.payloadIndex === b.payloadIndex &&
    a.ordinal === b.ordinal &&
    a.cacheRead === b.cacheRead &&
    a.cacheWrite === b.cacheWrite &&
    a.cacheReported === b.cacheReported
  );
}

function sameDraftTool(
  a?: DraftMessage["tool"],
  b?: DraftMessage["tool"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    a.name === b.name &&
    a.result === b.result &&
    a.done === b.done &&
    a.isError === b.isError &&
    a.durationMs === b.durationMs &&
    a.description === b.description
  );
}

function sameDraftThinking(
  a?: DraftMessage["thinking"],
  b?: DraftMessage["thinking"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    a.streaming === b.streaming &&
    a.durationMs === b.durationMs &&
    a.outputTokens === b.outputTokens &&
    a.startedAt === b.startedAt
  );
}

/** 渲染字段没变就沿用上一份对象，避免整树跟发送/busy 一起重挂。 */
export function reuseDraftMessages(
  prev: readonly DraftMessage[],
  next: readonly DraftMessage[],
): DraftMessage[] {
  if (prev.length === 0) return next.slice();
  let kept = 0;
  const out = next.map((m, i) => {
    const p = prev[i];
    if (
      p &&
      p.id === m.id &&
      p.role === m.role &&
      p.body === m.body &&
      p.tag === m.tag &&
      p.agentName === m.agentName &&
      p.toolCallId === m.toolCallId &&
      p.images === m.images &&
      sameDraftMeta(p.meta, m.meta) &&
      sameDraftTool(p.tool, m.tool) &&
      sameDraftThinking(p.thinking, m.thinking)
    ) {
      kept += 1;
      return p;
    }
    return m;
  });
  return kept === next.length && prev.length === next.length
    ? (prev as DraftMessage[])
    : out;
}
