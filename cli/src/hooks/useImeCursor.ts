/**
 * useImeCursor —— 硬件光标定位，支持 IME 中文输入法
 *
 * 原理：Ink 默认隐藏硬件光标，导致终端 IME 候选窗无法定位。
 * 此 hook 在 InputBox 获焦时：
 *   1. 计算文本光标的屏幕坐标 (row, col)
 *   2. 用 ANSI CSI 序列移动硬件光标到该位置
 *   3. 显示硬件光标（\x1b[?25h）
 * 失焦时隐藏硬件光标（\x1b[?25l）。
 *
 * 布局假设（与 app.tsx 一致）：
 *   - InputBox 是倒数第二个子组件（上方是 flexGrow 区域，下方是 StatusBar）
 *   - InputBox 有 round border（3 行高：上边框 + 内容 + 下边框）
 *   - StatusBar 1 行高
 *   - 因此 InputBox 内容行 = rows - 2（1-indexed ANSI）
 *   - 文本起始列 = 1(border) + 1(padding) + 2(prompt "❯ ") = 4（0-indexed）
 */
import { useEffect } from "react";
import stringWidth from "string-width";

export interface ImeCursorOptions {
  /** 是否获焦（显示硬件光标） */
  focused: boolean;
  /** 输入文本 */
  value: string;
  /** 光标字符索引 */
  cursor: number;
  /** 终端行数 */
  rows: number;
  /** 文本起始列偏移（0-indexed，默认 4 = border + padding + prompt） */
  colOffset?: number;
}

export function useImeCursor({ focused, value, cursor, rows, colOffset = 4 }: ImeCursorOptions): void {
  useEffect(() => {
    if (!focused) {
      // 失焦：隐藏硬件光标
      process.stdout.write("\x1b[?25l");
      return;
    }

    // 获焦：计算光标屏幕坐标并定位硬件光标
    // 行：InputBox 内容行 = rows - 2（1-indexed ANSI）
    // 列：colOffset + stringWidth(value.slice(0, cursor)) + 1（1-indexed）
    const row = Math.max(1, rows - 2);
    const textWidth = stringWidth(value.slice(0, cursor) || "");
    const col = colOffset + textWidth + 1;

    // 移动硬件光标并显示
    process.stdout.write(`\x1b[${row};${col}H\x1b[?25h`);
  }, [focused, value, cursor, rows, colOffset]);

  // 卸载时隐藏硬件光标
  useEffect(() => {
    return () => { process.stdout.write("\x1b[?25l"); };
  }, []);
}
