/**
 * Esc 统一取消 / 返回 / 关闭。
 *
 * 任意场景按 Esc 只做**一层**回退（由内到外）：
 *   1. 全屏编辑器 → 返回输入框（内容带回）
 *   2. 终端审批条 → 拒绝
 *   3. 输入框文本选区 → 取消选区
 *   4. 屏幕选区（蓝底）→ 清除
 *   5. 斜杠/路径补全菜单 → 关闭
 *   6. 嵌套页（设置二级等）→ 返回上级
 *   7. 任意 overlay 弹层 → 关闭
 *   8. 流式生成 / 中断中 → 停止任务
 *   9. 空闲 → 无操作（返回 false）
 *
 * 各组件本地 useCleanInput 也应调用本函数，避免漏接。
 */

import { useStore } from "../state/store.js";
import {
  clearSelection as vramClear,
  getSelection as vramGet,
} from "../render/vram-layer.js";
import { clearActiveSel } from "../render/selection-model.js";
import { answerTerminalApproval } from "../input/terminal-approval.js";

export type EscapeAction =
  | "full_editor"
  | "terminal_approval"
  | "input_selection"
  | "screen_selection"
  | "completion"
  | "nested_back"
  | "overlay"
  | "abort_stream"
  | "none";

export interface EscapeCancelResult {
  handled: boolean;
  action: EscapeAction;
}

export interface EscapeCancelContext {
  /** 全屏编辑器当前文本（退出时带回） */
  fullEditorValue?: string;
}

/** 嵌套返回（设置二级页等）：返回 true 表示已处理 */
type NestedBackHandler = () => boolean;

let nestedBackHandler: NestedBackHandler | null = null;
/** 中断流式任务（由 App/useAgent 注册） */
let abortStreamHandler: (() => void) | null = null;
/** 全屏编辑器当前文本（避免全局 Esc 只带回 initial） */
let fullEditorValueGetter: (() => string) | null = null;

/** 注册/注销嵌套 Esc 返回（Settings 二级页 mount 时） */
export function registerNestedEscapeBack(fn: NestedBackHandler | null): void {
  nestedBackHandler = fn;
}

/** 注册/注销流式中断 */
export function registerAbortStream(fn: (() => void) | null): void {
  abortStreamHandler = fn;
}

/** 注册/注销全屏编辑器内容读取 */
export function registerFullEditorValue(fn: (() => string) | null): void {
  fullEditorValueGetter = fn;
}

/**
 * 执行一层 Esc 取消。返回是否已处理。
 */
export function handleEscapeCancel(ctx: EscapeCancelContext = {}): EscapeCancelResult {
  const s = useStore.getState();

  // 1. 全屏编辑器
  if (s.fullEditorInitial !== null) {
    let text = ctx.fullEditorValue;
    if (text === undefined) {
      try {
        text = fullEditorValueGetter?.();
      } catch {
        text = undefined;
      }
    }
    s.exitFullEditor(text ?? s.fullEditorInitial ?? "", false);
    return { handled: true, action: "full_editor" };
  }

  // 2. 终端审批 → 拒绝（取消）
  if (s.terminalApproval) {
    answerTerminalApproval(s.terminalApproval.id, "deny");
    return { handled: true, action: "terminal_approval" };
  }

  // 3. 输入框文本选区
  const textSel = s.inputTextSel;
  if (textSel && textSel.startIdx !== textSel.endIdx) {
    s.setInputTextSel(null);
    clearActiveSel();
    vramClear();
    return { handled: true, action: "input_selection" };
  }

  // 4. 屏幕选区蓝底
  if (vramGet()) {
    vramClear();
    clearActiveSel();
    return { handled: true, action: "screen_selection" };
  }

  // 5. 补全菜单
  if (s.completion) {
    s.closeCompletion();
    return { handled: true, action: "completion" };
  }

  // 6. 嵌套页返回（设置二级 → 一级）
  if (nestedBackHandler) {
    try {
      if (nestedBackHandler()) {
        return { handled: true, action: "nested_back" };
      }
    } catch {
      /* ignore */
    }
  }

  // 7. overlay 弹层
  if (s.overlay) {
    s.setOverlay(null);
    return { handled: true, action: "overlay" };
  }

  // 8. 流式生成 → 中断
  if (s.streaming || s.aborting) {
    if (!s.aborting) {
      abortStreamHandler?.();
    }
    return { handled: true, action: "abort_stream" };
  }

  return { handled: false, action: "none" };
}

/** 是否像 Esc 键（含裸 \x1b、部分终端未置 key.escape） */
export function isEscapeKey(char: string, key: { escape?: boolean }): boolean {
  return key.escape === true || char === "\x1b";
}
