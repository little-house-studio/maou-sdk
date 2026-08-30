/**
 * 左侧 Agent：当前工作区切换器 + 名册；IM 仍是收件箱。
 * 选中高亮 = 当前会话 agent；终端图标 = 有持久终端在跑。
 */
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DraftAgent } from "../types";
import { STATUS_LABEL_ZH } from "../agent-tree";
import { StatusMark } from "../icons/Marks";
import { UiEmoji } from "../../ui-emoji";

export type AgentListProps = {
  agents: DraftAgent[];
  activeId: string;
  onSelect: (id: string) => void;
  /** IM 行点选后切回聊天 */
  onOpenChat?: () => void;
  /** 正在跑持久终端的 agent name 集合 */
  terminalAgentNames?: ReadonlySet<string> | string[];
  /** 项目 Tab：选文件夹加入工作区 */
  onAddProject?: () => void;
};

const IM_RANK: Record<DraftAgent["status"], number> = {
  needs_reply: 0,
  blocked: 1,
  running: 2,
  done_unread: 3,
  idle: 4,
  done_read: 5,
};

export function buildImInbox(agents: readonly DraftAgent[]): DraftAgent[] {
  return agents
    .filter((a) => !a.stale)
    .slice()
    .sort((a, b) => {
      const d = IM_RANK[a.status] - IM_RANK[b.status];
      if (d !== 0) return d;
      return (a.displayName || a.name).localeCompare(b.displayName || b.name);
    });
}

type ScopeTab = "system" | "project" | "im";

export type AgentBranch = {
  root: DraftAgent;
  children: DraftAgent[];
};

export type HostOrProjectGroup = {
  id: string;
  label: string;
  /** 项目根路径的展示串（系统分组没有） */
  path?: string;
  branches: AgentBranch[];
};

const TABS: { id: ScopeTab; label: string }[] = [
  { id: "system", label: "系统" },
  { id: "project", label: "项目" },
  { id: "im", label: "IM" },
];

/** 名册行：列表常把主 agent 的 displayName 写成项目名，这里用目录名。 */
function rosterLabel(agent: DraftAgent, groupLabel: string): string {
  const shown = agent.displayName || agent.name;
  if (shown === groupLabel && agent.name !== groupLabel) return agent.name;
  return shown;
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
export function buildSystemGroups(agents: DraftAgent[]): HostOrProjectGroup[] {
  const roots = agents.filter((a) => a.group === "system" && !a.parent);
  const children = agents.filter((a) => a.group === "system" && a.parent);

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

function folderNameOf(a: DraftAgent): string {
  if (a.projectName) return a.projectName;
  if (a.projectPath) {
    return a.projectPath.split(/[/\\]/).filter(Boolean).pop() || a.projectPath;
  }
  return "未命名项目";
}

/** 把本机绝对路径收成 ~ 开头，给侧栏第二行用。 */
export function compactProjectPath(raw?: string): string {
  if (!raw) return "";
  const n = raw.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!n) return "";
  return n
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^\/home\/[^/]+/, "~")
    .replace(/^[A-Za-z]:\/Users\/[^/]+/i, "~");
}

function WorkspaceCopy({
  label,
  path,
  nameClass,
}: {
  label: string;
  path?: string;
  nameClass: string;
}) {
  return (
    <span className="wire-agent-switch-copy">
      <span className={nameClass}>{label}</span>
      {path ? <span className="wire-agent-switch-path">{path}</span> : null}
    </span>
  );
}

