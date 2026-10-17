import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { OpenTerminalRequest } from "../TerminalPanel";
import type { ActivityAgentInfo, LiveAgentInfo, Meta } from "../api";
import { readBootShell, saveBootShell } from "../boot-cache";
import { buildActivityMenu } from "../wire/chrome/activity-agents";
import type { DraftBgTask, UiMode } from "../wire/types";
import type { DockCardId } from "../dock-plugin/ids";
import { useAppPorts } from "../ports";
import {
  liveAgentsToDraftAgents,
  metaToAgents,
  metaToDraftMeta,
  terminalsToBgTasks,
  terminalsToTermLines,
} from "../live/adapters";
import { sameStrings, visiblePoll } from "../live/poll";
import { localDayKey } from "../wire/chrome/today-tokens";
import { pickAndOpenProject } from "../live/FolderBrowse";
import { SHELL_LEFT, LIVE_FILES_RAIL } from "../shell/metrics";
import {
  FILES_ACTIVITY_ID,
  SIDEBAR_ACTIVITY_ID,
  modeShowsLeftRail,
  toggleAsideTab,
} from "../shell/activity";
import type { WireHostBag } from "../shell/types";

function sameActivityAgents(
  a: ActivityAgentInfo[],
  b: ActivityAgentInfo[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (item, i) =>
        item.id === b[i]?.id &&
        item.status === b[i]?.status &&
        item.sessionId === b[i]?.sessionId,
    )
  );
}

