/**
 * Agent 列表行构建 — 对齐 CLI `buildAgentsPage`（overlay-data.ts）逻辑：
 * - 分组：系统 Agent / 项目 Agent · 最近活跃 / 休眠项目
 * - 父子：parent 字段；depth 0 主 · depth 1 子
 * - 项目下未运行子 agent 折叠提示；运行中/blocked 展开
 * - 状态灯语义：idle | running | done_unread | done_read | blocked | needs_reply
 */

export type AgentPresenceStatus =
  | "idle"
  | "running"
  | "done_unread"
  | "done_read"
  | "blocked"
  | "needs_reply";

export type DraftAgentGroup = "system" | "project";

/** 与 CLI AgentListEntry / listAgents 摘要对齐的草稿节点 */
export type DraftAgentNode = {
  /** 切换用 id，如 system:ops / project:/path:coding */
  id: string;
  name: string;
  displayName?: string;
  role?: string;
  overview?: string;
  status: AgentPresenceStatus;
  group: DraftAgentGroup;
  /** 父 agent name（子 agent 有 parent） */
  parent?: string;
  projectPath?: string;
  projectName?: string;
  stale?: boolean;
};

export type AgentListRow =
  | { kind: "header"; id: string; label: string }
  | { kind: "spacer"; id: string }
  | { kind: "fold"; id: string; label: string; depth: number }
  | {
      kind: "agent";
      id: string;
      agent: DraftAgentNode;
      depth: number;
      /** ◆ 系统主 · ◇ 系统子 · ● 项目主 · ○ 项目子 */
      glyph: string;
      rowKind: "agent" | "sub";
    };

export function isActiveStatus(s: AgentPresenceStatus): boolean {
  return s === "running" || s === "blocked";
}

/**
 * 将扁平 agent 表建成 CLI 同款展示行（含分组头与折叠提示）。
 */
export function buildAgentListRows(entries: DraftAgentNode[]): AgentListRow[] {
  const rows: AgentListRow[] = [];
  let seq = 0;
  const nextId = (p: string) => `${p}-${seq++}`;

  const system = entries.filter((e) => e.group === "system" && !e.parent);
  const systemSubs = entries.filter((e) => e.group === "system" && !!e.parent);
  const projects = entries.filter((e) => e.group === "project" && !e.parent);
  const projectSubs = entries.filter((e) => e.group === "project" && !!e.parent);
  const freshProjects = projects.filter((e) => !e.stale);
  const staleProjects = projects.filter((e) => e.stale);

  const pushHeader = (label: string) => {
    rows.push({ kind: "header", id: nextId("hdr"), label });
  };
  const pushSpacer = () => {
    rows.push({ kind: "spacer", id: nextId("sp") });
  };

  // ── 系统主 agent ──
  if (system.length > 0) {
    pushHeader("系统 Agent");
    for (const e of system) {
      rows.push({
        kind: "agent",
        id: e.id,
        agent: e,
        depth: 0,
        glyph: "◆",
        rowKind: "agent",
      });
      // CLI：系统下子 agent 全部列出
      const subs = systemSubs.filter((x) => x.parent === e.name);
      for (const s of subs) {
        rows.push({
          kind: "agent",
          id: s.id,
          agent: s,
          depth: 1,
          glyph: "◇",
          rowKind: "sub",
        });
      }
    }
  }

  // ── 项目 agent（7 天内活跃）──
  if (freshProjects.length > 0) {
    if (rows.length > 0) pushSpacer();
    pushHeader("项目 Agent · 最近活跃");
    for (const e of freshProjects) {
      rows.push({
        kind: "agent",
        id: e.id,
        agent: e,
        depth: 0,
        glyph: "●",
        rowKind: "agent",
      });
      const subs = projectSubs.filter(
        (x) => x.projectPath === e.projectPath && x.parent === e.name,
      );
      // 兼容：仅按 projectPath 挂子
      const byPath = projectSubs.filter((x) => x.projectPath === e.projectPath);
      const childPool = subs.length > 0 ? subs : byPath.filter((x) => !!x.parent);

      const runningSubs = childPool.filter((s) => isActiveStatus(s.status));
      if (runningSubs.length > 0) {
        for (const s of runningSubs) {
          rows.push({
            kind: "agent",
            id: s.id,
            agent: s,
            depth: 1,
            glyph: "○",
            rowKind: "sub",
          });
        }
        const folded = childPool.length - runningSubs.length;
        if (folded > 0) {
          rows.push({
            kind: "fold",
            id: nextId("fold"),
            label: `另有 ${folded} 个未运行子 agent`,
            depth: 1,
          });
        }
      } else if (childPool.length > 0) {
        rows.push({
          kind: "fold",
          id: nextId("fold"),
          label: `${childPool.length} 个子 agent（未运行，已折叠）`,
          depth: 1,
        });
      }
    }
  }

  // ── 休眠项目 ──
  if (staleProjects.length > 0) {
    if (rows.length > 0) pushSpacer();
    pushHeader("休眠项目 · 超过 7 天未运行");
    for (const e of staleProjects) {
      rows.push({
        kind: "agent",
        id: e.id,
        agent: { ...e, stale: true, status: "idle" },
        depth: 0,
        glyph: "●",
        rowKind: "agent",
      });
    }
  }

  // 兼容：无 group 的扁平列表
  if (rows.length === 0) {
    for (const e of entries.filter((x) => !x.parent)) {
      rows.push({
        kind: "agent",
        id: e.id,
        agent: e,
        depth: 0,
        glyph: "●",
        rowKind: "agent",
      });
    }
  }

  return rows;
}

export const STATUS_LABEL_ZH: Record<AgentPresenceStatus, string> = {
  idle: "空闲",
  running: "运行中",
  done_unread: "完成·未读",
  done_read: "完成",
  blocked: "待操作",
  needs_reply: "待回复",
};
