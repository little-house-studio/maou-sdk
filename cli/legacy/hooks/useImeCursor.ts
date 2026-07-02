/** useImeCursor — 硬件光标定位，支持 IME 中文输入法
 *  Ink raw 模式隐藏硬件光标 → IME 候选窗无法定位。
 *  此 hook 在输入框获焦时：计算光标屏幕坐标 → ANSI 移动硬件光标 → 显示。
 *  失焦时隐藏。不与 Ink 渲染冲突（不用 inverse 反显，只用硬件光标）。
 */
import { useEffect } from "react";
import stringWidth from "string-width";

export interface ImeCursorOptions {
  focused: boolean;
  value: string;
  cursor: number;
  rows: number;
  /** 输入框在终端的行位置（从底部往上数，0=最底状态栏，1=输入框行） */
  inputRowFromBottom?: number;
  /** 文本起始列（0-indexed，含 prompt "❯ " = 2） */
  colOffset?: number;
}

export function useImeCursor({ focused, value, cursor, rows, inputRowFromBottom = 1, colOffset = 2 }: ImeCursorOptions): void {
  useEffect(() => {
    if (!focused) {
      process.stdout.write("\x1b[?25l");
      return;
    }

    // 计算光标在屏幕上的列位置
    const beforeCursor = [...value.slice(0, cursor)];
    let col = colOffset;
    for (const ch of beforeCursor) {
      col += stringWidth(ch);
    }

    // 计算行位置（1-indexed ANSI，从底部往上）
    const row = rows - inputRowFromBottom;

    // 移动硬件光标 + 显示
    process.stdout.write(`\x1b[${row};${col + 1}H\x1b[?25h`);

    return () => {
      // 组件卸载或失焦时隐藏
      process.stdout.write("\x1b[?25l");
    };
  }, [focused, value, cursor, rows, inputRowFromBottom, colOffset]);
}
