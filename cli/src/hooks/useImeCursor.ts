/** useImeCursor — 硬件光标定位，支持 IME 中文输入法
 *
 *  已禁用：硬件光标定位与 Ink 帧渲染持续竞争（Ink 每帧 \x1b[H 回原点重绘备用屏，
 *  把硬件光标拉到帧末尾右下角），导致光标在"输入位置"和"右下角"之间闪烁。
 *  react-ink-textarea 也不暴露视觉行坐标，多行/wrap 时无法精确定位。
 *
 *  现策略：完全依赖软件光标（react-ink-textarea 的 \x1b[7m 反显，永远准确）。
 *  IME 候选窗定位交给操作系统输入法管理器（macOS IME 能跟随焦点控件）。
 *  保留 hook 签名以兼容调用方，但内部 no-op。
 */
import { useEffect } from "react";

export interface ImeCursorOptions {
  focused: boolean;
  value: string;
  cursor: number;
  rows: number;
  inputRowFromBottom?: number;
  colOffset?: number;
  cursorLine?: number;
  viewportLines?: number;
}

export function useImeCursor(_opts: ImeCursorOptions): void {
  // 确保 raw 模式下硬件光标保持隐藏（Ink 软件光标负责显示）
  useEffect(() => {
    process.stdout.write("\x1b[?25l");
  }, []);
}
