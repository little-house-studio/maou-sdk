import type { DraftSession } from "../types";
import { ChromeMark } from "../icons/Marks";

export type SessionListProps = {
  /** Sessions for the currently selected agent only */
  sessions: DraftSession[];
  activeId: string;
  /** Active agent display name for empty/header hint */
  agentLabel?: string;
  busy?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
};

/** Single-line rows: this agent's internal session list */
export function SessionList({
  sessions,
  activeId,
  agentLabel,
  busy,
  onSelect,
  onNew,
  onDelete,
}: SessionListProps) {
  return (
    <section
      className={`wire-session-list${busy ? " is-busy" : ""}`}
      aria-label={agentLabel ? `${agentLabel} 的会话` : "会话列表"}
    >
      <div className="wire-new-task-wrap">
        <button type="button" className="wire-new-task-btn" onClick={onNew}>
          <ChromeMark kind="new" size={14} decorative />
          新建会话
        </button>
      </div>
      <div className="wire-pane-title">
        <span className="wire-pane-title-with-icon">
          <ChromeMark kind="session" size={12} decorative />
          会话
          {agentLabel ? (
            <span className="wire-session-agent-label">{agentLabel}</span>
          ) : null}
        </span>
      </div>
      <div className="wire-session-scroll">
        {sessions.length === 0 ? (
          <div className="wire-empty sm">
            {agentLabel ? `暂无 ${agentLabel} 的会话` : "暂无会话"}
          </div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              className={`wire-session-row${s.id === activeId ? " active" : ""}`}
            >
              <button
                type="button"
                className="wire-session-btn"
                onClick={() => onSelect(s.id)}
                title={s.title}
              >
                <span className="wire-session-icon" aria-hidden>
                  <ChromeMark kind="session" size={13} decorative />
                </span>
                <span className="wire-session-title">{s.title}</span>
                <span className="wire-session-time">{s.timeLabel}</span>
              </button>
              {onDelete && (
                <button
                  type="button"
                  className="wire-session-del"
                  title="删除"
                  onClick={() => onDelete(s.id)}
                >
                  ×
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
