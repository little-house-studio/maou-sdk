/**
 * Draft-aligned thread rendering: groupThreadBlocks + MessageRow / AssistantTurn.
 * Used by ContextPanel (fixtures) and live ChatPanel (wire chrome) for UI parity.
 */
import React, { useEffect, useState } from "react";
import type { DraftMessage } from "../types";
import { groupThreadBlocks } from "../thread-blocks";
import { DraftMarkdown } from "../DraftMarkdown";
import { ToolCard } from "./ToolCard";
import { durationStr, formatMessageHead } from "../message-meta";
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
        {!isTool ? (
          <MessageHeadLine head={head} fallbackLabel={label} />
        ) : null}
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
            <DraftMarkdown source={message.body} />
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
  const thinkParts = internals.filter((m) => m.role === "thinking");
  const otherInternals = internals.filter((m) => m.role !== "thinking");
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
            <MessageHeadLine head={head} fallbackLabel="助手" />
          ) : (
            <div className="msg-role wire-orphan-label">内部步骤</div>
          )}

          {/* ① 思考在正文上方，默认折叠 */}
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

          {/* ② 助手正文 */}
          {assistant ? (
            <div className="bubble-text">
              <DraftMarkdown source={assistant.body} />
            </div>
          ) : null}

          {/* ③ 工具等其它内部步骤 */}
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
    thinkStartedAt?: number;
    thinkDurationMs?: number;
    thinkOutputTokens?: number;
  }>,
  opts?: { agentBusy?: boolean; agentName?: string },
): DraftMessage[] {
  const busy = Boolean(opts?.agentBusy);
  const agent = opts?.agentName || "coding";
  return lines.map((l) => {
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
      // 结果正文首行常是「✓ write_file」或中文摘要；meta 描述用去掉徽章前缀后的摘要
      const body = l.text || "";
      const descFromBody = body
        .split("\n")
        .map((s) => s.trim())
        .find(
          (s) =>
            s &&
            !/^[▶✓✗×❌]\s*[a-zA-Z_][\w.-]*/.test(s) &&
            s !== toolName,
        );
      return {
        id: l.id,
        role: "tool" as const,
        body,
        tag: l.terminalId || toolName || undefined,
        // 不再整卡 clickable 自动弹终端；有 id 时工具卡上显示「打开终端」
        clickable: false,
        agentName: l.agentName || agent,
        tool: {
          // 自动用 Agent 实际调用的工具名，禁止硬编码 "tool"
          name: toolName,
          result: body,
          done: !busy || Boolean(body),
          isError: isErr,
          description: l.terminalId
            ? `terminal ${l.terminalId}`
            : descFromBody || undefined,
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
