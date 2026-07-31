/**
 * Draft team mode placeholder — keeps mode switch complete.
 */
import React from "react";
import { ChromeMark } from "../icons/Marks";

export function TeamBoard() {
  return (
    <section className="wire-team" aria-label="Team 工作台">
      <div className="wire-team-empty">
        <ChromeMark kind="mode_team" size={28} decorative />
        <h2 className="wire-team-title">Team</h2>
        <p className="wire-team-sub">
          协作面板占位。当前草稿优先完成聊天与项目界面；后续接多 agent 协作视图。
        </p>
      </div>
    </section>
  );
}
