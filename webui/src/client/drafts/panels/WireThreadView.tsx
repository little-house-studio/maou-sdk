/**
 * Draft-aligned thread rendering: groupThreadBlocks + MessageRow / AssistantTurn.
 * Used by ContextPanel (fixtures) and live ChatPanel (wire chrome) for UI parity.
 */
import React, { useState } from "react";
import type { DraftMessage } from "../types";
import { groupThreadBlocks } from "../thread-blocks";
import { DraftMarkdown } from "../DraftMarkdown";
import { ToolCard } from "./ToolCard";
import {
  formatMessageHead,
  formatThinkingHead,
} from "../message-meta";
import { roleLabelZh, roleMarkKind, roleTone } from "../visual-marks";
import { RoleAvatar, StatusMark } from "../icons/Marks";

export type WireThreadViewProps = {
  messages: DraftMessage[];
  /** Empty-state titles when messages.length === 0 */
  emptyTitle?: string;
  emptySub?: string;
  /** Open agent terminal from tool card click (optional) */
  onOpenTerminal?: (id: string, agentName?: string) => void;
  className?: string;
  scrollRef?: React.Ref<HTMLDivElement>;
};

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

function MessageRow({
  message,
  onOpenTerminal,
}: {
  message: DraftMessage;
  onOpenTerminal?: WireThreadViewProps["onOpenTerminal"];
}) {
  const rKind = roleMarkKind(message.role);
  const label = roleLabelZh(rKind, message.tag);
  const tone = roleTone(rKind);
  const isTool = message.role === "tool";
  const isSystem = message.role === "system";
  const isErr = message.role === "err";
  const head = formatMessageHead(message);
  const termId = message.tool?.name === "terminal" ? message.tag : undefined;

  return (
    <div
      className={[
        "bubble",
        "codex-bubble",
        "wire-msg",
        message.role,
        `tone-${tone}`,
        isTool && (message.clickable || termId) ? "clickable" : "",
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
      onClick={() => {
        if (termId && onOpenTerminal) onOpenTerminal(termId);
      }}
      title={termId ? `打开终端 ${termId}` : undefined}
    >
      <div className={`msg-avatar-wrap tone-${tone}`} aria-hidden>
        <RoleAvatar kind={rKind} size={16} title={label} />
      </div>
      <div className="msg-body">
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
        isErr ? "is-err" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="wire-internal-label">
        <RoleAvatar kind={rKind} size={14} title={label} />
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

/** Shared thread list for draft ContextPanel parity */
export function WireThreadView({
  messages,
  emptyTitle = "还没有消息",
  emptySub = "在下方输入开始对话。",
  onOpenTerminal,
  className = "",
  scrollRef,
}: WireThreadViewProps) {
  const blocks = groupThreadBlocks(messages);
  const empty = messages.length === 0;

  return (
    <div
      ref={scrollRef}
      className={`wire-context-scroll chat-log codex-log ${className}`.trim()}
      role="log"
    >
      {empty ? (
        <div className="bubble codex-bubble system empty-hint">
          <div className="msg-body">
            <div className="empty-title">{emptyTitle}</div>
            <div className="empty-sub">{emptySub}</div>
          </div>
        </div>
      ) : (
        blocks.map((block) => {
          if (block.kind === "solo") {
            return (
              <MessageRow
                key={block.message.id}
                message={block.message}
                onOpenTerminal={onOpenTerminal}
              />
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
  );
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
  }>,
  opts?: { agentBusy?: boolean; agentName?: string },
): DraftMessage[] {
  const busy = Boolean(opts?.agentBusy);
  const agent = opts?.agentName || "coding";
  return lines.map((l) => {
    if (l.err) {
      return {
        id: l.id,
        role: "err" as const,
        body: l.text || "",
        meta: { authorLabel: "error" },
      };
    }
    if (l.role === "tool") {
      return {
        id: l.id,
        role: "tool" as const,
        body: l.text || "",
        tag: l.terminalId || undefined,
        clickable: Boolean(l.terminalId),
        tool: {
          name: l.terminalId ? "terminal" : "tool",
          result: l.text || "",
          done: !busy || Boolean(l.text),
          isError: false,
          description: l.terminalId
            ? `terminal ${l.terminalId}`
            : l.agentName || undefined,
        },
      };
    }
    if (l.role === "thinking") {
      return {
        id: l.id,
        role: "thinking" as const,
        body: l.text || "",
        thinking: {
          streaming: busy && !l.text,
          collapsed: !(busy && !l.text),
        },
      };
    }
    if (l.role === "assistant") {
      return {
        id: l.id,
        role: "assistant" as const,
        body: l.text || (busy ? "…" : ""),
        meta: {
          authorLabel: `agent:${agent}`,
          streaming: busy && !l.text,
        },
      };
    }
    if (l.role === "user") {
      return {
        id: l.id,
        role: "user" as const,
        body: l.text || "",
        meta: { authorLabel: "user" },
      };
    }
    return {
      id: l.id,
      role: "system" as const,
      body: l.text || "",
    };
  });
}
