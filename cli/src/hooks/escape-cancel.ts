/**
 * Esc 统一取消 / 返回 / 关闭（Ratatui + store）。
 *
 * 任意场景按 Esc 只做**一层**回退（由内到外）：
 *   1. 全屏编辑器 → 返回输入框（内容带回）
 *   2. 终端审批条 → 拒绝
 *   3. 输入框文本选区 → 取消选区
 *   4. 斜杠/路径补全菜单 → 关闭
 *   5. 嵌套页（设置二级等）→ 返回上级
 *   6. 任意 overlay 弹层 → 关闭
 *   7. 流式生成 / 中断中 → 停止任务
 *   8. 空闲 → 无操作（返回 false）
 *
 * 屏幕选区由 Ratatui 子进程处理，Node 不再持有 Ink 显存选区。
 */

import { useStore } from "../state/store.js";
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
/** 中断流式任务（由 bridge 注册） */
let abortStreamHandler: (() => void) | null = null;
/** 全屏编辑器当前文本 */
let fullEditorValueGetter: (() => string) | null = null;

export function registerNestedEscapeBack(fn: NestedBackHandler | null): void {
  nestedBackHandler = fn;
}

export function registerAbortStream(fn: (() => void) | null): void {
  abortStreamHandler = fn;
}

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

  // 3. 输入框文本选区（store 侧）
  const textSel = s.inputTextSel;
  if (textSel && textSel.startIdx !== textSel.endIdx) {
    s.setInputTextSel(null);
    return { handled: true, action: "input_selection" };
  }

  // 4. 补全菜单
  if (s.completion) {
    s.closeCompletion();
    return { handled: true, action: "completion" };
  }

  // 5. 嵌套页返回
  if (nestedBackHandler) {
    try {
      if (nestedBackHandler()) {
        return { handled: true, action: "nested_back" };
      }
    } catch {
      /* ignore */
    }
  }

  // 6. overlay 弹层
  if (s.overlay) {
    s.setOverlay(null);
    return { handled: true, action: "overlay" };
  }

  // 7. 流式生成 → 中断
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
