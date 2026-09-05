import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ComposerImage } from "../../composer/images";
import type {
  DraftAgent,
  DraftApproval,
  DraftMessage,
  DraftMeta,
  DraftSession,
} from "../types";
import { ConversationPane } from "../../conversation";
import { AskScrollRail } from "../thread/AskScrollRail";
import { SessionTreeCrumbs } from "../thread/SessionTreeCrumbs";
import { ApprovalBanner } from "../thread/ApprovalBanner";
import { ComposerBar } from "./ComposerBar";
import { WireThreadView } from "../thread/WireThreadView";
import {
  buildPrevUserJumpLabel,
  measureScrollFromBottom,
  pickOlderUser,
  scrollTopToAlignMessage,
  shouldShowBackToBottom,
  shouldShowJumpBar,
  shouldStickToBottom,
  type UserLayoutEntry,
} from "../thread/jump-prev-user";

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
  onSend: (images?: ComposerImage[], text?: string) => void;
  onRetryLast: () => void;
  onCopyTranscript: () => void;
  onAgentChange: (agentId: string) => void;
  onApprovalModeChange: (mode: string) => void;
  /** Draft local stop — clears busy without live agent. */
  onStop?: () => void;
  sessions?: DraftSession[];
  activeSessionId?: string;
  onSelectSession?: (id: string) => void;
  onForkSession?: (parentId: string) => void;
  onNewChildSession?: (parentId: string) => void;
  filePaths?: readonly string[];
};

/**
 * 上下文：用户块 / 助手回复树 / Markdown。
 * 消息树渲染统一走 WireThreadView（与 live ChatPanel wire 同源）。
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
  sessions,
  activeSessionId,
  onSelectSession,
  onForkSession,
  onNewChildSession,
  filePaths,
}: ContextPanelProps) {
  const empty = messages.length === 0;
  const canRetry = messages.some((m) => m.role === "user");
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
      const top = rect.top - rootTop + root.scrollTop;
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
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => refreshJumpState())
        : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro?.disconnect();
    };
  }, [refreshJumpState, messages]);

  useEffect(() => {
    gluedRef.current = true;
  }, [threadHeadId]);

  useEffect(() => {
    if (!gluedRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const pin = () => {
      el.scrollTop = el.scrollHeight;
      refreshJumpState();
    };
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
      <ConversationPane
        trail={
          sessions && onSelectSession ? (
            <SessionTreeCrumbs
              sessions={sessions}
              activeSessionId={activeSessionId ?? null}
              onSelect={onSelectSession}
              onFork={onForkSession}
              onNewChild={onNewChildSession}
            />
          ) : null
        }
        jumpPrev={null}
        scrollRef={scrollRef}
        empty={empty}
        rail={
          empty ? null : (
            <AskScrollRail
              scrollRef={scrollRef}
              revision={`${messages.length}:${messages[messages.length - 1]?.id ?? ""}`}
            />
          )
        }
        messages={
          <WireThreadView
            messages={messages}
            emptyTitle={hasActiveSession ? "还没有消息" : "未选择会话"}
            emptySub={
              hasActiveSession
                ? "在下方输入开始对话。消息只保存在本地。"
                : "在左侧新建会话，或从场景目录加载假数据。"
            }
            agentBusy={agentBusy}
            threadKey={activeSessionId ?? ""}
          />
        }
        jumpBottom={
          showBack ? (
            <button
              type="button"
              className="wire-jump-bottom"
              onClick={scrollToBottom}
              title="回到底部"
              aria-label="回到底部"
            >
              ↓ 回到底部
            </button>
          ) : null
        }
        permit={
          pendingApproval ? (
            <ApprovalBanner
              approval={pendingApproval}
              onDecision={onApprovalDecision}
            />
          ) : null
        }
        composer={
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
            filePaths={filePaths}
          />
        }
      />
    </section>
  );
}
