/**
 * 左侧 Agent 列表布局（对齐产品线框图，非视觉抄袭）：
 *   [系统 | 项目 | IM]
 *   · 系统：按「机器/本机」分组 → agent 树（含子 agent）
 *   · 项目：按「项目名称」分组 → project agent 树
 *   · IM：占位
 * 选中高亮 = 当前会话 agent；终端图标 = 有持久终端在跑
 */
import { useMemo, useState } from "react";
import type { DraftAgent } from "../types";
import { STATUS_LABEL_ZH } from "../agent-tree";
import { StatusMark } from "../icons/Marks";
import { UiEmoji } from "../../ui-emoji";

export type AgentListProps = {
  agents: DraftAgent[];
  activeId: string;
  onSelect: (id: string) => void;
  /** 正在跑持久终端的 agent name 集合 */
  terminalAgentNames?: ReadonlySet<string> | string[];
};

type ScopeTab = "system" | "project" | "im";

type AgentBranch = {
  root: DraftAgent;
  children: DraftAgent[];
};

type HostOrProjectGroup = {
  id: string;
  label: string;
  branches: AgentBranch[];
};

const TABS: { id: ScopeTab; label: string }[] = [
  { id: "system", label: "系统" },
  { id: "project", label: "项目" },
  { id: "im", label: "IM" },
];

function titleOf(a: DraftAgent, isRoot: boolean): string {
  if (isRoot && a.group === "project") {
    return a.displayName || a.name;
  }
  return a.displayName || a.name;
}

function isRunningLike(status: DraftAgent["status"]): boolean {
  return status === "running" || status === "blocked";
}

function toNameSet(
  names?: ReadonlySet<string> | string[],
): Set<string> {
  if (!names) return new Set();
  if (names instanceof Set) return names;
  return new Set(names);
}

/** 系统 Tab：按 host 分组（暂无多机数据时整组「本机」） */
function buildSystemGroups(agents: DraftAgent[]): HostOrProjectGroup[] {
  const roots = agents.filter((a) => a.group === "system" && !a.parent);
  const children = agents.filter((a) => a.group === "system" && a.parent);

  // hostLabel 预留；当前统一本机
  const byHost = new Map<string, DraftAgent[]>();
  for (const r of roots) {
    const host = (r as DraftAgent & { hostLabel?: string }).hostLabel || "本机";
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host)!.push(r);
  }

  const groups: HostOrProjectGroup[] = [];
  for (const [host, hostRoots] of byHost) {
    groups.push({
      id: `host:${host}`,
      label: host,
      branches: hostRoots.map((root) => ({
        root,
        children: children.filter((c) => c.parent === root.name),
      })),
    });
  }
  return groups;
}

/** 项目 Tab：按项目名分组 */
function buildProjectGroups(agents: DraftAgent[]): HostOrProjectGroup[] {
  const roots = agents.filter((a) => a.group === "project" && !a.parent);
  const children = agents.filter((a) => a.group === "project" && a.parent);

  const byProject = new Map<string, DraftAgent[]>();
  for (const r of roots) {
    const key =
      r.projectName ||
      (r.projectPath
        ? r.projectPath.split(/[/\\]/).filter(Boolean).pop() || r.projectPath
        : "") ||
      "未命名项目";
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(r);
  }

  const groups: HostOrProjectGroup[] = [];
  for (const [proj, projRoots] of byProject) {
    // 休眠项目排后
    const ordered = [
      ...projRoots.filter((a) => !a.stale),
      ...projRoots.filter((a) => a.stale),
    ];
    groups.push({
      id: `proj:${proj}`,
      label: proj,
      branches: ordered.map((root) => ({
        root,
        children: children.filter(
          (c) =>
            c.parent === root.name &&
            (c.projectPath === root.projectPath || !root.projectPath),
        ),
      })),
    });
  }
  return groups;
}

