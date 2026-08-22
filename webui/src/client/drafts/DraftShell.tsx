import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyApprovalDecision,
  applyLocalSend,
  applyNewSession,
  hydrateFromScenario,
  messagesForSession,
  pickSessionForAgent,
  sessionsForAgent,
} from "./fixtures";
import {
  cloneApiConfig,
  defaultApiConfig,
  getDefaultPreset,
} from "./api-settings";
import { ResizeHandle } from "./layout/ResizeHandle";
import { WireTopbar } from "./layout/WireTopbar";
import { AgentList } from "./panels/AgentList";
import { SessionList } from "./panels/SessionList";
import { ContextPanel } from "./panels/ContextPanel";
import { FilesRail } from "./panels/FilesRail";
import { ProjectWorkbench } from "./panels/ProjectWorkbench";
import { SettingsPanel } from "./panels/SettingsPanel";
import { TeamBoard } from "./panels/TeamBoard";
import { BottomInfoBar } from "./panels/BottomInfoBar";
import type {
  DraftApiConfig,
  DraftShellProps,
  ScenarioId,
  UiMode,
} from "./types";
import "./draft.css";

/** frost-branch defaults: ~260px sidebar, roomier bottom chrome */
const LEFT_DEFAULT = 260;
const LEFT_MIN = 200;
const LEFT_MAX = 360;
const AGENT_H_DEFAULT = 38; // percent of left column
const RAIL_DEFAULT = 280;
const RAIL_MIN = 200;
const RAIL_MAX = 440;
/**
 * Wireframe shell (see product sketch):
 *  top:  界面模式 | 功能按键 | 设置与 token | 文件 / diff
 *  left: agent 列表 / 会话列表
 *  mid:  后台列表 / 上下文 / 输入
 *  right: 文件列表
 *  bottom: 停靠卡片轨（日志/待办/终端/agent/任务）
 */
export function DraftShell({
  initialScenarioId = "normal",
  initialSettingsOpen = false,
}: DraftShellProps) {
  const [mode, setMode] = useState<UiMode>(() =>
    initialSettingsOpen ? "settings" : "chat",
  );
  const [leftW, setLeftW] = useState(LEFT_DEFAULT);
  const [agentPct, setAgentPct] = useState(AGENT_H_DEFAULT);
  const [railW, setRailW] = useState(RAIL_DEFAULT);
  const [draftInput, setDraftInput] = useState("");
  /** Session-local API presets — survive mode switches */
  const [apiConfig, setApiConfig] = useState<DraftApiConfig>(() =>
    defaultApiConfig(),
  );
  const [state, setState] = useState(() =>
    hydrateFromScenario(initialScenarioId),
  );

  // Reflect default preset model/provider into topbar meta (draft session only)
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

  /** Session list is scoped to the currently selected agent */
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

  const onSend = useCallback(() => {
    setState((prev) => applyLocalSend(prev, draftInput));
    setDraftInput("");
  }, [draftInput]);

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
    const text = msgs
      .map((m) => `[${m.role}] ${m.body}`)
      .join("\n\n");
    void navigator.clipboard?.writeText(text || "(空会话)");
    setState((prev) => ({
      ...prev,
      statusHint: text ? "已复制 transcript" : "会话为空",
    }));
    // Clear transient feedback so composer status doesn't stick forever
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

  /** Switch agent and bind session list to that agent's sessions */
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

  const onAgentChange = selectAgent;

  const onApprovalModeChange = useCallback((mode: string) => {
    setState((prev) => ({
      ...prev,
      meta: { ...prev.meta, sandboxMode: mode },
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

  /** Vertical split inside left column: drag changes agent list % height */
  const onAgentSplitDrag = useCallback(
    (clientY: number, rect: DOMRect) => {
      const y = clientY - rect.top;
      const pct = Math.min(75, Math.max(20, (y / rect.height) * 100));
      setAgentPct(pct);
    },
    [],
  );

  return (
    <div
      className={`wire-shell draft-shell${
        mode === "settings" ? " has-settings" : ""
      }`}
    >
      <WireTopbar
        mode={mode}
        onModeChange={setMode}
        meta={state.meta}
        usageLabel={state.usageLabel}
        showFiles={state.showFiles}
        onToggleFiles={() =>
          setState((p) => ({ ...p, showFiles: !p.showFiles }))
        }
        agentBusy={state.agentBusy}
      />

      {mode === "settings" ? (
        <div className="wire-mid is-settings">
          <SettingsPanel
            api={apiConfig}
            onApiChange={onApiChange}
            presentation="page"
            onClose={() => setMode("chat")}
          />
        </div>
      ) : mode === "project" ? (
        <div className="wire-mid is-project">
          <ProjectWorkbench
            projectLabel={state.meta.projectLabel}
            projectPath={state.meta.projectPath}
          />
        </div>
      ) : mode === "team" ? (
        <div className="wire-mid is-team">
          <TeamBoard />
        </div>
      ) : (
        <div className="wire-mid is-chat">
          <div className="wire-left" style={{ width: leftW }}>
            <div
              className="wire-left-agents"
              style={{ flex: `0 0 ${agentPct}%` }}
            >
              <AgentList
                agents={state.agents}
                activeId={state.activeAgentId}
                onSelect={selectAgent}
              />
            </div>
            <div
              className="wire-v-split"
              role="separator"
              aria-orientation="horizontal"
              aria-label="拖动调整 agent / 会话 高度"
              onPointerDown={(e) => {
                const col = (e.currentTarget.parentElement as HTMLElement)!;
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
              <SessionList
                sessions={agentSessions}
                activeId={state.activeSessionId}
                agentLabel={activeAgent?.name ?? state.meta.agentName}
                busy={state.agentBusy}
                onSelect={(id) =>
                  setState((p) => ({ ...p, activeSessionId: id }))
                }
                onNew={onNewSession}
                onDelete={onDeleteSession}
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

          <div className="wire-center">
            <ContextPanel
              messages={messages}
              agentBusy={state.agentBusy}
              pendingApproval={state.pendingApproval}
              hasActiveSession={Boolean(state.activeSessionId)}
              draftInput={draftInput}
              meta={state.meta}
              statusHint={state.statusHint}
              usageLabel={state.usageLabel}
              agents={state.agents}
              onApprovalDecision={onApprovalDecision}
              onDraftInputChange={setDraftInput}
              onSend={onSend}
              onRetryLast={onRetryLast}
              onCopyTranscript={onCopyTranscript}
              onAgentChange={onAgentChange}
              onApprovalModeChange={onApprovalModeChange}
              onStop={onStop}
              sessions={agentSessions}
              activeSessionId={state.activeSessionId}
              onSelectSession={(id) =>
                setState((p) => ({ ...p, activeSessionId: id }))
              }
            />
          </div>

          {state.showFiles && (
            <>
              <ResizeHandle
                edge="left"
                size={railW}
                min={RAIL_MIN}
                max={RAIL_MAX}
                onResize={setRailW}
                label="拖动调整文件栏宽度"
              />
              <div className="wire-right" style={{ width: railW }}>
                <FilesRail paths={state.fileTree} rootLabel="文件" />
              </div>
            </>
          )}
        </div>
      )}

      <BottomInfoBar
        termLines={state.termLines}
        bgTasks={state.bgTasks}
        meta={state.meta}
        activeAgent={activeAgent}
        agentBusy={state.agentBusy}
        agents={state.agents}
      />
    </div>
  );
}
