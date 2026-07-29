/**
 * 顶部横幅 tip 文案 —— Node 是唯一文案源（Ratatui 只负责轮播渲染）。
 *
 * - 有上下文（中断中 / 生成中 / 待审批 / 弹层）→ 返回**单条**，TUI 钉住不轮播
 * - 空闲 → 返回轮播池，TUI 每 ~9s 切一条
 *
 * 快捷键文案取自 keybindings 注册表，避免与真实绑定漂移。
 */

import { listKeyBindings } from "./keybindings.js";

export interface TipContext {
  streaming: boolean;
  aborting: boolean;
  /** 终端命令待审批（审批条已占屏，tip 补按键说明） */
  hasApproval: boolean;
  /** 当前弹层 kind（null = 无） */
  overlay: string | null;
}

/** ctrl+k → Ctrl+K；shift+tab → Shift+Tab */
export function prettyKey(key: string): string {
  return key
    .split("+")
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join("+");
}

/**
 * 快捷键池：`Ctrl+K 命令面板`。
 * 只取真实组合键（含 `+`）——`open_agents` 之类是伪键，没有可念的键位。
 */
function hotkeyTips(): string[] {
  return listKeyBindings()
    .filter((b) => b.key.includes("+") && !!b.label)
    .map((b) => `${prettyKey(b.key)} ${b.label}`);
}

/** 与快捷键无关的操作提示（输入语法 / 鼠标） */
const GESTURE_TIPS: readonly string[] = [
  "/ 开头输入斜杠命令",
  "拖动可选中文本 · Ctrl+Shift+C 复制",
  "点击底部导航条切换页面",
  "点击工具行可展开或收起结果",
] as const;

/** 空闲轮播池（快捷键 + 手势） */
export function idleTips(): string[] {
  return [...hotkeyTips(), ...GESTURE_TIPS];
}

/** 顶部横幅 tip 池：上下文优先钉住单条，否则给轮播池 */
export function tipsForContext(ctx: TipContext): string[] {
  if (ctx.aborting) return ["正在中断本轮…"];
  if (ctx.hasApproval) {
    return ["待审批 · Y 一次 · A 总是 · N 拒绝 · B 拉黑"];
  }
  if (ctx.overlay) return ["↑↓ 选择 · Enter 确认 · Esc 关闭"];
  if (ctx.streaming) return ["生成中 · Esc 中断 · Enter 排队追加"];
  return idleTips();
}
