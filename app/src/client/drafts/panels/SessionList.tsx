import type { DraftSession } from "../types";
import { flattenSessionForest } from "../session-ancestry";
import { hierarchyIndentPx } from "../visual-marks";

export type SessionListProps = {
  /** Sessions for the currently selected agent only */
  sessions: DraftSession[];
  activeId: string;
  /** Active agent display name for empty/header hint */
  agentLabel?: string;
  busy?: boolean;
  /** Session ids currently generating (icon color) */
  runningSessionIds?: string[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  onFork?: (parentId: string) => void;
  onNewChild?: (parentId: string) => void;
};

/** Single-line rows: this agent's internal session list */
export function SessionList({
  sessions,
  activeId,
  agentLabel,
  busy,
  runningSessionIds = [],
  onSelect,
  onNew,
  onDelete,
  onFork,
  onNewChild,
}: SessionListProps) {
  const running = new Set(runningSessionIds);
  const forest = flattenSessionForest(sessions);
  return (
    <section
      className={`wire-session-list${busy ? " is-busy" : ""}${
        running.size > 0 ? " has-running" : ""
      }`}
      aria-label={agentLabel ? `${agentLabel} 的会话` : "会话列表"}
    >
      <div className="wire-new-task-wrap">
        <button type="button" className="wire-new-task-btn" onClick={onNew}>
          新建会话
        </button>
      </div>
      <div className="wire-pane-title">
        会话{agentLabel ? ` · ${agentLabel}` : ""}
      </div>
      <div className="wire-session-scroll">
        {sessions.length === 0 ? (
          <div className="wire-empty-row">
            {agentLabel ? `还没有会话` : "还没有会话"}
          </div>
        ) : (
          forest.map(({ node: s, depth }) => (
            <div
              key={s.id}
              className={`wire-session-row${s.id === activeId ? " active" : ""}${
                running.has(s.id) ? " is-running" : ""
              }${depth > 0 ? " is-child" : ""}`}
            >
              <button
                type="button"
                className="wire-session-btn"
                style={{ paddingLeft: hierarchyIndentPx(depth, 12, 8) }}
                onClick={() => onSelect(s.id)}
                title={
                  running.has(s.id) ? `${s.title} · 生成中` : s.title
                }
              >
                <span className="wire-session-title">{s.title}</span>
                <span className="wire-session-time">
                  {running.has(s.id) ? "运行中" : s.timeLabel}
                </span>
              </button>
              {onFork ? (
                <button
                  type="button"
                  className="wire-session-fork"
                  title="派生"
                  aria-label={`派生 ${s.title}`}
                  onClick={() => onFork(s.id)}
                >
                  派生
                </button>
              ) : null}
              {onNewChild ? (
                <button
                  type="button"
                  className="wire-session-child"
                  title="新建子会话"
                  aria-label={`新建 ${s.title} 的子会话`}
                  onClick={() => onNewChild(s.id)}
                >
                  子
                </button>
              ) : null}
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