/** 项目 Tab：按项目路径分组（没有路径时退回项目名） */
export function buildProjectGroups(agents: DraftAgent[]): HostOrProjectGroup[] {
  const roots = agents.filter((a) => a.group === "project" && !a.parent);
  const children = agents.filter((a) => a.group === "project" && a.parent);

  const byProject = new Map<string, DraftAgent[]>();
  for (const r of roots) {
    const folder = folderNameOf(r);
    const key = r.projectPath || `name:${folder}`;
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(r);
  }

  const groups: HostOrProjectGroup[] = [];
  for (const [key, projRoots] of byProject) {
    const ordered = [
      ...projRoots.filter((a) => !a.stale),
      ...projRoots.filter((a) => a.stale),
    ];
    const sample = ordered[0]!;
    const folder = folderNameOf(sample);
    groups.push({
      id: `proj:${key}`,
      label: folder,
      path: compactProjectPath(sample.projectPath) || undefined,
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

export function pickCurrentGroup(
  groups: readonly HostOrProjectGroup[],
  activeId: string,
): HostOrProjectGroup | undefined {
  return (
    groups.find((g) =>
      g.branches.some(
        (b) =>
          b.root.id === activeId || b.children.some((c) => c.id === activeId),
      ),
    ) ?? groups[0]
  );
}

/** 项目行就是主 coding；目录名和分组名相同的也不重复列。 */
export function branchRoster(
  branch: AgentBranch,
  groupLabel: string,
): { showRoot: boolean; children: DraftAgent[] } {
  const hide = (a: DraftAgent) => a.name === groupLabel || a.name === "coding";
  return {
    showRoot: !hide(branch.root),
    children: branch.children.filter((c) => !hide(c)),
  };
}

export function groupAgentCount(group: HostOrProjectGroup): number {
  return group.branches.reduce((n, b) => {
    const { showRoot, children } = branchRoster(b, group.label);
    return n + (showRoot ? 1 : 0) + children.length;
  }, 0);
}

function groupHasRun(
  group: HostOrProjectGroup,
  termNames: Set<string>,
): boolean {
  return group.branches.some(
    (b) =>
      isRunningLike(b.root.status) ||
      termNames.has(b.root.name) ||
      b.children.some((c) => isRunningLike(c.status) || termNames.has(c.name)),
  );
}

export function AgentList({
  agents,
  activeId,
  onSelect,
  onOpenChat,
  terminalAgentNames,
  onAddProject,
}: AgentListProps) {
  const [tab, setTab] = useState<ScopeTab>(() =>
    agents.find((a) => a.id === activeId)?.group === "project"
      ? "project"
      : "system",
  );
  const termNames = useMemo(
    () => toNameSet(terminalAgentNames),
    [terminalAgentNames],
  );

  const systemGroups = useMemo(() => buildSystemGroups(agents), [agents]);
  const projectGroups = useMemo(() => buildProjectGroups(agents), [agents]);
  const groups =
    tab === "system" ? systemGroups : tab === "project" ? projectGroups : [];

  const [switchOpen, setSwitchOpen] = useState(false);
  const deskRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [menuBox, setMenuBox] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const current = pickCurrentGroup(groups, activeId);
  const currentRoot = current?.branches[0]?.root;
  const canSwitch = groups.length > 1;
  const rosterRows = current
    ? current.branches.map((branch) => ({
        branch,
        ...branchRoster(branch, current.label),
      }))
    : [];
  const hasRoster = rosterRows.some((r) => r.showRoot || r.children.length > 0);

  useEffect(() => {
    if (!switchOpen) return;
    const onPtr = (e: PointerEvent) => {
      const el = deskRef.current;
      if (el && !el.contains(e.target as Node)) setSwitchOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSwitchOpen(false);
    };
    window.addEventListener("pointerdown", onPtr);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPtr);
      window.removeEventListener("keydown", onKey);
    };
  }, [switchOpen]);

  useLayoutEffect(() => {
    if (!switchOpen || !canSwitch) {
      setMenuBox(null);
      return;
    }
    const el = barRef.current;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      setMenuBox({ top: r.bottom, left: r.left, width: r.width });
    };
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [switchOpen, canSwitch]);

  return (
    <section className="wire-agent-list" aria-label="agent 列表">
      <div className="wire-agent-scope-tabs" role="tablist" aria-label="Agent 范围">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`wire-agent-scope-tab${tab === t.id ? " is-active" : ""} is-${t.id}`}
            onClick={() => {
              setTab(t.id);
              setSwitchOpen(false);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "im" ? (
        <div className="wire-agent-tree" role="tree">
          <ImInbox
            agents={agents}
            activeId={activeId}
            onSelect={(id) => {
              onSelect(id);
              onOpenChat?.();
            }}
          />
        </div>
      ) : groups.length === 0 || !current ? (
        <div className="wire-agent-desk">
          <div className="wire-agent-empty">
            {tab === "system" ? "暂无系统 Agent" : "暂无项目 Agent"}
          </div>
          {tab === "project" && onAddProject ? (
            <button
              type="button"
              className="wire-agent-switch-opt is-add"
              onClick={onAddProject}
            >
              <span className="wire-agent-switch-opt-name">+ 增加项目</span>
            </button>
          ) : null}
        </div>
      ) : (
        <div className="wire-agent-desk" ref={deskRef}>
          <div className={`wire-agent-switch${canSwitch ? "" : " is-solo"}`}>
            <div className="wire-agent-switch-bar" ref={barRef}>
              <button
                type="button"
                className={`wire-agent-switch-now${
                  currentRoot && currentRoot.id === activeId ? " is-active" : ""
                }${currentRoot?.stale ? " is-stale" : ""}`}
                onClick={() => currentRoot && onSelect(currentRoot.id)}
                title={
                  current.path
                    ? `${current.label}\n${current.path}`
                    : current.label
                }
              >
                {currentRoot ? (
                  <span className="wire-agent-status-sq" aria-hidden>
                    <StatusMark
                      kind={currentRoot.status}
                      size={10}
                      title={STATUS_LABEL_ZH[currentRoot.status]}
                    />
                  </span>
                ) : null}
                <WorkspaceCopy
                  label={current.label}
                  path={current.path}
                  nameClass="wire-agent-switch-name"
                />
              </button>
              {canSwitch ? (
                <button
                  type="button"
                  className={`wire-agent-switch-more${switchOpen ? " is-open" : ""}`}
                  aria-expanded={switchOpen}
                  aria-haspopup="listbox"
                  aria-label={`切换工作区，共 ${groups.length} 个`}
                  title={`共 ${groups.length} 个工作区`}
                  onClick={() => setSwitchOpen((v) => !v)}
                >
                  <span className="wire-agent-switch-n">{groups.length}</span>
                  <span className="wire-agent-switch-chev" aria-hidden>
                    ▾
                  </span>
                </button>
              ) : null}
              {onAddProject ? (
                <button
                  type="button"
                  className="wire-agent-switch-add"
                  aria-label="增加项目"
                  title="增加项目"
                  onClick={() => {
                    setSwitchOpen(false);
                    onAddProject();
                  }}
                >
                  +
                </button>
              ) : null}
            </div>
            {switchOpen && canSwitch && menuBox ? (
              <div
                className="wire-agent-switch-menu"
                role="listbox"
                aria-label="工作区"
                style={{
                  top: menuBox.top,
                  left: menuBox.left,
                  width: menuBox.width,
                }}
              >
                {groups.map((g) => {
                  const on = g.id === current.id;
                  const root = g.branches[0]?.root;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      className={`wire-agent-switch-opt${on ? " is-current" : ""}`}
                      title={g.path ? `${g.label}\n${g.path}` : g.label}
                      onClick={() => {
                        if (root) onSelect(root.id);
                        setSwitchOpen(false);
                      }}
                    >
                      <WorkspaceCopy
                        label={g.label}
                        path={g.path}
                        nameClass="wire-agent-switch-opt-name"
                      />
                      <span className="wire-agent-switch-opt-n">
                        {groupAgentCount(g)}
                      </span>
                      {groupHasRun(g, termNames) ? (
                        <span className="wire-agent-switch-run">在跑</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          {hasRoster ? (
            <div className="wire-agent-roster" role="tree">
              {rosterRows.map(({ branch, showRoot, children }) => (
                <div key={branch.root.id} className="wire-agent-branch">
                  {showRoot ? (
                    <AgentRow
                      agent={branch.root}
                      label={rosterLabel(branch.root, current.label)}
                      activeId={activeId}
                      onSelect={onSelect}
                      hasTerminal={
                        termNames.has(branch.root.name) ||
                        children.some((c) => termNames.has(c.name))
                      }
                    />
                  ) : null}
                  {children.map((child) => (
                    <AgentRow
                      key={child.id}
                      agent={child}
                      label={rosterLabel(child, current.label)}
                      activeId={activeId}
                      onSelect={onSelect}
                      indent
                      hasTerminal={termNames.has(child.name)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function AgentRow({
  agent,
  label,
  activeId,
  onSelect,
  hasTerminal,
  indent,
}: {
  agent: DraftAgent;
  label: string;
  activeId: string;
  onSelect: (id: string) => void;
  hasTerminal?: boolean;
  indent?: boolean;
}) {
  const active = agent.id === activeId;
  const statusTitle = STATUS_LABEL_ZH[agent.status];

  return (
    <div className={`wire-agent-row-wrap${indent ? " is-child" : ""}`}>
      <button
        type="button"
        role="treeitem"
        aria-selected={active}
        className={`wire-agent-item status-${agent.status}${
          agent.stale ? " is-stale" : ""
        }${active ? " active" : ""}`}
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

function ImInbox({
  agents,
  activeId,
  onSelect,
}: {
  agents: DraftAgent[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const rows = buildImInbox(agents);
  if (rows.length === 0) {
    return <div className="wire-agent-empty">暂无 agent 可对话</div>;
  }
  return (
    <div className="wire-im-inbox" role="list" aria-label="IM 收件箱">
      {rows.map((a) => {
        const on = a.id === activeId;
        const statusTitle = STATUS_LABEL_ZH[a.status];
        const scope = a.group === "project" ? a.projectName || "项目" : "系统";
        return (
          <button
            key={a.id}
            type="button"
            role="listitem"
            className={`wire-agent-item wire-im-row status-${a.status}${
              on ? " active" : ""
            }`}
            aria-selected={on}
            onClick={() => onSelect(a.id)}
            title={[a.displayName || a.name, statusTitle, scope]
              .filter(Boolean)
              .join(" · ")}
          >
            <span className="wire-agent-status-sq" aria-hidden>
              <StatusMark kind={a.status} size={10} title={statusTitle} />
            </span>
            <span className="wire-agent-main">
              <span className="wire-agent-name">{a.displayName || a.name}</span>
              <span className="wire-im-sub">
                {statusTitle}
                {a.overview ? ` · ${a.overview}` : ` · ${a.role}`}
                {` · ${scope}`}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
