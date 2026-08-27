import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { OpenTerminalRequest } from "../TerminalPanel";
import type { LiveAgentInfo, Meta } from "../api";
import type { DraftBgTask, UiMode } from "../drafts/types";
import type { DockCardId } from "../dock-plugin/ids";
import { useAppPorts } from "../ports";
import {
  liveAgentsToDraftAgents,
  metaToAgents,
  metaToDraftMeta,
  terminalsToBgTasks,
  terminalsToTermLines,
  usageLabelFromMeta,
} from "../live/adapters";
import { SHELL_LEFT, LIVE_FILES_RAIL } from "../shell/metrics";
import {
  FILES_ACTIVITY_ID,
  LEFT_ACTIVITY_TABS,
  RIGHT_ACTIVITY_TABS,
  SIDEBAR_ACTIVITY_ID,
} from "../shell/activity";
import type { WireHostBag } from "../shell/types";

export const LIVE_SESSION_RAIL_ID = "live-session-rail";

const TerminalPanelLazy = lazy(() =>
  import("../TerminalPanel").then((m) => ({ default: m.TerminalPanel })),
);

const ProactiveHostLazy = lazy(() =>
  import("../live/ProactiveHost").then((m) => ({
    default: m.ProactiveHost,
  })),
);

export function useLiveHostBag(): WireHostBag {
  const ports = useAppPorts();
  const { fetchMeta, fetchAgents, setActiveAgent, fetchTerminals } = ports.shell;

  const [mode, setMode] = useState<UiMode>("chat");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaOffline, setMetaOffline] = useState(true);
  const [openTerm, setOpenTerm] = useState<OpenTerminalRequest>(null);
  const [dockOpenReq, setDockOpenReq] = useState<{
    tab: DockCardId;
    nonce: number;
  } | null>(null);
  const [showFiles, setShowFiles] = useState(true);
  const [showLeft, setShowLeft] = useState(true);
  const [agentBusy, setAgentBusy] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [leftW, setLeftW] = useState<number>(SHELL_LEFT.default);
  const [agentPct, setAgentPct] = useState<number>(SHELL_LEFT.agentPct);
  const [railW, setRailW] = useState<number>(LIVE_FILES_RAIL.default);
  const [termLinesRaw, setTermLinesRaw] = useState<string[]>([
    "$ ready · no agent terminals",
  ]);
  const [chatLogLines, setChatLogLines] = useState<string[]>([]);
  const [bgTasks, setBgTasks] = useState<DraftBgTask[]>([]);
  const [liveAgentRows, setLiveAgentRows] = useState<LiveAgentInfo[] | null>(
    null,
  );
  const [activeAgentName, setActiveAgentName] = useState<string>("coding");
  const [activeSwitchId, setActiveSwitchId] = useState<string>("");
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(
    null,
  );
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
  }, [fetchMeta]);

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
  }, [fetchAgents]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
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
  }, [fetchTerminals, meta?.agentName]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "b" && !e.shiftKey) {
        e.preventDefault();
        setLeftW((w) => (w <= SHELL_LEFT.min + 4 ? SHELL_LEFT.default : SHELL_LEFT.min));
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
    if (tab === "terminal" || tab === "proactive") {
      setMode("chat");
    }
  }, []);

  const dockFaces = useMemo(
    () => ({
      terminal: (
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
      proactive: (
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
    }),
    [activeAgentName, meta?.agentName, openTerm],
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

  const terminalAgentNames = useMemo(() => {
    const s = new Set<string>();
    for (const t of bgTasks) {
      if (t.status === "running" && t.agent) s.add(t.agent);
    }
    return s;
  }, [bgTasks]);

  const activeAgent = useMemo(() => {
    const bySwitch = agents.find((a) => a.id === activeSwitchId);
    if (bySwitch) return bySwitch;
    if (activeProjectPath) {
      const byPath = agents.find(
        (a) =>
          a.name === activeAgentName && a.projectPath === activeProjectPath,
      );
      if (byPath) return byPath;
    }
    const bySystemName = agents.find(
      (a) => a.name === activeAgentName && a.group === "system",
    );
    if (bySystemName) return bySystemName;
    return null;
  }, [agents, activeSwitchId, activeAgentName, activeProjectPath]);

  const onSelectAgent = useCallback(
    async (agentId: string) => {
      const hit = agents.find((a) => a.id === agentId);
      const switchId = hit?.id || agentId;
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
        console.error("[app] setActiveAgent failed", e);
        setActiveSwitchId(switchId);
        if (hit?.name) setActiveAgentName(hit.name);
        if (hit?.projectPath !== undefined) {
          setActiveProjectPath(hit.projectPath ?? null);
        }
      }
    },
    [agents, activeSwitchId, setActiveAgent],
  );

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

  const onSettingsMetaChange = useCallback((m: Meta) => {
    setMeta(m);
    setMetaOffline(false);
  }, []);

  const onChatMetaChange = useCallback((m: Meta) => {
    setMeta(m);
    setMetaOffline(false);
    if (m.agentName) setActiveAgentName(m.agentName);
  }, []);

  const onSettingsClose = useCallback(() => {
    setMode("chat");
  }, []);

  return {
    variant: "live",
    mode,
    showFiles,
    showLeft,
    leftW,
    agentPct,
    railW,
    railMin: LIVE_FILES_RAIL.min,
    railMax: LIVE_FILES_RAIL.max,
    leftMin: SHELL_LEFT.min,
    leftMax: SHELL_LEFT.max,
    onLeftResize: setLeftW,
    onRailResize: setRailW,
    onAgentSplitDrag,
    sessionRailId: LIVE_SESSION_RAIL_ID,
    topbar: {
      mode,
      onModeChange,
      meta: draftMeta,
      usageLabel: sessionTitle
        ? `${usageLabel} · ${sessionTitle.slice(0, 24)}`
        : usageLabel,
    },
    leftActivity: {
      tabs: LEFT_ACTIVITY_TABS,
      activeId: showLeft && mode === "chat" ? SIDEBAR_ACTIVITY_ID : null,
      onSelect: (id) => {
        if (id !== SIDEBAR_ACTIVITY_ID) return;
        if (mode !== "chat") {
          setMode("chat");
          setShowLeft(true);
          return;
        }
        setShowLeft((v) => !v);
      },
    },
    activity: {
      tabs: RIGHT_ACTIVITY_TABS,
      activeId: showFiles && mode === "chat" ? FILES_ACTIVITY_ID : null,
      onSelect: (id) => {
        if (id !== FILES_ACTIVITY_ID) return;
        if (mode !== "chat") {
          setMode("chat");
          setShowFiles(true);
          return;
        }
        setShowFiles((v) => !v);
      },
    },
    agentList: {
      agents,
      activeId: activeAgent?.id ?? activeSwitchId ?? "",
      onSelect: (id) => {
        void onSelectAgent(id);
      },
      onOpenChat: () => setMode("chat"),
      terminalAgentNames,
    },
    dock: {
      termLines,
      bgTasks,
      meta: draftMeta,
      activeAgent,
      agentBusy,
      agents,
      onTabChange: onDockTabChange,
      faces: dockFaces,
      openTabRequest: dockOpenReq,
    },
    chat: {
      remountKey: activeSwitchId || activeAgentName || "agent",
      layout: "codex",
      chrome: "wire",
      className: "wire-context",
      defaultAgent: activeAgentName || meta?.agentName || "coding",
      onOpenTerminal,
      onMetaChange: onChatMetaChange,
      threadRailId: LIVE_SESSION_RAIL_ID,
      onBusyChange: setAgentBusy,
      onSessionTitleChange: setSessionTitle,
      onDockLogLines: setChatLogLines,
    },
    liveSettings: {
      presentation: "page",
      onClose: onSettingsClose,
      onMetaChange: onSettingsMetaChange,
    },
    project: {
      projectLabel: draftMeta.projectLabel,
      projectPath: draftMeta.projectPath,
    },
  };
}
