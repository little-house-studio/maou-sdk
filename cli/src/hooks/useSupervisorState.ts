/**
 * useSupervisorState —— 从 SDK SUPERVISOR_MANAGER 查询监督状态，同步到 store。
 *
 * 事件驱动：onStream 收到 tool_result/done 后调 refresh（SDK 状态在工具执行时同步更新，
 * tool_result 时已是最新，不需轮询）。sessionId 变化时也查一次（切回主 Agent 时清状态）。
 *
 * SUPERVISOR_MANAGER 是 SDK 全局单例（@little-house-studio/agent 导出），只读查询。
 */
import { useEffect } from "react";
import { SUPERVISOR_MANAGER } from "@little-house-studio/agent";
import type { SupervisorBinding } from "@little-house-studio/agent";
import { useStore } from "../state/store.js";
import type { SupervisorState } from "../state/types.js";

function bindingToState(b: SupervisorBinding | undefined, currentSessionId: string | null): SupervisorState | null {
  if (!b) return null;
  // 当前 session 可能是 supervisor 或 main，都能查到 binding
  return {
    active: b.state !== "ended",
    mainSessionId: b.mainSessionId,
    supervisorSessionId: b.supervisorSessionId,
    state: b.state,
    plan: b.plan,
    verifyRounds: b.verifyRounds,
    lastVerdict: b.lastVerdict,
  };
}

export function useSupervisorState(): void {
  const sessionId = useStore((s) => s.sessionId);
  // 只在 tool_result/done 后查（状态变化点），不每 delta 查——避免流式高频卡顿
  const checkNonce = useStore((s) => s.supervisorCheckNonce);

  const refresh = () => {
    const sid = useStore.getState().sessionId;
    if (!sid) return;
    // 当前 session 可能是 supervisor session 或 main session
    const b = SUPERVISOR_MANAGER.getBySupervisor(sid) ?? SUPERVISOR_MANAGER.getByMain(sid);
    const state = bindingToState(b, sid);
    const cur = useStore.getState().supervisor;
    // 只在变化时 set（避免无限重渲）
    if (!cur && !state) return;
    if (cur && state && cur.state === state.state && cur.verifyRounds === state.verifyRounds && cur.plan === state.plan) return;
    useStore.getState().setSupervisor(state);
  };

  // sessionId 变化 + tool_result/done 后查（不每 delta 查）
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sessionId, checkNonce]);
}
