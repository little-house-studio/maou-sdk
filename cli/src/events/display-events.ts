/**
 * display-events —— 工具 displayEvents 的通用分发注册表。
 *
 * SDK 的 ToolResponse.displayEvents 是 Record<string, unknown>[]，任意工具可发任意结构事件。
 * runtime 把 displayEvents 附加到 tool_result StreamEvent。reducer 收到后遍历调 dispatchDisplayEvent。
 *
 * 这里维护一个 type → handler 注册表。新增 displayEvent type 只需 registerHandler，不改 reducer。
 * 已知 handler：
 *   - supervisor_end：监督模式结束，切回主 Agent session
 *
 * 这是通用扩展点：SDK 后续任何工具的 displayEvent 都能在此注册处理。
 */
import { useStore } from "../state/store.js";

export interface DisplayEvent {
  type: string;
  [key: string]: unknown;
}

type DisplayEventHandler = (ev: DisplayEvent) => void;

const handlers = new Map<string, DisplayEventHandler>();

/** 注册一个 displayEvent type 的处理器 */
export function registerDisplayHandler(type: string, handler: DisplayEventHandler): void {
  handlers.set(type, handler);
}

/** 分发一个 displayEvent：找到对应 type 的 handler 调用，无则忽略（静默，未知事件不报错） */
export function dispatchDisplayEvent(ev: DisplayEvent): void {
  const h = handlers.get(ev.type);
  if (h) {
    try { h(ev); } catch { /* handler 不应抛 */ }
  }
}

// ── 内置 handler ──────────────────────────────────────────

/** supervisor_end：监督模式结束，切回主 Agent session */
registerDisplayHandler("supervisor_end", (ev) => {
  const mainSessionId = ev.text as string | undefined;
  if (typeof mainSessionId === "string" && mainSessionId) {
    useStore.getState().setSessionId(mainSessionId);
  }
  useStore.getState().clearSupervisor();
  useStore.getState().toastMsg("监督模式已结束，切回主 Agent", "ok");
});
