import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DraftAgent,
  DraftApproval,
  DraftMessage,
  DraftMeta,
} from "../types";
import { ApprovalBanner } from "./ApprovalBanner";
import { ComposerBar } from "./ComposerBar";
import { ToolCard } from "./ToolCard";
import { DraftMarkdown } from "../DraftMarkdown";
import { groupThreadBlocks } from "../thread-blocks";
import {
  buildPrevUserJumpLabel,
  measureScrollFromBottom,
  pickOlderUser,
  scrollTopToAlignMessage,
  shouldShowBackToBottom,
  shouldShowJumpBar,
  shouldStickToBottom,
  type UserLayoutEntry,
} from "../jump-prev-user";
import {
  formatMessageHead,
  formatThinkingHead,
} from "../message-meta";
import { roleLabelZh, roleMarkKind, roleTone } from "../visual-marks";
import { RoleAvatar, StatusMark } from "../icons/Marks";

export type ContextPanelProps = {
  messages: DraftMessage[];
  agentBusy: boolean;
  pendingApproval: DraftApproval | null;
  hasActiveSession: boolean;
  draftInput: string;
  meta: DraftMeta;
  statusHint: string;
  usageLabel: string;
  agents: DraftAgent[];
  onApprovalDecision: (d: "once" | "always" | "deny" | "blacklist") => void;
  onDraftInputChange: (v: string) => void;
  onSend: () => void;
  onRetryLast: () => void;
  onCopyTranscript: () => void;
  onAgentChange: (agentId: string) => void;
  onApprovalModeChange: (mode: string) => void;
  /** Draft local stop — clears busy without live agent. */
  onStop?: () => void;
};

/**
 * 上下文：用户块 / 助手回复树（thinking·tool·err 嵌套）/ 孤儿内部组 / Markdown。
 * 结构只来自 groupThreadBlocks；样式靠 role / nest / orphan 语义类。
 */
