/**
 * Codex-style coding agent shell
 * (layout reference: frost-branch-mint-sand.grok.me)
 *
 *   left   — brand · New task · Sessions · Workspace card
 *   center — topbar · conversation · composer
 *   right  — Files | Terminal tabs
 *
 */
import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { TerminalPanel, type OpenTerminalRequest } from "./TerminalPanel";
import { MarkdownWorkbench } from "./markdown";
import "./markdown/styles.css";
import { fetchMeta, type Meta } from "./api";

type Workspace = "work" | "docs";
type RightTab = "none" | "terminal" | "docs";

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [openTerm, setOpenTerm] = useState<OpenTerminalRequest>(null);
  const [workspace, setWorkspace] = useState<Workspace>("work");
  const [rightPanel, setRightPanel] = useState<RightTab>("terminal");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);

  useEffect(() => {
    void fetchMeta()
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "b" && !e.shiftKey) {
        e.preventDefault();
        setSidebarCollapsed((c) => !c);
        return;
      }
      if (e.key === "`" || e.key.toLowerCase() === "j") {
        if (e.shiftKey) return;
        e.preventDefault();
        setWorkspace("work");
        setRightPanel((p) => (p === "terminal" ? "none" : "terminal"));
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setWorkspace("work");
        setRightPanel((p) => (p === "docs" ? "none" : "docs"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onOpenTerminal = useCallback(
    (id: string, agentName?: string) => {
      setOpenTerm({ id, agentName: agentName || meta?.agentName || "coding" });
      setWorkspace("work");
      setRightPanel("terminal");
    },
    [meta?.agentName],
  );

  const projectLabel = meta?.projectRoot
    ? meta.projectRoot.split("/").filter(Boolean).slice(-2).join("/")
    : "project";

  const projectPath = meta?.projectRoot
    ? `~/${meta.projectRoot.split("/").filter(Boolean).slice(-2).join("/")}`
    : "~/project";

  const modelLabel =
    meta?.provider || meta?.model
      ? `${meta.provider || "—"}${meta.model ? ` · ${meta.model}` : ""}`
      : "model offline";

  return (
    <div
      className={`app codex-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
    >
      <aside className="codex-sidebar" aria-label="sidebar">
        <div className="sidebar-brand">
          <div className="brand-left">
            {!sidebarCollapsed && (
              <>
                <span className="brand-mark" aria-hidden>
                  ⌘
                </span>
                <div className="brand-text">
                  <div className="brand-name">Maou</div>
                  <div className="brand-sub">coding agent</div>
                </div>
              </>
            )}
            {sidebarCollapsed && <span className="brand-mark">⌘</span>}
          </div>
          <button
            type="button"
            className="sidebar-collapse"
            title={
              sidebarCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse (Ctrl+B)"
            }
            onClick={() => setSidebarCollapsed((c) => !c)}
          >
            {sidebarCollapsed ? "›" : "‹"}
          </button>
        </div>

        {!sidebarCollapsed && (
          <div className="sidebar-mode-tabs" aria-label="workspace">
            <button
              type="button"
              className={workspace === "work" ? "active" : ""}
              onClick={() => setWorkspace("work")}
            >
              Work
            </button>
            <button
              type="button"
              className={workspace === "docs" ? "active" : ""}
              onClick={() => setWorkspace("docs")}
            >
              Docs
            </button>
          </div>
        )}

        {workspace === "work" && !sidebarCollapsed && (
          <div className="sidebar-threads" id="codex-thread-rail" />
        )}

        {!sidebarCollapsed && (
          <div className="sidebar-footer">
            <div className="workspace-card">
              <p className="workspace-card-label">Workspace</p>
              <p className="workspace-card-path" title={meta?.projectRoot || ""}>
                {projectPath}
              </p>
            </div>
            <div
              className={`sidebar-meta dim${
                meta && !meta.provider && !meta.model ? " is-warn" : ""
              }`}
              style={{ marginTop: 8 }}
              title={
                meta?.provider
                  ? `${meta.provider}/${meta.model}`
                  : "Start backend :8787 if offline"
              }
            >
              {meta
                ? `${meta.agentName || "coding"} · ${meta.sandboxMode || "yolo"} · ${modelLabel}`
                : "connecting…"}
            </div>
          </div>
        )}
      </aside>

      <div className="codex-main">
        <header className="codex-topbar">
          <div className="topbar-left">
            <div className="topbar-path" title={meta?.projectRoot || ""}>
              <span aria-hidden>📁</span>
              <span>{projectLabel}</span>
              {sessionTitle || meta?.sessionId ? (
                <>
                  <span className="topbar-path-sep">/</span>
                  <span className="topbar-title">
                    {sessionTitle ||
                      (meta?.sessionId
                        ? meta.sessionId.slice(0, 12) + "…"
                        : "Agent")}
                  </span>
                </>
              ) : (
                <span className="topbar-title">
                  {workspace === "work" ? "Agent" : "Documents"}
                </span>
              )}
            </div>
            {workspace === "work" && (
              <span
                className={`topbar-chip${agentBusy ? " busy" : ""}`}
              >
                {agentBusy ? "running" : "ready"}
              </span>
            )}
          </div>
          <div className="topbar-right">
            {workspace === "work" && (
              <>
                <span className="model-pill" title="Current model">
                  <span className="dot" />
                  {meta?.model || meta?.provider || "—"}
                </span>
                <div className="rail-tabs" role="tablist" aria-label="right panel">
                  <button
                    type="button"
                    role="tab"
                    className={rightPanel === "docs" ? "active" : ""}
                    title="Ctrl+Shift+F"
                    onClick={() =>
                      setRightPanel((p) => (p === "docs" ? "none" : "docs"))
                    }
                  >
                    Files
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={rightPanel === "terminal" ? "active" : ""}
                    title="Ctrl+` / Ctrl+J"
                    onClick={() =>
                      setRightPanel((p) =>
                        p === "terminal" ? "none" : "terminal",
                      )
                    }
                  >
                    Terminal
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <div
          className={`codex-body${
            workspace === "work" && rightPanel !== "none" ? " with-rail" : ""
          }`}
        >
          {workspace === "work" && (
            <>
              <div className="codex-thread">
                <ChatPanel
                  layout="codex"
                  defaultAgent={meta?.agentName || "coding"}
                  onOpenTerminal={onOpenTerminal}
                  onMetaChange={setMeta}
                  threadRailId="codex-thread-rail"
                  onBusyChange={setAgentBusy}
                  onSessionTitleChange={setSessionTitle}
                />
              </div>
              {rightPanel === "terminal" && (
                <aside className="codex-rail" aria-label="terminal">
                  <TerminalPanel
                    defaultAgent={meta?.agentName || "coding"}
                    openRequest={openTerm}
                    onOpenConsumed={() => setOpenTerm(null)}
                  />
                </aside>
              )}
              {rightPanel === "docs" && (
                <aside className="codex-rail codex-rail-wide" aria-label="files">
                  <MarkdownWorkbench />
                </aside>
              )}
            </>
          )}

          {workspace === "docs" && (
            <div className="codex-full">
              <MarkdownWorkbench />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