function opsSwitchId(
  rows: Array<{ name: string; group?: string; id: string; switchId?: string }> | null,
): string {
  const ops = rows?.find(
    (a) => a.name === "ops" && (a.group === "system" || !a.group),
  );
  return ops?.switchId || ops?.id || "system:ops";
}

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
  const { fetchMeta, fetchAgents, setActiveAgent, fetchTerminals, fetchTodayUsage } =
    ports.shell;

  const agentMutationRef = useRef(false);
  const agentEpochRef = useRef(0);
  // 上次开机看到的 Agent / meta：首帧先画它，hub 回来再换；agentsReady 仍只认真响应
  const [boot] = useState(readBootShell);
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<UiMode>("chat");
  const [meta, setMeta] = useState<Meta | null>(() => boot?.meta ?? null);
  const [metaOffline, setMetaOffline] = useState(true);
  const [openTerm, setOpenTerm] = useState<OpenTerminalRequest>(null);
  const [dockOpenReq, setDockOpenReq] = useState<{
    tab: DockCardId;
    nonce: number;
  } | null>(null);
  const [rightTab, setRightTab] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<string | null>(SIDEBAR_ACTIVITY_ID);
  const [agentBusy, setAgentBusy] = useState(false);
  const bootToday = boot?.today?.date === localDayKey() ? boot.today : undefined;
  const [todayInput, setTodayInput] = useState(bootToday?.input ?? 0);
  const [todayOutput, setTodayOutput] = useState(bootToday?.output ?? 0);
  const [todayDate, setTodayDate] = useState(() => localDayKey());
  const [leftW, setLeftW] = useState<number>(SHELL_LEFT.default);
  const [agentPct, setAgentPct] = useState<number>(SHELL_LEFT.agentPct);
  const [railW, setRailW] = useState<number>(LIVE_FILES_RAIL.default);
  const [termLinesRaw, setTermLinesRaw] = useState<string[]>([
    "$ ready · no agent terminals",
  ]);
  const [chatLogLines, setChatLogLines] = useState<string[]>([]);
  const [bgTasks, setBgTasks] = useState<DraftBgTask[]>([]);
  const [liveAgentRows, setLiveAgentRows] = useState<LiveAgentInfo[] | null>(
    () => (boot?.agents.length ? boot.agents : null),
  );
  const [activeAgentName, setActiveAgentName] = useState<string>(
    () => boot?.activeAgentName || "coding",
  );
  const [activeSwitchId, setActiveSwitchId] = useState<string>(
    () => boot?.activeSwitchId ?? "",
  );
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(
    () => boot?.activeProjectPath ?? null,
  );
  const [agentsReady, setAgentsReady] = useState(false);
  const [activityAgents, setActivityAgents] = useState<ActivityAgentInfo[]>(
    () => boot?.activityAgents ?? [],
  );
  const [chatFollowUser, setChatFollowUser] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const prevActivityRef = useRef<Map<string, string>>(new Map());
  const termLines = useMemo(() => {
    if (!chatLogLines.length) return termLinesRaw;
    return [...chatLogLines.slice(-12), ...termLinesRaw.slice(0, 12)];
  }, [chatLogLines, termLinesRaw]);

  // 服务端确认过的壳状态落一份快照，下次开机首帧直接画
  useEffect(() => {
    if (!agentsReady) return;
    saveBootShell({
      agents: liveAgentRows ?? [],
      activeAgentName,
      activeSwitchId,
      activeProjectPath,
      activityAgents,
      meta,
      today: { date: todayDate, input: todayInput, output: todayOutput },
    });
  }, [
    agentsReady,
    liveAgentRows,
    activeAgentName,
    activeSwitchId,
    activeProjectPath,
    activityAgents,
    meta,
    todayDate,
    todayInput,
    todayOutput,
  ]);

  useEffect(() => {
    if (!agentsReady) return;
    const epoch = agentEpochRef.current;
    let cancelled = false;
    void fetchMeta()
      .then((m) => {
        if (cancelled || agentMutationRef.current || epoch !== agentEpochRef.current) return;
        setMeta(m);
        setMetaOffline(false);
        if (m.agentName) setActiveAgentName(m.agentName);
      })
      .catch(() => {
        if (cancelled || agentMutationRef.current || epoch !== agentEpochRef.current) return;
        setMeta(null);
        setMetaOffline(true);
      });
    return () => { cancelled = true; };
  }, [agentsReady, fetchMeta]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (agentMutationRef.current) return;
      const epoch = agentEpochRef.current;
      try {
        const r = await fetchAgents();
        if (cancelled || agentMutationRef.current || epoch !== agentEpochRef.current) return;
        setAgentsReady(true);
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
        const nextActivity = r.activityAgents ?? [];
        setActivityAgents((prev) =>
          sameActivityAgents(prev, nextActivity) ? prev : nextActivity,
        );
      } catch {
        if (!cancelled) setAgentsReady(true);
        /* keep previous agents on poll failure */
      }
    };
    const stop = visiblePoll(tick, 2500);
    return () => {
      cancelled = true;
      stop();
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
        setTermLinesRaw((prev) => (sameStrings(prev, nextLines) ? prev : nextLines));
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
    const stop = visiblePoll(tick, 2000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [fetchTerminals, meta?.agentName]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if ((e.target as HTMLElement | null)?.closest(".term-panel, [role=dialog], .cm-editor")) return;
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
        setRightTab((cur) => toggleAsideTab(cur, FILES_ACTIVITY_ID));
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
      if (switchId === activeSwitchId || agentMutationRef.current) return;
      agentMutationRef.current = true;
      agentEpochRef.current += 1;
      setNotice("");
      try {
        const r = await setActiveAgent(switchId);
        setActiveAgentName(r.activeAgentName);
        setActiveSwitchId(r.activeSwitchId || switchId);
        setActiveProjectPath(r.activeProjectPath);
        setLiveAgentRows(r.agents);
        setMeta(r.meta);
        setMetaOffline(false);
      } catch (e) {
        setNotice(`切换 Agent 失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        agentMutationRef.current = false;
      }
    },
    [agents, activeSwitchId, setActiveAgent],
  );

  const onAddProject = useCallback(() => {
    if (agentMutationRef.current) return;
    agentMutationRef.current = true;
    agentEpochRef.current += 1;
    setNotice("");
    void (async () => {
      try {
        const root = await pickAndOpenProject();
        if (!root) return;
        const a = await fetchAgents();
        setLiveAgentRows(a.agents);
        setAgentsReady(true);
        if (a.activeAgentName) setActiveAgentName(a.activeAgentName);
        if (a.activeSwitchId) setActiveSwitchId(a.activeSwitchId);
        setActiveProjectPath(a.activeProjectPath ?? null);
        const m = await fetchMeta();
        setMeta(m);
        setMetaOffline(false);
      } catch (e) {
        setNotice(`打开项目失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        agentMutationRef.current = false;
      }
    })();
  }, [fetchMeta, fetchAgents]);

  const applyTodayUsage = useCallback(
    (t: { date?: string; inputTokens: number; outputTokens: number }) => {
      const day = t.date || localDayKey();
      setTodayDate(day);
      setTodayInput(Number.isFinite(t.inputTokens) ? t.inputTokens : 0);
      setTodayOutput(Number.isFinite(t.outputTokens) ? t.outputTokens : 0);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const day = localDayKey();
      if (day !== todayDate) {
        setTodayDate(day);
        setTodayInput(0);
        setTodayOutput(0);
      }
      try {
        const t = await fetchTodayUsage();
        if (cancelled) return;
        applyTodayUsage(t);
      } catch {
        /* keep last totals */
      }
    };
    const stop = visiblePoll(tick, 2500);
    return () => {
      cancelled = true;
      stop();
    };
  }, [applyTodayUsage, fetchTodayUsage, todayDate]);

  const onAgentSplitDrag = useCallback((clientY: number, rect: DOMRect) => {
    const y = clientY - rect.top;
    const pct = Math.min(75, Math.max(20, (y / rect.height) * 100));
    setAgentPct(pct);
  }, []);

  const onModeChange = useCallback((m: UiMode) => {
    setMode(m);
  }, []);

  useEffect(() => {
    if (mode !== "chat" || !agentsReady || chatFollowUser) return;
    if (activeAgentName === "ops") return;
    void onSelectAgent(opsSwitchId(liveAgentRows));
  }, [mode, agentsReady, chatFollowUser, activeAgentName, liveAgentRows, onSelectAgent]);

  useEffect(() => {
    let bump = false;
    for (const item of activityAgents) {
      const prev = prevActivityRef.current.get(item.id);
      if (prev === "running" && (item.status === "done" || item.status === "failed")) {
        if (activeAgentName === "ops") bump = true;
      }
      prevActivityRef.current.set(item.id, item.status);
    }
    if (bump) setReloadToken((n) => n + 1);
  }, [activityAgents, activeAgentName]);

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

  const onLeftTab = useCallback((id: string) => {
    if (modeShowsLeftRail(mode)) {
      setLeftTab((cur) => toggleAsideTab(cur, id));
      return;
    }
    setMode("chat");
    setLeftTab(id);
  }, [mode]);

  const onRightTab = useCallback((id: string) => {
    if (mode !== "chat") {
      setMode("chat");
      setRightTab(id);
      return;
    }
    setRightTab((cur) => toggleAsideTab(cur, id));
  }, [mode]);

  // ChatPanel already dedupes, but keep the array identity stable here too so
  // an identical summary never rebuilds the dock slice.
  const onDockLogLines = useCallback((next: string[]) => {
    setChatLogLines((prev) => (sameStrings(prev, next) ? prev : next));
  }, []);

  const onAgentListSelect = useCallback(
    (id: string) => {
      const hit = agents.find((a) => a.id === id);
      void onSelectAgent(id);
      if (hit?.name === "ops" && hit.group === "system") setMode("chat");
    },
    [agents, onSelectAgent],
  );

  const onOpenChat = useCallback(() => setMode("chat"), []);

  const activityMenu = useMemo(
    () =>
      buildActivityMenu({
        home: {
          switchId: opsSwitchId(liveAgentRows),
          agent: "ops",
          displayName: "OPS",
        },
        currentSwitchId: activeSwitchId || opsSwitchId(liveAgentRows),
        activity: activityAgents,
      }),
    [liveAgentRows, activeSwitchId, activityAgents],
  );

  const onSelectActivityAgent = useCallback(
    (switchId: string) => {
      setChatFollowUser(true);
      setMode("chat");
      void onSelectAgent(switchId);
    },
    [onSelectAgent],
  );

  /*
   * Each slice below is memoized on its own inputs so a token stream (which
   * touches only `agentBusy` / dock log lines) leaves topbar / agentList /
   * project untouched. Seats in live-slots.tsx are React.memo'd on the same
   * slices — keep the two in step when adding fields.
   */
  const topbar = useMemo<WireHostBag["topbar"]>(
    () => ({
      mode,
      onModeChange,
      todayInput,
      todayOutput,
      activityAgents: activityMenu,
      onSelectActivityAgent,
    }),
    [mode, onModeChange, todayInput, todayOutput, activityMenu, onSelectActivityAgent],
  );

  const agentList = useMemo<WireHostBag["agentList"]>(
    () => ({
      agents,
      activeId: activeAgent?.id ?? activeSwitchId ?? "",
      defaultTab: "project",
      onSelect: onAgentListSelect,
      onOpenChat,
      terminalAgentNames,
      onAddProject,
    }),
    [
      agents,
      activeAgent?.id,
      activeSwitchId,
      onAgentListSelect,
      onOpenChat,
      terminalAgentNames,
      onAddProject,
    ],
  );

  const dock = useMemo<WireHostBag["dock"]>(
    () => ({
      termLines,
      bgTasks,
      meta: draftMeta,
      activeAgent,
      agentBusy,
      agents,
      onTabChange: onDockTabChange,
      faces: dockFaces,
      openTabRequest: dockOpenReq,
    }),
    [
      termLines,
      bgTasks,
      draftMeta,
      activeAgent,
      agentBusy,
      agents,
      onDockTabChange,
      dockFaces,
      dockOpenReq,
    ],
  );

  const chatThreadRailId = mode === "chat" ? LIVE_SESSION_RAIL_ID : "";
  const chatModeReady =
    mode !== "chat" || activeAgentName === "ops" || chatFollowUser;
  const chat = useMemo<WireHostBag["chat"]>(
    () => ({
      remountKey: activeSwitchId || activeAgentName || "ops",
      layout: "codex",
      chrome: "wire",
      className: "wire-context",
      defaultAgent: activeAgentName || "ops",
      onOpenTerminal,
      onMetaChange: onChatMetaChange,
      threadRailId: chatThreadRailId,
      onBusyChange: setAgentBusy,
      onTodayUsageChange: applyTodayUsage,
      onDockLogLines,
      bootReady: agentsReady && chatModeReady,
      reloadToken,
    }),
    [
      activeSwitchId,
      activeAgentName,
      onOpenTerminal,
      onChatMetaChange,
      chatThreadRailId,
      applyTodayUsage,
      onDockLogLines,
      agentsReady,
      chatModeReady,
      reloadToken,
    ],
  );

  const liveSettings = useMemo<WireHostBag["liveSettings"]>(
    () => ({
      presentation: "page",
      active: mode === "settings",
      onClose: onSettingsClose,
      onMetaChange: onSettingsMetaChange,
    }),
    [onSettingsClose, onSettingsMetaChange, mode],
  );

  const project = useMemo<WireHostBag["project"]>(
    () => ({
      projectLabel: draftMeta.projectLabel,
      projectPath: draftMeta.projectPath,
    }),
    [draftMeta.projectLabel, draftMeta.projectPath],
  );

  const agentInspect = useMemo<WireHostBag["agentInspect"]>(
    () => ({ switchId: activeSwitchId }),
    [activeSwitchId],
  );

  return {
    variant: "live",
    notice,
    onDismissNotice: () => setNotice(""),
    mode,
    leftTab,
    rightTab,
    onLeftTab,
    onRightTab,
    showFiles: rightTab != null,
    showLeft: leftTab != null,
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
    topbar,
    agentList,
    dock,
    chat,
    liveSettings,
    project,
    agentInspect,
  };
}
