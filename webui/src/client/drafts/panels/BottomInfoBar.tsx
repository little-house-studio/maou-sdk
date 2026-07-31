import type { DraftAgent, DraftBgTask, DraftMeta } from "../types";
import { statusMarkKind } from "../visual-marks";
import { ChromeMark, StatusMark, TaskMark } from "../icons/Marks";

export type BottomTabId = "terminal" | "todos" | "logs";

export type BottomInfoBarProps = {
  termLines: string[];
  bgTasks?: DraftBgTask[];
  meta: DraftMeta;
  /** Optional — only used for collapsed strip status text */
  activeAgent: DraftAgent | null;
  agentBusy: boolean;
  height: number;
  collapsed: boolean;
  activeTab: BottomTabId;
  onTabChange: (tab: BottomTabId) => void;
  onExpand: () => void;
  onCollapse: () => void;
};

const TABS: { id: BottomTabId; label: string }[] = [
  { id: "terminal", label: "终端" },
  { id: "todos", label: "待办" },
  { id: "logs", label: "日志" },
];

function resolveStatus(
  agentBusy: boolean,
  agent: DraftAgent | null,
): {
  label: string;
  kind: ReturnType<typeof statusMarkKind>;
} {
  if (agentBusy || agent?.status === "running") {
    return { label: "运行中", kind: "running" };
  }
  if (agent?.status === "blocked") return { label: "待操作", kind: "blocked" };
  if (agent?.status === "needs_reply")
    return { label: "待回复", kind: "needs_reply" };
  if (agent?.status === "done_unread")
    return { label: "完成·未读", kind: "done_unread" };
  if (agent?.status === "done_read")
    return { label: "完成", kind: "done_read" };
  return { label: "空闲", kind: "idle" };
}

type TodoItem = {
  id: string;
  title: string;
  done: boolean;
  agent?: string;
};

function todosFromTasks(bgTasks: DraftBgTask[] | undefined): TodoItem[] {
  if (bgTasks?.length) {
    return bgTasks.map((t) => ({
      id: t.id,
      title: t.title,
      done: t.status === "done",
      agent: t.agent,
    }));
  }
  return [
    { id: "td-1", title: "对齐 draft 中栏悬浮布局", done: true },
    { id: "td-2", title: "底栏可收纳 + 多标签", done: false },
    { id: "td-3", title: "会话按 agent 过滤", done: true },
  ];
}

function logLinesFrom(
  termLines: string[],
  meta: DraftMeta,
  agentBusy: boolean,
): string[] {
  const stamp = new Date().toISOString().slice(11, 19);
  const head = [
    `[${stamp}] INFO  draft shell ready`,
    `[${stamp}] INFO  agent=${meta.agentName} sandbox=${meta.sandboxMode}`,
    `[${stamp}] INFO  model=${meta.provider || "—"}/${meta.model || "—"}`,
  ];
  if (agentBusy) head.push(`[${stamp}] WARN  agent busy / streaming`);
  const fromTerm = termLines
    .filter(Boolean)
    .slice(0, 40)
    .map((l) => `[term] ${l}`);
  return [...head, ...fromTerm];
}

/**
 * 底栏：终端 / 待办 / 日志 多页签；可向下拖拽收纳成一条状态条。
 */
export function BottomInfoBar({
  termLines,
  bgTasks,
  meta,
  activeAgent,
  agentBusy,
  height,
  collapsed,
  activeTab,
  onTabChange,
  onExpand,
  onCollapse,
}: BottomInfoBarProps) {
  const name = activeAgent?.name ?? meta.agentName;
  const st = resolveStatus(agentBusy, activeAgent);
  const todos = todosFromTasks(bgTasks);
  const logs = logLinesFrom(termLines, meta, agentBusy);
  const openTodos = todos.filter((t) => !t.done).length;

  if (collapsed) {
    return (
      <footer
        className="wire-bottom-bar is-collapsed"
        style={{ height }}
        aria-label="底栏（已收纳）"
      >
        <div className="wire-bottom-collapsed">
          <div className="wire-bottom-tabs sm" role="tablist" aria-label="底栏页签">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                className={`wire-bottom-tab${activeTab === t.id ? " active" : ""}`}
                onClick={() => {
                  onTabChange(t.id);
                  onExpand();
                }}
              >
                {t.label}
                {t.id === "todos" && openTodos > 0 ? (
                  <span className="wire-bottom-tab-badge">{openTodos}</span>
                ) : null}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="wire-bottom-collapsed-main"
            onClick={onExpand}
            title="展开底栏"
          >
            <StatusMark kind={st.kind} size={11} title={st.label} />
            <span className="wire-bottom-collapsed-agent">{name}</span>
            <span className="wire-bottom-collapsed-st">{st.label}</span>
            <span className="wire-bottom-collapsed-hint">
              {activeTab === "terminal"
                ? termLines[termLines.length - 1] || "终端"
                : activeTab === "todos"
                  ? `${openTodos} 项待办`
                  : `${logs.length} 条日志`}
            </span>
          </button>
          <button
            type="button"
            className="wire-bottom-collapse-btn"
            onClick={onExpand}
            aria-label="展开底栏"
            title="展开"
          >
            ▴
          </button>
        </div>
      </footer>
    );
  }

  return (
    <footer
      className="wire-bottom-bar is-expanded"
      style={{ height }}
      aria-label="底栏"
    >
      <div className="wire-bottom-main">
        <div className="wire-bottom-toolbar">
          <div className="wire-bottom-tabs" role="tablist" aria-label="底栏页签">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                className={`wire-bottom-tab${activeTab === t.id ? " active" : ""}`}
                onClick={() => onTabChange(t.id)}
              >
                {t.id === "terminal" ? (
                  <ChromeMark kind="terminal" size={12} decorative />
                ) : t.id === "todos" ? (
                  <ChromeMark kind="tasks" size={12} decorative />
                ) : (
                  <ChromeMark kind="scenario" size={12} decorative />
                )}
                {t.label}
                {t.id === "todos" && openTodos > 0 ? (
                  <span className="wire-bottom-tab-badge">{openTodos}</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="wire-bottom-toolbar-right">
            <span className="wire-bottom-term-hint">
              {activeTab === "terminal"
                ? "模拟 · 无 PTY"
                : activeTab === "todos"
                  ? "本地草稿待办"
                  : "应用 / 终端日志"}
            </span>
            <button
              type="button"
              className="wire-bottom-collapse-btn"
              onClick={onCollapse}
              aria-label="收纳底栏"
              title="向下收纳（也可拖拽分隔条）"
            >
              ▾
            </button>
          </div>
        </div>

        <div className="wire-bottom-panel" role="tabpanel">
          {activeTab === "terminal" && (
            <pre className="wire-term-pre">
              {termLines.length ? termLines.join("\n") : "（终端空）"}
            </pre>
          )}
          {activeTab === "todos" && (
            <ul className="wire-bottom-todo-list">
              {todos.map((t) => (
                <li
                  key={t.id}
                  className={`wire-bottom-todo${t.done ? " is-done" : ""}`}
                >
                  <TaskMark
                    status={t.done ? "done" : "queued"}
                    size={13}
                  />
                  <span className="wire-bottom-todo-title">{t.title}</span>
                  {t.agent ? (
                    <span className="wire-bottom-todo-agent">{t.agent}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {activeTab === "logs" && (
            <pre className="wire-term-pre wire-log-pre">
              {logs.join("\n")}
            </pre>
          )}
        </div>
      </div>
    </footer>
  );
}
