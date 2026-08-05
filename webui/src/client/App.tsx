/**
 * Production SPA shell — draft-aligned wire chrome with live APIs.
 *
 * Layout matches DraftShell product sketch:
 *   top:    modes 聊天 / 项目 / Team / 设置 + meta + 文件
 *   left:   agent list + session list (ChatPanel ThreadRail portal)
 *   center: live ChatPanel (stream / slash / approval / model)
 *   right:  LiveFilesRail (FilesRail + live FS) when 文件 open
 *   bottom: BottomInfoBar dock boards (log / tasks / terminal / agent)
 *
 * TerminalPanel: dock terminal board expand or Ctrl+` / tool-card open.
 * draft.html stays fixture-isolated (main-draft.tsx); this file is live only.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ChatPanel } from "./ChatPanel";
import type { OpenTerminalRequest } from "./TerminalPanel";
import {
  fetchAgents,
  fetchMeta,
  fetchTerminals,
  setActiveAgent,
  type LiveAgentInfo,
  type Meta,
} from "./api";
import type { DraftBgTask, UiMode } from "./drafts/types";
import type { DockCardId } from "./drafts/bottom-dock";
import { BottomInfoBar } from "./drafts/panels/BottomInfoBar";
import { TeamBoard } from "./drafts/panels/TeamBoard";
import { WireTopbar } from "./drafts/layout/WireTopbar";
import { ResizeHandle } from "./drafts/layout/ResizeHandle";
import { AgentList } from "./drafts/panels/AgentList";
import {
  liveAgentsToDraftAgents,
  metaToAgents,
  metaToDraftMeta,
  terminalsToBgTasks,
  terminalsToTermLines,
  usageLabelFromMeta,
} from "./live/adapters";
import { LiveFilesRail } from "./live/LiveFilesRail";
import { LiveSettingsPanel } from "./live/LiveSettingsPanel";
import "./drafts/draft.css";
import "./live-shell.css";

/** xterm TerminalPanel — only when user opens terminal (not chat first paint). */
const TerminalPanelLazy = lazy(() =>
  import("./TerminalPanel").then((m) => ({ default: m.TerminalPanel })),
);

/** Project workbench + optional CodeMirror path — only in 项目 mode. */
const LiveProjectHostLazy = lazy(() =>
  import("./live/LiveProjectHost").then((m) => ({
    default: m.LiveProjectHost,
  })),
);

