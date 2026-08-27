/**
 * Team 中栏：当前可见 agent 名册，点一行回到聊天并切 agent。
 */
import React from "react";
import { ChromeMark } from "../icons/Marks";
import { STATUS_LABEL_ZH } from "../agent-tree";
import type { DraftAgent } from "../types";

export type TeamBoardProps = {
  agents?: readonly DraftAgent[];
  activeId?: string;
  onSelectAgent?: (id: string) => void;
  onOpenChat?: () => void;
};

export function TeamBoard({
  agents = [],
  activeId,
  onSelectAgent,
  onOpenChat,
}: TeamBoardProps) {
  const live = agents.filter((a) => !a.stale);
  return (
    <section className="wire-team" aria-label="Team 工作台">
      <div className="wire-team-sheet">
        <header className="wire-team-head">
          <ChromeMark kind="mode_team" size={18} decorative />
          <div>
            <h2 className="wire-team-title">Team</h2>
            <p className="wire-team-sub">
              同一窗口里的 agent。点一行切到该 agent 并回聊天。
            </p>
          </div>
        </header>
        {live.length === 0 ? (
          <div className="wire-team-empty">
            <p className="wire-team-sub">
              还没有 agent。用左侧栏切系统/项目，或回「聊天」继续当前会话。
            </p>
          </div>
        ) : (
          <div className="wire-team-grid" role="list">
            {live.map((a) => {
              const on = a.id === activeId;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="listitem"
                  className={`wire-team-row${on ? " is-active" : ""}`}
                  onClick={() => {
                    onSelectAgent?.(a.id);
                    onOpenChat?.();
                  }}
                >
                  <span className="wire-team-name">
                    {a.displayName || a.name}
                  </span>
                  <span className="wire-team-role">{a.role}</span>
                  <span className="wire-team-status">
                    {STATUS_LABEL_ZH[a.status] ?? a.status}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
