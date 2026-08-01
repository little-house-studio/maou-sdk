import { useMemo, useState } from "react";
import type { DraftAgent } from "../types";
import { STATUS_LABEL_ZH } from "../agent-tree";
import { hierarchyMarkKind } from "../visual-marks";
import { ChromeMark, HierarchyMark, StatusMark } from "../icons/Marks";

export type AgentListProps = {
  agents: DraftAgent[];
  activeId: string;
  onSelect: (id: string) => void;
};

type AgentBranch = {
  root: DraftAgent;
  children: DraftAgent[];
  /** Project-only: how many children are running/blocked (CLI expand policy) */
  runningChildCount?: number;
  idleChildCount?: number;
};

type AgentSection = {
  id: string;
  label: string;
  branches: AgentBranch[];
};

function titleOf(a: DraftAgent): string {
  if (a.group === "project" && !a.parent) {
    return a.projectName || a.displayName || a.name;
  }
  return a.displayName || a.name;
}

function subtitleOf(a: DraftAgent, isRoot: boolean): string {
  if (isRoot && a.group === "project") {
    return a.name !== titleOf(a) ? a.name : a.role || a.overview || "";
  }
  return a.overview || a.role || "";
}

function isRunningLike(status: DraftAgent["status"]): boolean {
  return status === "running" || status === "blocked";
}

function buildSections(agents: DraftAgent[]): AgentSection[] {
  const systemRoots = agents.filter((a) => a.group === "system" && !a.parent);
  const systemChildren = agents.filter((a) => a.group === "system" && a.parent);
  const projectRoots = agents.filter((a) => a.group === "project" && !a.parent);
  const projectChildren = agents.filter(
    (a) => a.group === "project" && a.parent,
  );
  const fresh = projectRoots.filter((a) => !a.stale);
  const stale = projectRoots.filter((a) => a.stale);

  const systemBranches: AgentBranch[] = systemRoots.map((root) => ({
    root,
    children: systemChildren.filter((c) => c.parent === root.name),
  }));

  // CLI: project subs only expand when running/blocked; idle stay folded
  const projectBranches: AgentBranch[] = fresh.map((root) => {
    const all = projectChildren.filter(
      (c) => c.parent === root.name && c.projectPath === root.projectPath,
    );
    const running = all.filter((c) => isRunningLike(c.status));
    return {
      root,
      // Prefer running children in expanded view; full list still available via expand
      children: all,
      runningChildCount: running.length,
      idleChildCount: all.length - running.length,
    };
  });

  // Stale section: CLI only shows main agent (no children)
  const staleBranches: AgentBranch[] = stale.map((root) => ({
    root,
    children: [],
  }));

  const sections: AgentSection[] = [];
  if (systemBranches.length > 0) {
    sections.push({
      id: "system",
      label: "系统 Agent",
      branches: systemBranches,
    });
  }
  if (projectBranches.length > 0) {
    sections.push({
      id: "project",
      label: "项目 Agent · 最近活跃",
      branches: projectBranches,
    });
  }
  if (staleBranches.length > 0) {
    sections.push({
      id: "stale",
      label: "休眠项目 · 超过 7 天未运行",
      branches: staleBranches,
    });
  }
  return sections;
}

function sectionCount(section: AgentSection): number {
  return section.branches.reduce((n, b) => n + 1 + b.children.length, 0);
}

/** 可折叠分组 + 可折叠父级，层次一眼可读（默认对齐 CLI：未运行项目子 agent 折叠） */
export function AgentList({ agents, activeId, onSelect }: AgentListProps) {
  const sections = useMemo(() => buildSections(agents), [agents]);

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(["stale"]),
  );
  // Seed: collapse project parents with no running children (CLI fold idle subs)
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(() => {
    const init = new Set<string>();
    for (const a of agents) {
      if (a.group !== "project" || a.parent) continue;
      const kids = agents.filter(
        (c) =>
          c.parent === a.name &&
          c.projectPath === a.projectPath &&
          c.group === "project",
      );
      if (kids.length === 0) continue;
      const anyRunning = kids.some((c) => isRunningLike(c.status));
      if (!anyRunning) init.add(a.id);
    }
    return init;
  });

  const toggleSection = (id: string) => {
    setCollapsedSections((prev) => {
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

  return (
    <section className="wire-agent-list" aria-label="agent 列表">
      <div className="wire-pane-title row">
        <span className="wire-pane-title-with-icon">
          <ChromeMark kind="agent_info" size={12} decorative />
          Agent
        </span>
      </div>
      <div className="wire-agent-tree" role="tree">
        {sections.map((section) => {
          const open = !collapsedSections.has(section.id);
          const count = sectionCount(section);
          return (
            <div
              key={section.id}
              className={`wire-agent-section${open ? " is-open" : " is-collapsed"}`}
            >
              <button
                type="button"
                className="wire-agent-section-head"
                aria-expanded={open}
                onClick={() => toggleSection(section.id)}
              >
                <span
                  className={`wire-agent-chevron${open ? " open" : ""}`}
                  aria-hidden
                >
                  ▸
                </span>
                <ChromeMark kind="folder_group" size={12} decorative />
                <span className="wire-agent-section-label">{section.label}</span>
                <span className="wire-agent-section-count">{count}</span>
              </button>

              {open &&
                section.branches.map(({ root, children }) => {
                  const parentOpen = !collapsedParents.has(root.id);
                  const hasKids = children.length > 0;
                  return (
                    <div
                      key={root.id}
                      className={`wire-agent-branch${parentOpen ? " is-open" : ""}`}
                    >
                      <AgentItem
                        agent={root}
                        depth={0}
                        isChild={false}
                        activeId={activeId}
                        onSelect={onSelect}
                        hasChildren={hasKids}
                        expanded={parentOpen}
                        onToggleExpand={
                          hasKids ? () => toggleParent(root.id) : undefined
                        }
                        childCount={children.length}
                      />
                      {hasKids && parentOpen && (
                        <div className="wire-agent-children" role="group">
                          {children.map((child) => (
                            <AgentItem
                              key={child.id}
                              agent={child}
                              depth={1}
                              isChild
                              activeId={activeId}
                              onSelect={onSelect}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AgentItem({
  agent,
  depth,
  isChild,
  activeId,
  onSelect,
  hasChildren,
  expanded,
  onToggleExpand,
  childCount,
}: {
  agent: DraftAgent;
  depth: number;
  isChild: boolean;
  activeId: string;
  onSelect: (id: string) => void;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  childCount?: number;
}) {
  const active = agent.id === activeId;
  const label = titleOf(agent);
  const overview = subtitleOf(agent, !isChild).slice(0, 48);
  const hKind = hierarchyMarkKind({
    group: agent.group,
    isChild,
  });
  const statusTitle = STATUS_LABEL_ZH[agent.status];

  return (
    <div
      className={`wire-agent-row-wrap depth-${depth}${isChild ? " is-child" : " is-root"}`}
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
        title={[label, overview, statusTitle].filter(Boolean).join(" · ")}
      >
        <HierarchyMark kind={hKind} size={12} title={hKind} />
        <StatusMark kind={agent.status} size={11} title={statusTitle} />
        <span className="wire-agent-main">
          <span className="wire-agent-name">
            {label}
            {hasChildren && !expanded && childCount ? (
              <span className="wire-agent-kid-count">{childCount}</span>
            ) : null}
          </span>
          {overview ? (
            <span className="wire-agent-overview">{overview}</span>
          ) : null}
        </span>
      </button>
    </div>
  );
}