/** 主动智能 — 底栏 dock 卡片（非顶栏独立页） */
const ProactiveHostLazy = lazy(() =>
  import("./live/ProactiveHost").then((m) => ({
    default: m.ProactiveHost,
  })),
);

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
  /** Request bottom-dock board open (terminal lives in the 终端 folder card). */
  const [dockOpenReq, setDockOpenReq] = useState<{
    tab: DockCardId;
    nonce: number;
  } | null>(null);
  /** Match draft fixtures default: files rail open */
  const [showFiles, setShowFiles] = useState(true);
  const [agentBusy, setAgentBusy] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [leftW, setLeftW] = useState(LEFT_DEFAULT);
  const [agentPct, setAgentPct] = useState(AGENT_H_DEFAULT);
  const [railW, setRailW] = useState(RAIL_DEFAULT);
  const [termLinesRaw, setTermLinesRaw] = useState<string[]>([
    "$ ready · no agent terminals",
  ]);
  const [chatLogLines, setChatLogLines] = useState<string[]>([]);
  const [bgTasks, setBgTasks] = useState<DraftBgTask[]>([]);
  /** Live agent registry list (CLI-aligned); null = not loaded yet */
  const [liveAgentRows, setLiveAgentRows] = useState<LiveAgentInfo[] | null>(
    null,
  );
  const [activeAgentName, setActiveAgentName] = useState<string>("coding");
  /** Empty until /api/agents hydrates — never assume system:coding (ops list may only have system:main). */
  const [activeSwitchId, setActiveSwitchId] = useState<string>("");
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(
    null,
  );
  /** Dock log board: live chat system/tool lines + agent terminals */
  const termLines = useMemo(() => {
    if (!chatLogLines.length) return termLinesRaw;
    return [...chatLogLines.slice(-12), ...termLinesRaw.slice(0, 12)];
  }, [chatLogLines, termLinesRaw]);

  useEffect(() => {
    void fetchMeta()
      .then((m) => {
        setMeta(m);
        setMetaOffline(false);
        if (m.agentName) setActiveAgentName(m.agentName);
      })
      .catch(() => {
        setMeta(null);
        setMetaOffline(true);
      });
  }, []);

  // CLI-aligned agent list poll (ops list + presence) — only commit on real change
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetchAgents();
        if (cancelled) return;
        setLiveAgentRows((prev) => {
          const next = r.agents;
          if (
            prev &&
            prev.length === next.length &&
            prev.every(
              (a, i) =>
                a.id === next[i]?.id &&
                a.status === next[i]?.status &&
                a.name === next[i]?.name &&
                a.displayName === next[i]?.displayName &&
                a.overview === next[i]?.overview,
            )
          ) {
            return prev;
          }
          return next;
        });
        if (r.activeAgentName) {
          const name = r.activeAgentName;
          setActiveAgentName((prev) => (prev === name ? prev : name));
        }
        if (r.activeSwitchId) {
          const sid = r.activeSwitchId;
          setActiveSwitchId((prev) => (prev === sid ? prev : sid));
        }
        {
          const proj = r.activeProjectPath ?? null;
          setActiveProjectPath((prev) => (prev === proj ? prev : proj));
        }
      } catch {
        /* keep previous agents on poll failure */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Dock boards: poll live agent terminals — 含全部 Agent 持久终端（切换不杀）
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        // 始终拉全部 Agent 终端，背景 Agent 的 running 终端也能进 dock / 任务板
        let ts = await fetchTerminals(undefined, { all: true });
        if (ts.length === 0) {
          const agent = meta?.agentName || "coding";
          ts = await fetchTerminals(agent);
        }
        if (cancelled) return;
        const nextLines = terminalsToTermLines(ts);
        const nextTasks = terminalsToBgTasks(ts);
        setTermLinesRaw((prev) =>
          prev.length === nextLines.length &&
          prev.every((l, i) => l === nextLines[i])
            ? prev
            : nextLines,
        );
        setBgTasks((prev) => {
          if (
            prev.length === nextTasks.length &&
            prev.every(
              (t, i) =>
                t.id === nextTasks[i]?.id &&
                t.status === nextTasks[i]?.status &&
                t.title === nextTasks[i]?.title,
            )
          ) {
            return prev;
          }
          return nextTasks;
        });
      } catch {
        if (!cancelled) {
          setTermLinesRaw((prev) =>
            prev.length === 1 && prev[0] === "$ terminal poll offline"
              ? prev
              : ["$ terminal poll offline"],
          );
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
        setLeftW((w) => (w <= LEFT_MIN + 4 ? LEFT_DEFAULT : LEFT_MIN));
        return;
      }
      if (e.key === "`" || e.key.toLowerCase() === "j") {
        if (e.shiftKey) return;
        e.preventDefault();
        setMode("chat");
        setDockOpenReq({ tab: "terminal", nonce: Date.now() });
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
      setDockOpenReq({ tab: "terminal", nonce: Date.now() });
    },
    [meta?.agentName],
  );

  const onDockTabChange = useCallback((tab: DockCardId) => {
    // dock 卡片叠在聊天上；打开时保持 chat 可见
    if (tab === "terminal" || tab === "proactive") {
      setMode("chat");
    }
  }, []);

  const terminalFace = useMemo(
    () => (
      <Suspense
        fallback={
          <div className="live-project-hint" data-term-loading="true">
            加载终端…
          </div>
        }
      >
        <TerminalPanelLazy
          defaultAgent={activeAgentName || meta?.agentName || "coding"}
          openRequest={openTerm}
          onOpenConsumed={() => setOpenTerm(null)}
        />
      </Suspense>
    ),
    [activeAgentName, meta?.agentName, openTerm],
  );

  const proactiveFace = useMemo(
    () => (
      <Suspense
        fallback={
          <div className="proactive-host is-loading is-card">
            <div className="proactive-bar">
              <span className="proactive-hint">加载主动智能…</span>
            </div>
          </div>
        }
      >
        <ProactiveHostLazy presentation="card" />
      </Suspense>
    ),
    [],
  );

  const draftMeta = useMemo(() => {
    const base = metaToDraftMeta(meta, { offline: metaOffline });
    if (activeAgentName && activeAgentName !== base.agentName) {
      return { ...base, agentName: activeAgentName };
    }
    return base;
  }, [meta, metaOffline, activeAgentName]);

  const agents = useMemo(() => {
    if (liveAgentRows && liveAgentRows.length > 0) {
      return liveAgentsToDraftAgents(liveAgentRows, {
        activeAgentName,
        activeSwitchId,
        agentBusy,
      });
    }
    return metaToAgents(meta, agentBusy);
  }, [liveAgentRows, activeAgentName, activeSwitchId, agentBusy, meta]);

  /** 有持久终端在跑的 agent 名（左侧列表终端角标） */
  const terminalAgentNames = useMemo(() => {
    const s = new Set<string>();
    for (const t of bgTasks) {
      if (t.status === "running" && t.agent) s.add(t.agent);
    }
    return s;
  }, [bgTasks]);

  const activeAgent = useMemo(() => {
    // Prefer exact switch_id match (unique across multi-project coding rows)
    const bySwitch = agents.find((a) => a.id === activeSwitchId);
    if (bySwitch) return bySwitch;
    // Scoped name+path before bare name (avoid maou-example vs maou-sdk collision)
    if (activeProjectPath) {
      const byPath = agents.find(
        (a) =>
          a.name === activeAgentName && a.projectPath === activeProjectPath,
      );
      if (byPath) return byPath;
    }
    // System-only name match (no projectPath)
    const bySystemName = agents.find(
      (a) => a.name === activeAgentName && a.group === "system",
    );
    if (bySystemName) return bySystemName;
    return null;
  }, [agents, activeSwitchId, activeAgentName, activeProjectPath]);

  /** agentId is CLI switch_id from AgentList (project:<path>:<name> or system:<name>) */
  const onSelectAgent = useCallback(async (agentId: string) => {
    const hit = agents.find((a) => a.id === agentId);
    const switchId = hit?.id || agentId;
    // No-op if already active (avoid ChatPanel remount flicker)
    if (switchId === activeSwitchId) return;
    try {
      const r = await setActiveAgent(switchId);
      setActiveAgentName(r.activeAgentName);
      setActiveSwitchId(r.activeSwitchId || switchId);
      setActiveProjectPath(r.activeProjectPath);
      setLiveAgentRows(r.agents);
      setMeta(r.meta);
      setMetaOffline(false);
    } catch (e) {
      console.error("[webui] setActiveAgent failed", e);
      setActiveSwitchId(switchId);
      if (hit?.name) setActiveAgentName(hit.name);
      if (hit?.projectPath !== undefined) {
        setActiveProjectPath(hit.projectPath ?? null);
      }
    }
  }, [agents, activeSwitchId]);
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
  }, []);

  /** Stable callback for LiveSettingsPanel (avoid mount reload identity thrash) */
  const onSettingsMetaChange = useCallback((m: Meta) => {
    setMeta(m);
    setMetaOffline(false);
  }, []);

  /**
   * ChatPanel pushMeta → onMetaChange. Must be stable: agent/terminal polls
   * re-render App every 2s; an inline onMetaChange remade bootstrap() and
   * re-hydrated sessions/history → left rail + composer flicker.
   */
  const onChatMetaChange = useCallback((m: Meta) => {
    setMeta(m);
    setMetaOffline(false);
    if (m.agentName) setActiveAgentName(m.agentName);
  }, []);

  const onSettingsClose = useCallback(() => {
    setMode("chat");
  }, []);

  /** Chat mid stays mounted so stream/session state survives mode switches */
  const chatVisible = mode === "chat";

  return (
    <div
      className={`wire-shell draft-shell live-shell${
        mode === "settings" ? " has-settings" : ""
      }`}
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
          <LiveSettingsPanel
            presentation="page"
            onClose={onSettingsClose}
            onMetaChange={onSettingsMetaChange}
          />
        </div>
      ) : null}

      {mode === "project" ? (
        <div className="wire-mid is-project" data-live-region="project">
          <Suspense
            fallback={
              <div className="live-project-host is-loading">
                <div className="live-project-bar">
                  <span className="live-project-hint">加载项目界面…</span>
                </div>
              </div>
            }
          >
            <LiveProjectHostLazy
              projectLabel={draftMeta.projectLabel}
              projectPath={draftMeta.projectPath}
            />
          </Suspense>
        </div>
      ) : null}

      {mode === "team" ? (
        <div className="wire-mid is-team" data-live-region="team">
          <TeamBoard />
        </div>
      ) : null}

      {/* Always mount chat engine; hide when other modes active */}
      <div
        className={`wire-mid is-chat${chatVisible ? "" : " is-hidden-mode"}`}
        data-live-region="chat"
        hidden={!chatVisible}
        aria-hidden={!chatVisible}
      >
        <div className="wire-left" style={{ width: leftW }}>
          <div
            className="wire-left-agents"
            style={{ flex: `0 0 ${agentPct}%` }}
          >
            <AgentList
              agents={agents}
              activeId={activeAgent?.id ?? activeSwitchId ?? ""}
              onSelect={(id) => {
                void onSelectAgent(id);
              }}
              terminalAgentNames={terminalAgentNames}
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
          {/* key remount: agent switch rebuilds session rail + history for new workspace */}
          <ChatPanel
            key={activeSwitchId || activeAgentName || "agent"}
            layout="codex"
            chrome="wire"
            className="wire-context"
            defaultAgent={activeAgentName || meta?.agentName || "coding"}
            onOpenTerminal={onOpenTerminal}
            onMetaChange={onChatMetaChange}
            threadRailId={LIVE_SESSION_RAIL_ID}
            onBusyChange={setAgentBusy}
            onSessionTitleChange={setSessionTitle}
            onDockLogLines={setChatLogLines}
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
              <LiveFilesRail />
            </div>
          </>
        )}

      </div>

      <BottomInfoBar
        termLines={termLines}
        bgTasks={bgTasks}
        meta={draftMeta}
        activeAgent={activeAgent}
        agentBusy={agentBusy}
        agents={agents}
        onTabChange={onDockTabChange}
        terminalFace={terminalFace}
        proactiveFace={proactiveFace}
        openTabRequest={dockOpenReq}
      />
    </div>
  );
}
