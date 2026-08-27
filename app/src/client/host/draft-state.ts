import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyApprovalDecision,
  applyChildSession,
  applyForkSession,
  applyLocalSend,
  applyNewSession,
  hydrateFromScenario,
  messagesForSession,
  pickSessionForAgent,
  sessionsForAgent,
} from "../drafts/fixtures";
import {
  cloneApiConfig,
  defaultApiConfig,
  getDefaultPreset,
} from "../drafts/api-settings";
import type { ComposerImage } from "../composer/images";
import type { DraftApiConfig, DraftShellProps, UiMode } from "../drafts/types";
import { DRAFT_FILES_RAIL, SHELL_LEFT } from "../shell/metrics";
import {
  FILES_ACTIVITY_ID,
  LEFT_ACTIVITY_TABS,
  RIGHT_ACTIVITY_TABS,
  SIDEBAR_ACTIVITY_ID,
} from "../shell/activity";
import type { WireHostBag } from "../shell/types";

export function useDraftHostBag({
  initialScenarioId = "normal",
  initialSettingsOpen = false,
}: DraftShellProps = {}): WireHostBag {
  const [mode, setMode] = useState<UiMode>(() =>
    initialSettingsOpen ? "settings" : "chat",
  );
  const [showLeft, setShowLeft] = useState(true);
  const [leftW, setLeftW] = useState<number>(SHELL_LEFT.default);
  const [agentPct, setAgentPct] = useState<number>(SHELL_LEFT.agentPct);
  const [railW, setRailW] = useState<number>(DRAFT_FILES_RAIL.default);
  const [draftInput, setDraftInput] = useState("");
  const [apiConfig, setApiConfig] = useState<DraftApiConfig>(() =>
    defaultApiConfig(),
  );
  const [state, setState] = useState(() =>
    hydrateFromScenario(initialScenarioId),
  );

  useEffect(() => {
    const p = getDefaultPreset(apiConfig);
    if (!p) return;
    setState((prev) => {
      if (prev.meta.model === p.model && prev.meta.provider === p.protocol) {
        return prev;
      }
      return {
        ...prev,
        meta: {
          ...prev.meta,
          model: p.model,
          provider: p.protocol,
        },
      };
    });
  }, [apiConfig]);

  const onApiChange = useCallback((next: DraftApiConfig) => {
    setApiConfig(cloneApiConfig(next));
  }, []);

  const messages = useMemo(
    () => messagesForSession(state.messagesBySession, state.activeSessionId),
    [state.messagesBySession, state.activeSessionId],
  );

  const activeAgent =
    state.agents.find((a) => a.id === state.activeAgentId) ?? null;

  const agentSessions = useMemo(
    () =>
      sessionsForAgent(
        state.sessions,
        activeAgent?.name ?? state.meta.agentName,
      ),
    [state.sessions, activeAgent?.name, state.meta.agentName],
  );

  const onNewSession = useCallback(() => {
    setState((prev) => applyNewSession(prev));
  }, []);

  const onForkSession = useCallback((parentId: string) => {
    setState((prev) => applyForkSession(prev, parentId));
  }, []);

  const onNewChildSession = useCallback((parentId: string) => {
    setState((prev) => applyChildSession(prev, parentId));
  }, []);

  const onDeleteSession = useCallback((id: string) => {
    setState((prev) => {
      const sessions = prev.sessions.filter((s) => s.id !== id);
      const { [id]: _r, ...rest } = prev.messagesBySession;
      const agentName =
        prev.agents.find((a) => a.id === prev.activeAgentId)?.name ??
        prev.meta.agentName;
      let activeSessionId = prev.activeSessionId;
      if (activeSessionId === id) {
        activeSessionId = pickSessionForAgent(sessions, agentName, "");
      }
      return { ...prev, sessions, messagesBySession: rest, activeSessionId };
    });
  }, []);

  const onSend = useCallback(
    (images?: ComposerImage[], text?: string) => {
      setState((prev) =>
        applyLocalSend(prev, text ?? draftInput, Date.now(), images),
      );
      setDraftInput("");
    },
    [draftInput],
  );

  const onRetryLast = useCallback(() => {
    const msgs = messagesForSession(
      state.messagesBySession,
      state.activeSessionId,
    );
    let lastUser: string | null = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]!.role === "user") {
        lastUser = msgs[i]!.body;
        break;
      }
    }
    if (lastUser) {
      setState((prev) => applyLocalSend(prev, lastUser!));
    }
  }, [state.messagesBySession, state.activeSessionId]);

  const onCopyTranscript = useCallback(() => {
    const msgs = messagesForSession(
      state.messagesBySession,
      state.activeSessionId,
    );
    const text = msgs.map((m) => `[${m.role}] ${m.body}`).join("\n\n");
    void navigator.clipboard?.writeText(text || "(空会话)");
    setState((prev) => ({
      ...prev,
      statusHint: text ? "已复制 transcript" : "会话为空",
    }));
    window.setTimeout(() => {
      setState((prev) => {
        if (
          prev.statusHint === "已复制 transcript" ||
          prev.statusHint === "会话为空"
        ) {
          return { ...prev, statusHint: "草稿 · 仅本地" };
        }
        return prev;
      });
    }, 1800);
  }, [state.messagesBySession, state.activeSessionId]);

  const selectAgent = useCallback((agentId: string) => {
    setState((prev) => {
      const hit = prev.agents.find((a) => a.id === agentId);
      if (!hit) return prev;
      return {
        ...prev,
        activeAgentId: hit.id,
        activeSessionId: pickSessionForAgent(
          prev.sessions,
          hit.name,
          prev.activeSessionId,
        ),
        meta: {
          ...prev.meta,
          agentName: hit.name,
          projectLabel: hit.projectName || prev.meta.projectLabel,
          projectPath: hit.projectPath || prev.meta.projectPath,
        },
      };
    });
  }, []);

  const onApprovalModeChange = useCallback((next: string) => {
    setState((prev) => ({
      ...prev,
      meta: { ...prev.meta, sandboxMode: next },
    }));
  }, []);

  const onApprovalDecision = useCallback(
    (d: "once" | "always" | "deny" | "blacklist") => {
      setState((prev) => applyApprovalDecision(prev, d));
    },
    [],
  );

  const onStop = useCallback(() => {
    setState((prev) => ({
      ...prev,
      agentBusy: false,
      statusHint: "已停止（草稿）",
    }));
    window.setTimeout(() => {
      setState((prev) => {
        if (prev.statusHint === "已停止（草稿）") {
          return { ...prev, statusHint: "草稿 · 仅本地" };
        }
        return prev;
      });
    }, 1800);
  }, []);

  const onAgentSplitDrag = useCallback((clientY: number, rect: DOMRect) => {
    const y = clientY - rect.top;
    const pct = Math.min(75, Math.max(20, (y / rect.height) * 100));
    setAgentPct(pct);
  }, []);

  return {
    variant: "draft",
    mode,
    showFiles: state.showFiles,
    showLeft,
    leftW,
    agentPct,
    railW,
    railMin: DRAFT_FILES_RAIL.min,
    railMax: DRAFT_FILES_RAIL.max,
    leftMin: SHELL_LEFT.min,
    leftMax: SHELL_LEFT.max,
    onLeftResize: setLeftW,
    onRailResize: setRailW,
    onAgentSplitDrag,
    sessionRailId: "",
    topbar: {
      mode,
      onModeChange: setMode,
      meta: state.meta,
      usageLabel: state.usageLabel,
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
      activeId: state.showFiles && mode === "chat" ? FILES_ACTIVITY_ID : null,
      onSelect: (id) => {
        if (id !== FILES_ACTIVITY_ID) return;
        if (mode !== "chat") {
          setMode("chat");
          setState((p) => ({ ...p, showFiles: true }));
          return;
        }
        setState((p) => ({ ...p, showFiles: !p.showFiles }));
      },
    },
    agentList: {
      agents: state.agents,
      activeId: state.activeAgentId,
      onSelect: selectAgent,
      onOpenChat: () => setMode("chat"),
    },
    sessionList: {
      sessions: agentSessions,
      activeId: state.activeSessionId,
      agentLabel: activeAgent?.name ?? state.meta.agentName,
      busy: state.agentBusy,
      onSelect: (id) => setState((p) => ({ ...p, activeSessionId: id })),
      onNew: onNewSession,
      onDelete: onDeleteSession,
      onFork: onForkSession,
      onNewChild: onNewChildSession,
    },
    files: {
      paths: state.fileTree,
      rootLabel: "文件",
    },
    dock: {
      termLines: state.termLines,
      bgTasks: state.bgTasks,
      meta: state.meta,
      activeAgent,
      agentBusy: state.agentBusy,
      agents: state.agents,
    },
    draftSettings: {
      api: apiConfig,
      onApiChange,
      onClose: () => setMode("chat"),
    },
    draftContext: {
      messages,
      agentBusy: state.agentBusy,
      pendingApproval: state.pendingApproval,
      hasActiveSession: Boolean(state.activeSessionId),
      draftInput,
      meta: state.meta,
      statusHint: state.statusHint,
      usageLabel: state.usageLabel,
      agents: state.agents,
      onApprovalDecision,
      onDraftInputChange: setDraftInput,
      onSend,
      onRetryLast,
      onCopyTranscript,
      onAgentChange: selectAgent,
      onApprovalModeChange,
      onStop,
      sessions: agentSessions,
      activeSessionId: state.activeSessionId,
      onSelectSession: (id) =>
        setState((p) => ({ ...p, activeSessionId: id })),
      onForkSession,
      onNewChildSession,
      filePaths: state.fileTree,
    },
    project: {
      projectLabel: state.meta.projectLabel,
      projectPath: state.meta.projectPath,
    },
  };
}