export function ContextPanel({
  messages,
  agentBusy,
  pendingApproval,
  hasActiveSession,
  draftInput,
  meta,
  statusHint,
  usageLabel,
  agents,
  onApprovalDecision,
  onDraftInputChange,
  onSend,
  onRetryLast,
  onCopyTranscript,
  onAgentChange,
  onApprovalModeChange,
  onStop,
}: ContextPanelProps) {
  const empty = messages.length === 0;
  const canRetry = messages.some((m) => m.role === "user");
  const blocks = useMemo(() => groupThreadBlocks(messages), [messages]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gluedRef = useRef(true);
  const threadHeadId = messages[0]?.id ?? "empty";
  const [fromBottom, setFromBottom] = useState(0);
  const [jumpLabel, setJumpLabel] = useState("↑ 上一条 user（点击）");
  const [jumpTargetId, setJumpTargetId] = useState<string | null>(null);

  const measureUsers = useCallback((): UserLayoutEntry[] => {
    const root = scrollRef.current;
    if (!root) return [];
    const nodes = root.querySelectorAll<HTMLElement>("[data-msg-role='user']");
    const rootTop = root.getBoundingClientRect().top;
    const entries: UserLayoutEntry[] = [];
    nodes.forEach((node) => {
      const id = node.dataset.msgId;
      if (!id) return;
      const rect = node.getBoundingClientRect();
      // top relative to scroll content (scrollTop + viewport offset)
      const top = rect.top - rootTop + root.scrollTop;
      // Prefer short data preview; fall back to visible text (avoid huge data-* attrs)
      const body =
        node.dataset.msgPreview ??
        node.querySelector(".bubble-text")?.textContent ??
        "";
      entries.push({
        id,
        body,
        top,
        height: rect.height,
      });
    });
    return entries;
  }, []);

  const refreshJumpState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fb = measureScrollFromBottom(el);
    setFromBottom(fb);
    gluedRef.current = shouldStickToBottom(fb);
    const older = pickOlderUser(measureUsers(), el.scrollTop);
    if (older) {
      setJumpTargetId(older.id);
      setJumpLabel(buildPrevUserJumpLabel(older.body, 48));
    } else {
      setJumpTargetId(null);
      setJumpLabel("↑ 上一条 user（点击）");
    }
  }, [measureUsers]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    refreshJumpState();
    const onScroll = () => refreshJumpState();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => refreshJumpState())
      : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro?.disconnect();
    };
  }, [refreshJumpState, messages]);

  // New thread (session switch / empty→first): always start at live tail
  useEffect(() => {
    gluedRef.current = true;
  }, [threadHeadId]);

  // Pin to live tail when user is near bottom (chat UX; don't yank while reading history)
  useEffect(() => {
    if (!gluedRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const pin = () => {
      el.scrollTop = el.scrollHeight;
      refreshJumpState();
    };
    // Double rAF: wait for DOM/layout after message paint
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(pin);
    });
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, [messages, agentBusy, pendingApproval, refreshJumpState]);

  const showJump = shouldShowJumpBar(empty, fromBottom);
  const showBack = shouldShowBackToBottom(empty, fromBottom);

  const jumpPrevUser = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const older = pickOlderUser(measureUsers(), el.scrollTop);
    if (!older) {
      // CLI fallback: step half viewport
      el.scrollTop = Math.max(0, el.scrollTop - el.clientHeight / 2);
      refreshJumpState();
      return;
    }
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = scrollTopToAlignMessage(older.top, max);
    refreshJumpState();
  }, [measureUsers, refreshJumpState]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    gluedRef.current = true;
    refreshJumpState();
  }, [refreshJumpState]);

  return (
    <section
      className={[
        "wire-context",
        "chat-panel",
        "codex-chat",
        agentBusy ? "has-busy" : "",
        pendingApproval ? "has-approval" : "",
        showJump ? "has-jump" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="上下文"
    >
      {/*
        Top chrome: only jump-to-prev when scrolled.
        Busy / tasks live in bottom dock (agent + 任务); stop on composer.
      */}
      {showJump ? (
        <button
          type="button"
          className="wire-jump-prev"
          onClick={jumpPrevUser}
          title={jumpTargetId ? `跳转到 ${jumpTargetId}` : "上一条用户消息"}
          aria-label={jumpLabel}
        >
          <span className="wire-jump-prev-text">{jumpLabel}</span>
        </button>
      ) : null}

      <div className="codex-thread-scroll wire-thread-scroll">
        <div
          ref={scrollRef}
          className="wire-context-scroll chat-log codex-log"
          role="log"
        >
          {empty ? (
            <div className="bubble codex-bubble system empty-hint">
              <div className="msg-body">
                <div className="empty-title">
                  {hasActiveSession ? "还没有消息" : "未选择会话"}
                </div>
                <div className="empty-sub">
                  {hasActiveSession
                    ? "在下方输入开始对话。消息只保存在本地。"
                    : "在左侧新建会话，或从场景目录加载假数据。"}
                </div>
              </div>
            </div>
          ) : (
            blocks.map((block) => {
              if (block.kind === "solo") {
                return (
                  <MessageRow key={block.message.id} message={block.message} />
                );
              }
              return (
                <AssistantTurn
                  key={
                    block.assistant?.id ??
                    block.internals[0]?.id ??
                    "reply"
                  }
                  assistant={block.assistant}
                  internals={block.internals}
                />
              );
            })
          )}
        </div>
      </div>

      {/* CLI show_back — return to live tail */}
      {showBack ? (
        <button
          type="button"
          className="wire-jump-bottom"
          onClick={scrollToBottom}
          title="回到底部"
          aria-label="回到底部"
        >
          ↓ 回到底部
        </button>
      ) : null}

      <div className="wire-float wire-float-bottom">
        {pendingApproval ? (
          <ApprovalBanner
            approval={pendingApproval}
            onDecision={onApprovalDecision}
          />
        ) : null}
        <ComposerBar
          draftInput={draftInput}
          agentBusy={agentBusy}
          pendingApproval={Boolean(pendingApproval)}
          meta={meta}
          statusHint={statusHint}
          usageLabel={usageLabel}
          hasActiveSession={hasActiveSession}
          agents={agents}
          canRetry={canRetry}
          onDraftInputChange={onDraftInputChange}
          onSend={onSend}
          onRetryLast={onRetryLast}
          onCopyTranscript={onCopyTranscript}
          onAgentChange={onAgentChange}
          onApprovalModeChange={onApprovalModeChange}
          onStop={onStop}
        />
      </div>
    </section>
  );
}

function MessageRow({ message }: { message: DraftMessage }) {
  const rKind = roleMarkKind(message.role);
  const label = roleLabelZh(rKind, message.tag);
  const tone = roleTone(rKind);
  const isTool = message.role === "tool";
  const isSystem = message.role === "system";
  const isErr = message.role === "err";
  const head = formatMessageHead(message);

  return (
    <div
      className={[
        "bubble",
        "codex-bubble",
        "wire-msg",
        message.role,
        `tone-${tone}`,
        isTool && message.clickable ? "clickable" : "",
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
          ? message.body.replace(/\s+/g, " ").trim().slice(0, 120)
          : undefined
      }
    >
      <div className={`msg-avatar-wrap tone-${tone}`} aria-hidden>
        <RoleAvatar kind={rKind} size={16} title={label} />
      </div>
      <div className="msg-body">
        {/* Tool cards bring their own CLI title chip */}
        {!isTool ? (
          <MessageHeadLine head={head} fallbackLabel={label} />
        ) : null}
        <div
          className={`bubble-text${isTool ? " is-tool" : ""}${
            isErr ? " is-err" : ""
          }`}
        >
          {isTool ? (
            <ToolCard message={message} />
          ) : (
            <DraftMarkdown source={message.body} />
          )}
        </div>
      </div>
    </div>
  );
}

function MessageHeadLine({
  head,
  fallbackLabel,
}: {
  head: ReturnType<typeof formatMessageHead>;
  fallbackLabel: string;
}) {
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
      title={fallbackLabel}
    >
      <span className="msg-head-logo" aria-hidden>
        {head.logo}
      </span>
      <span className="msg-head-text">{head.text}</span>
      {head.live ? <span className="msg-head-live">LIVE</span> : null}
      {head.queued ? <span className="msg-head-badge">queued</span> : null}
    </div>
  );
}

/** 助手回复：正文 + 内嵌 thinking / tool / err；无 assistant 时为孤儿内部组 */
function AssistantTurn({
  assistant,
  internals,
}: {
  assistant: DraftMessage | null;
  internals: DraftMessage[];
}) {
  const orphan = !assistant;
  const head = assistant
    ? formatMessageHead(assistant)
    : {
        logo: "·",
        text: "内部步骤",
        live: false,
        streaming: false,
        isError: false,
        queued: false,
      };
  return (
    <div
      className={`wire-reply-turn${orphan ? " is-orphan" : ""}${
        head.live ? " is-live" : ""
      }`}
      data-orphan={orphan ? "true" : "false"}
    >
      <div
        className={`bubble codex-bubble wire-msg assistant${
          orphan ? " is-orphan" : ""
        }${head.live ? " is-live" : ""}`}
        data-msg-id={assistant?.id}
        data-msg-role={assistant ? "assistant" : "orphan"}
      >
        <div
          className={`msg-avatar-wrap tone-${orphan ? "muted" : "accent"}`}
          aria-hidden
        >
          {orphan ? (
            <StatusMark kind="queued" size={14} title="内部步骤" />
          ) : (
            <RoleAvatar kind="assistant" size={16} title="助手" />
          )}
        </div>
        <div className="msg-body wire-reply-body">
          {assistant ? (
            <>
              <MessageHeadLine head={head} fallbackLabel="助手" />
              <div className="bubble-text">
                <DraftMarkdown source={assistant.body} />
              </div>
            </>
          ) : (
            <div className="msg-role wire-orphan-label">内部步骤</div>
          )}
          {internals.length > 0 ? (
            <div
              className="wire-reply-internals"
              data-count={internals.length}
            >
              {internals.map((part) => (
                <InternalPart key={part.id} message={part} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
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
  const [thinkOpen, setThinkOpen] = useState(
    () =>
      Boolean(message.thinking?.streaming) ||
      message.thinking?.collapsed === false,
  );

  /* CLI: tools are ToolCards under the assistant */
  if (isTool) {
    return (
      <div className="wire-internal-part role-tool tone-accent is-tool-card">
        <ToolCard message={message} />
      </div>
    );
  }

  if (isThinking) {
    const streaming = Boolean(message.thinking?.streaming);
    const collapsed = !thinkOpen && !streaming;
    const head = formatThinkingHead(message.body, {
      durationMs: message.thinking?.durationMs ?? message.meta?.durationMs,
      streaming,
      collapsed,
    });
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
      >
        <button
          type="button"
          className="wire-think-head"
          onClick={() => {
            if (!streaming) setThinkOpen((v) => !v);
          }}
          aria-expanded={!collapsed}
          disabled={streaming}
        >
          {head}
        </button>
        {!collapsed ? (
          <div className="wire-internal-body is-thinking">
            <DraftMarkdown source={message.body} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={[
        "wire-internal-part",
        `role-${message.role}`,
        `tone-${tone}`,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="wire-internal-head">
        {isErr ? (
          <StatusMark kind="error" size={11} title={label} />
        ) : (
          <RoleAvatar kind={rKind} size={14} title={label} />
        )}
        <span className="wire-internal-label">{label}</span>
      </div>
      <div className={`wire-internal-body${isErr ? " is-err" : ""}`}>
        <DraftMarkdown source={message.body} />
      </div>
    </div>
  );
}
