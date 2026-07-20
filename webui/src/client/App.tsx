import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { TerminalPanel, type OpenTerminalRequest } from "./TerminalPanel";
import { MarkdownWorkbench } from "./markdown";
import "./markdown/styles.css";
import { fetchMeta, type Meta } from "./api";

type ViewMode = "chat" | "markdown" | "split";

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [openTerm, setOpenTerm] = useState<OpenTerminalRequest>(null);
  const [openMd, setOpenMd] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("chat");

  useEffect(() => {
    void fetchMeta()
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);

  const onOpenTerminal = useCallback(
    (id: string, agentName?: string) => {
      setOpenTerm({ id, agentName: agentName || meta?.agentName || "coding" });
      if (view === "markdown") setView("chat");
    },
    [meta?.agentName, view],
  );

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">MAOU</span>
        <nav className="view-tabs" aria-label="views">
          <button
            type="button"
            className={view === "chat" ? "active" : ""}
            onClick={() => setView("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            className={view === "markdown" ? "active" : ""}
            onClick={() => setView("markdown")}
          >
            Markdown
          </button>
          <button
            type="button"
            className={view === "split" ? "active" : ""}
            onClick={() => setView("split")}
            title="聊天 + Markdown 并排"
          >
            Split
          </button>
        </nav>
        <span className="meta">
          {meta
            ? `${meta.provider || "?"}/${meta.model || "?"} · ${meta.projectRoot} · ${meta.agentName || "coding"} · ${meta.sandboxMode}`
            : "loading…"}
        </span>
      </header>

      {view === "chat" && (
        <div className="main">
          <ChatPanel
            defaultAgent={meta?.agentName || "coding"}
            onOpenTerminal={onOpenTerminal}
          />
          <TerminalPanel
            defaultAgent={meta?.agentName || "coding"}
            openRequest={openTerm}
            onOpenConsumed={() => setOpenTerm(null)}
          />
        </div>
      )}

      {view === "markdown" && (
        <div className="main main-editor">
          <MarkdownWorkbench
            openPath={openMd}
            onOpenConsumed={() => setOpenMd(null)}
          />
        </div>
      )}

      {view === "split" && (
        <div className="main main-split">
          <ChatPanel
            defaultAgent={meta?.agentName || "coding"}
            onOpenTerminal={onOpenTerminal}
          />
          <MarkdownWorkbench
            openPath={openMd}
            onOpenConsumed={() => setOpenMd(null)}
          />
        </div>
      )}
    </div>
  );
}
