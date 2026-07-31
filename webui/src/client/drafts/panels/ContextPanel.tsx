import { useMemo } from "react";
import type {
  DraftAgent,
  DraftApproval,
  DraftBgTask,
  DraftMessage,
  DraftMeta,
} from "../types";
import { ApprovalBanner } from "./ApprovalBanner";
import { BackgroundTasks } from "./BackgroundTasks";
import { ComposerBar } from "./ComposerBar";
import { DraftMarkdown } from "../DraftMarkdown";
import { groupThreadBlocks } from "../thread-blocks";
import { roleLabelZh, roleMarkKind } from "../visual-marks";
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
  bgTasks: DraftBgTask[];
  onApprovalDecision: (d: "once" | "always" | "deny" | "blacklist") => void;
  onDraftInputChange: (v: string) => void;
  onSend: () => void;
  onRetryLast: () => void;
  onCopyTranscript: () => void;
  onAgentChange: (agentName: string) => void;
  onApprovalModeChange: (mode: string) => void;
};

/**
 * 上下文：用户气泡 / 助手回复树（thinking·tool 嵌套）/ Markdown 渲染。
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
  bgTasks,
  onApprovalDecision,
  onDraftInputChange,
  onSend,
  onRetryLast,
  onCopyTranscript,
  onAgentChange,
  onApprovalModeChange,
}: ContextPanelProps) {
  const empty = messages.length === 0;
  const canRetry = messages.some((m) => m.role === "user");
  const blocks = useMemo(() => groupThreadBlocks(messages), [messages]);

  return (
    <section
      className={`wire-context chat-panel codex-chat${
        pendingApproval ? " has-approval" : ""
      }`}
      aria-label="上下文"
    >
      {agentBusy && !pendingApproval && (
        <div className="stream-banner wire-center-banner" role="status">
          <div className="wire-center-track wire-banner-inner">
            <StatusMark kind="running" size={12} title="运行中" />
            <span>工作中</span>
            <button type="button" className="linkish" disabled>
              停止
            </button>
          </div>
        </div>
      )}

      <div className="codex-thread-scroll wire-thread-scroll">
        <div className="wire-context-scroll chat-log codex-log" role="log">
          {empty ? (
            <div className="bubble codex-bubble system empty-hint">
              <div className="msg-body">
                <div className="empty-title">
                  {hasActiveSession ? "还没有消息" : "未选择会话"}
                </div>
                <div className="empty-sub">
                  {hasActiveSession
                    ? "在下方输入开始对话。消息只保存在本地。"
                    : "在左侧新建会话，或切换顶栏场景加载假数据。"}
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

      <div className="wire-float wire-float-top">
        <BackgroundTasks tasks={bgTasks} />
      </div>
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
        />
      </div>
    </section>
  );
}

function MessageRow({ message }: { message: DraftMessage }) {
  const rKind = roleMarkKind(message.role);
  const label = roleLabelZh(rKind, message.tag);
  return (
    <div
      className={`bubble codex-bubble wire-msg ${message.role}${
        message.role === "tool" && message.clickable ? " clickable" : ""
      }`}
    >
      <div className="msg-avatar-wrap" aria-hidden>
        <RoleAvatar kind={rKind} size={16} title={label} />
      </div>
      <div className="msg-body">
        <div className="msg-role">{label}</div>
        <div className="bubble-text">
          <DraftMarkdown source={message.body} />
        </div>
      </div>
    </div>
  );
}

/** 助手回复：正文 + 内嵌 thinking / tool / err */
function AssistantTurn({
  assistant,
  internals,
}: {
  assistant: DraftMessage | null;
  internals: DraftMessage[];
}) {
  return (
    <div className="wire-reply-turn">
      <div className="bubble codex-bubble wire-msg assistant">
        <div className="msg-avatar-wrap" aria-hidden>
          <RoleAvatar kind="assistant" size={16} title="助手" />
        </div>
        <div className="msg-body wire-reply-body">
          {assistant ? (
            <>
              <div className="msg-role">助手</div>
              <div className="bubble-text">
                <DraftMarkdown source={assistant.body} />
              </div>
            </>
          ) : (
            <div className="msg-role">助手</div>
          )}
          {internals.length > 0 ? (
            <div className="wire-reply-internals">
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

  return (
    <div
      className={`wire-internal-part role-${message.role}${
        isTool && message.clickable ? " clickable" : ""
      }`}
    >
      <div className="wire-internal-head">
        {isThinking ? (
          <StatusMark kind="running" size={11} title={label} />
        ) : (
          <RoleAvatar kind={rKind} size={16} title={label} />
        )}
        <span className="wire-internal-label">{label}</span>
      </div>
      <div
        className={`wire-internal-body${isTool ? " is-tool" : ""}${
          isErr ? " is-err" : ""
        }${isThinking ? " is-thinking" : ""}`}
      >
        {isTool ? (
          <pre className="wire-tool-pre">{message.body}</pre>
        ) : (
          <DraftMarkdown source={message.body} />
        )}
      </div>
    </div>
  );
}
