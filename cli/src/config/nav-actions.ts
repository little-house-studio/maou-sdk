/**
 * 底栏 Nav 段 → 动作映射（结构体配置，非散落 match）。
 *
 * 主题 JSON 只提供 id/label/short/色；点了之后做什么由这里定义。
 * Ratatui 经 ProtoNavItem.action_* 下发，Rust 不再写死 agent/会话/设置。
 */

export type NavActionKind = "command" | "hotkey" | "toast" | "noop";

export interface NavActionDef {
  /** 与主题 nav.order / items 的 id 对齐 */
  id: string;
  kind: NavActionKind;
  /**
   * command → 指令 id（CliCommandSpec.id）
   * hotkey → 热键串（与 keybindings 一致，如 ctrl+k）
   * toast  → 提示文案
   */
  value?: string;
  toastLevel?: "info" | "ok" | "warn" | "err";
}

/** 默认导航动作表（可按 id 覆盖/扩展） */
export const NAV_ACTION_DEFS: readonly NavActionDef[] = [
  { id: "agent", kind: "hotkey", value: "open_agents" },
  { id: "sessions", kind: "command", value: "sessions" },
  { id: "settings", kind: "command", value: "settings" },
  { id: "terminal", kind: "hotkey", value: "ctrl+k" },
  { id: "todo", kind: "hotkey", value: "ctrl+k" },
  { id: "inbox", kind: "toast", value: "收件箱 · 暂未接入", toastLevel: "info" },
  { id: "notice", kind: "toast", value: "公告 · 暂未接入", toastLevel: "info" },
] as const;

const byId = new Map(NAV_ACTION_DEFS.map((d) => [d.id, d]));

export function getNavAction(id: string): NavActionDef | undefined {
  return byId.get(id);
}

/** 给 Ink NavBar 用的闭包表（兼容旧 NAV_ACTIONS 形状） */
export function buildNavActionFns(
  run: (action: NavActionDef) => void,
): Record<string, () => void> {
  const out: Record<string, () => void> = {};
  for (const d of NAV_ACTION_DEFS) {
    out[d.id] = () => run(d);
  }
  return out;
}
