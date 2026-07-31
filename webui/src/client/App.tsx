/**
 * Production SPA shell — draft-aligned wire chrome with live APIs.
 *
 * Layout matches DraftShell product sketch:
 *   top:    modes 聊天 / 项目 / Team / 设置 + meta + 文件
 *   left:   agent list + session list (ChatPanel ThreadRail portal)
 *   center: live ChatPanel (stream / slash / approval / model)
 *   right:  MarkdownWorkbench when 文件 open
 *   bottom: BottomInfoBar dock boards (log / tasks / terminal / agent)
 *
 * TerminalPanel remains reachable via dock hotkey Ctrl+` / tool-card open.
 * draft.html stays fixture-isolated (main-draft.tsx); this file is live only.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { TerminalPanel, type OpenTerminalRequest } from "./TerminalPanel";
import { MarkdownWorkbench } from "./markdown";
import "./markdown/styles.css";
import { fetchMeta, fetchTerminals, type Meta } from "./api";
import {
  cloneApiConfig,
  defaultApiConfig,
  type DraftApiConfig,
  type DraftBgTask,
  type UiMode,
  BottomInfoBar,
  SettingsPanel,
  TeamBoard,
} from "./drafts";
import { WireTopbar } from "./drafts/layout/WireTopbar";
import { ResizeHandle } from "./drafts/layout/ResizeHandle";
import { AgentList } from "./drafts/panels/AgentList";
import {
  metaToAgents,
  metaToDraftMeta,
  terminalsToBgTasks,
  terminalsToTermLines,
  usageLabelFromMeta,
} from "./live/adapters";
import "./drafts/draft.css";
import "./live-shell.css";

const LEFT_DEFAULT = 260;
const LEFT_MIN = 200;
const LEFT_MAX = 360;
const AGENT_H_DEFAULT = 38;
const RAIL_DEFAULT = 320;
const RAIL_MIN = 220;
const RAIL_MAX = 520;

const LIVE_SESSION_RAIL_ID = "live-session-rail";

export function App() {
  const [mode, setMode] = useState<UiMode>("chat");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaOffline, setMetaOffline] = useState(true);
  const [openTerm, setOpenTerm] = useState<OpenTerminalRequest>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [leftW, setLeftW] = useState(LEFT_DEFAULT);
  const [agentPct, setAgentPct] = useState(AGENT_H_DEFAULT);
  const [railW, setRailW] = useState(RAIL_DEFAULT);
  const [apiConfig, setApiConfig] = useState<DraftApiConfig>(() =>
    defaultApiConfig(),
  );
  const [termLines, setTermLines] = useState<string[]>([
    "$ ready · no agent terminals",
  ]);
  const [bgTasks, setBgTasks] = useState<DraftBgTask[]>([]);

  useEffect(() => {
    void fetchMeta()
      .then((m) => {
        setMeta(m);
        setMetaOffline(false);
      })
      .catch(() => {
        setMeta(null);
        setMetaOffline(true);
      });
  }, []);

  // Dock boards: poll live agent terminals
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const agent = meta?.agentName || "coding";
        let ts = await fetchTerminals(agent);
        if (ts.length === 0) {
          ts = await fetchTerminals(undefined, { all: true });
        }
        if (cancelled) return;
        setTermLines(terminalsToTermLines(ts));
        setBgTasks(terminalsToBgTasks(ts));
      } catch {
        if (!cancelled) {
          setTermLines(["$ terminal poll offline"]);
        }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [meta?.agentName]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "b" && !e.shiftKey) {
        e.preventDefault();
        // Collapse/expand left column width (draft parity for Ctrl+B)
        setLeftW((w) => (w <= LEFT_MIN + 4 ? LEFT_DEFAULT : LEFT_MIN));
        return;
      }
      if (e.key === "`" || e.key.toLowerCase() === "j") {
        if (e.shiftKey) return;
        e.preventDefault();
        setMode("chat");
        setShowTerminal((v) => !v);
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setMode("chat");
        setShowFiles((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onOpenTerminal = useCallback(
    (id: string, agentName?: string) => {
      setOpenTerm({ id, agentName: agentName || meta?.agentName || "coding" });
      setMode("chat");
      setShowTerminal(true);
    },
    [meta?.agentName],
  );

  const onApiChange = useCallback((next: DraftApiConfig) => {
    setApiConfig(cloneApiConfig(next));
  }, []);

  const draftMeta = useMemo(
    () => metaToDraftMeta(meta, { offline: metaOffline }),
    [meta, metaOffline],
  );
  const agents = useMemo(
    () => metaToAgents(meta, agentBusy),
    [meta, agentBusy],
  );
  const activeAgent = agents[0] ?? null;
  const usageLabel = useMemo(
    () => usageLabelFromMeta(meta, agentBusy),
    [meta, agentBusy],
  );

  const onAgentSplitDrag = useCallback((clientY: number, rect: DOMRect) => {
    const y = clientY - rect.top;
    const pct = Math.min(75, Math.max(20, (y / rect.height) * 100));
    setAgentPct(pct);
  }, []);

  const onModeChange = useCallback((m: UiMode) => {
    setMode(m);
    if (m !== "chat") {
      // Keep chat engine mounted only in chat mode to avoid dual workbench
    }
  }, []);

  return (
    <div
      className={`wire-shell draft-shell live-shell${
        mode === "settings" ? " has-settings" : ""
      }${showTerminal ? " has-terminal-float" : ""}`}
      data-live-shell="true"
      data-ui-mode={mode}
    >
      <WireTopbar
        mode={mode}
        onModeChange={onModeChange}
        meta={draftMeta}
        usageLabel={
          sessionTitle
            ? `${usageLabel} · ${sessionTitle.slice(0, 24)}`
            : usageLabel
        }
        showFiles={showFiles}
        onToggleFiles={() => {
          setMode("chat");
          setShowFiles((v) => !v);
        }}
      />

      {mode === "settings" ? (
        <div className="wire-mid is-settings" data-live-region="settings">
          <SettingsPanel
            api={apiConfig}
            onApiChange={onApiChange}
            presentation="page"
            onClose={() => setMode("chat")}
          />
        </div>
      ) : mode === "project" ? (
        <div className="wire-mid is-project" data-live-region="project">
          <div className="live-project-host">
            <MarkdownWorkbench />
          </div>
        </div>
      ) : mode === "team" ? (
        <div className="wire-mid is-team" data-live-region="team">
          <TeamBoard />
        </div>
      ) : (
        <div className="wire-mid is-chat" data-live-region="chat">
          <div className="wire-left" style={{ width: leftW }}>
            <div
              className="wire-left-agents"
              style={{ flex: `0 0 ${agentPct}%` }}
            >
              <AgentList
                agents={agents}
                activeId={activeAgent?.id ?? "live-primary"}
                onSelect={() => {
                  /* single live agent today */
                }}
              />
            </div>
            <div
              className="wire-v-split"
              role="separator"
              aria-orientation="horizontal"
              aria-label="拖动调整 agent / 会话 高度"
              onPointerDown={(e) => {
                const col = e.currentTarget.parentElement as HTMLElement;
                const rect = col.getBoundingClientRect();
                const move = (ev: PointerEvent) =>
                  onAgentSplitDrag(ev.clientY, rect);
                const up = () => {
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", up);
                  document.body.style.cursor = "";
                  document.body.style.userSelect = "";
                };
                document.body.style.cursor = "row-resize";
                document.body.style.userSelect = "none";
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
            />
            <div className="wire-left-sessions">
              <div
                id={LIVE_SESSION_RAIL_ID}
                className="live-session-rail-host"
                data-live-session-rail="true"
              />
            </div>
          </div>

          <ResizeHandle
            edge="right"
            size={leftW}
            min={LEFT_MIN}
            max={LEFT_MAX}
            onResize={setLeftW}
            label="拖动调整左侧栏宽度"
          />

          <div className="wire-center" data-live-region="thread">
            <ChatPanel
              layout="codex"
              className="wire-context"
              defaultAgent={meta?.agentName || "coding"}
              onOpenTerminal={onOpenTerminal}
              onMetaChange={(m) => {
                setMeta(m);
                setMetaOffline(false);
              }}
              threadRailId={LIVE_SESSION_RAIL_ID}
              onBusyChange={setAgentBusy}
              onSessionTitleChange={setSessionTitle}
            />
          </div>

          {showFiles && (
            <>
              <ResizeHandle
                edge="left"
                size={railW}
                min={RAIL_MIN}
                max={RAIL_MAX}
                onResize={setRailW}
                label="拖动调整文件栏宽度"
              />
              <div
                className="wire-right live-files-rail"
                style={{ width: railW }}
                data-live-region="files"
              >
                <MarkdownWorkbench />
              </div>
            </>
          )}

          {showTerminal && (
            <aside
              className="wire-terminal-float"
              aria-label="agent terminal"
              data-live-region="terminal"
            >
              <div className="wire-terminal-float-head">
                <span>Terminal</span>
                <button
                  type="button"
                  className="wire-text-btn"
                  onClick={() => setShowTerminal(false)}
                  title="Close terminal (Ctrl+`)"
                >
                  关闭
                </button>
              </div>
              <TerminalPanel
                defaultAgent={meta?.agentName || "coding"}
                openRequest={openTerm}
                onOpenConsumed={() => setOpenTerm(null)}
              />
            </aside>
          )}
        </div>
      )}

      <BottomInfoBar
        termLines={termLines}
        bgTasks={bgTasks}
        meta={draftMeta}
        activeAgent={activeAgent}
        agentBusy={agentBusy}
        agents={agents}
      />
    </div>
  );
}