export function AgentList({
  agents,
  activeId,
  onSelect,
  terminalAgentNames,
}: AgentListProps) {
  const [tab, setTab] = useState<ScopeTab>("system");
  const termNames = useMemo(
    () => toNameSet(terminalAgentNames),
    [terminalAgentNames],
  );

  const systemGroups = useMemo(() => buildSystemGroups(agents), [agents]);
  const projectGroups = useMemo(() => buildProjectGroups(agents), [agents]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(() => {
    const init = new Set<string>();
    for (const a of agents) {
      if (a.parent) continue;
      const kids = agents.filter(
        (c) =>
          c.parent === a.name &&
          (a.group !== "project" || c.projectPath === a.projectPath),
      );
      if (kids.length === 0) continue;
      if (!kids.some((c) => isRunningLike(c.status))) init.add(a.id);
    }
    return init;
  });

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleParent = (id: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const groups =
    tab === "system" ? systemGroups : tab === "project" ? projectGroups : [];

  return (
    <section className="wire-agent-list" aria-label="agent 列表">
      <div className="wire-agent-scope-tabs" role="tablist" aria-label="Agent 范围">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`wire-agent-scope-tab${tab === t.id ? " is-active" : ""}${
              t.id === "system" && tab === t.id ? " is-system" : ""
            }${t.id === "project" && tab === t.id ? " is-project" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="wire-agent-tree" role="tree">
        {tab === "im" ? (
          <div className="wire-agent-empty">
            <UiEmoji name="chat" /> IM 对接即将推出
          </div>
        ) : groups.length === 0 ? (
          <div className="wire-agent-empty">
            {tab === "system" ? "暂无系统 Agent" : "暂无项目 Agent"}
          </div>
        ) : (
          groups.map((group) => {
            const open = !collapsedGroups.has(group.id);
            return (
              <div
                key={group.id}
                className={`wire-agent-host-group${open ? " is-open" : ""}`}
              >
                <button
                  type="button"
                  className="wire-agent-host-head"
                  aria-expanded={open}
                  onClick={() => toggleGroup(group.id)}
                >
                  <span className="wire-agent-host-label">{group.label}</span>
                </button>

                {open &&
                  group.branches.map(({ root, children }) => {
                    const parentOpen = !collapsedParents.has(root.id);
                    const hasKids = children.length > 0;
                    const hasTerm =
                      termNames.has(root.name) ||
                      children.some((c) => termNames.has(c.name));
                    return (
                      <div
                        key={root.id}
                        className={`wire-agent-branch${parentOpen ? " is-open" : ""}`}
                      >
                        <AgentRow
                          agent={root}
                          isChild={false}
                          activeId={activeId}
                          onSelect={onSelect}
                          hasChildren={hasKids}
                          expanded={parentOpen}
                          onToggleExpand={
                            hasKids ? () => toggleParent(root.id) : undefined
                          }
                          hasTerminal={hasTerm || termNames.has(root.name)}
                        />
                        {hasKids && parentOpen && (
                          <div className="wire-agent-children" role="group">
                            {children.map((child) => (
                              <AgentRow
                                key={child.id}
                                agent={child}
                                isChild
                                activeId={activeId}
                                onSelect={onSelect}
                                hasTerminal={termNames.has(child.name)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function AgentRow({
  agent,
  isChild,
  activeId,
  onSelect,
  hasChildren,
  expanded,
  onToggleExpand,
  hasTerminal,
}: {
  agent: DraftAgent;
  isChild: boolean;
  activeId: string;
  onSelect: (id: string) => void;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  hasTerminal?: boolean;
}) {
  const active = agent.id === activeId;
  const label = titleOf(agent, !isChild);
  const statusTitle = STATUS_LABEL_ZH[agent.status];

  return (
    <div
      className={`wire-agent-row-wrap${isChild ? " is-child" : " is-root"}`}
    >
      {hasChildren ? (
        <button
          type="button"
          className={`wire-agent-expand${expanded ? " open" : ""}`}
          aria-label={expanded ? "折叠子 agent" : "展开子 agent"}
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand?.();
          }}
        >
          ▸
        </button>
      ) : isChild ? (
        <span className="wire-agent-tree-rail" aria-hidden />
      ) : (
        <span className="wire-agent-expand-spacer" aria-hidden />
      )}
      <button
        type="button"
        role="treeitem"
        aria-selected={active}
        className={`wire-agent-item status-${agent.status}${
          agent.stale ? " is-stale" : ""
        }${active ? " active" : ""}${isChild ? " is-sub" : ""}`}
        onClick={() => onSelect(agent.id)}
        title={[label, statusTitle, hasTerminal ? "终端运行中" : ""]
          .filter(Boolean)
          .join(" · ")}
      >
        <span className="wire-agent-status-sq" aria-hidden>
          <StatusMark kind={agent.status} size={10} title={statusTitle} />
        </span>
        <span className="wire-agent-name">{label}</span>
        {hasTerminal ? (
          <span
            className="wire-agent-term-badge"
            title="持久终端运行中"
            aria-label="持久终端运行中"
          >
            <UiEmoji name="terminal" />
          </span>
        ) : null}
      </button>
    </div>
  );
}
