/** useCleanInput —— useInput 包装：丢弃鼠标 SGR 序列 + 转义序列，防止点击插入乱码 */
import { useInput, type Key } from "ink";

/** 匹配 SGR 鼠标序列（1000/1002/1003/1006 模式） */
const MOUSE_RE = /\x1b\[<\d+;\d+;\d+[Mm]/;
/**
 * 匹配其它 ANSI 转义序列（避免控制序列被当文本插入）。
 * 末尾类含 ~ 以兜底 F5-F12（\x1b[15~）、PgUp/Ins（\x1b[5~）、
 * modifyOtherKeys（\x1b[27;5;65~）——否则 parseKeypress 无映射时
 * 这些 ~ 结尾序列会被 useInput 当文本插入乱码。
 */
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z<~]/;
/** SS3 序列（F1-F4 \x1bOP、SS3 方向键 \x1bOA），parseKeypress 通常能消化但兜底 */
const SS3_RE = /\x1bO[A-Z]/;

export function useCleanInput(
  handler: (input: string, key: Key) => void,
  options?: Parameters<typeof useInput>[1],
): void {
  useInput((input, key) => {
    // 吞掉鼠标/ANSI/SS3 转义序列
    if (input && (MOUSE_RE.test(input) || ANSI_RE.test(input) || SS3_RE.test(input))) return;
    // 吞掉空输入
    if (!input && !key.return && !key.backspace && !key.delete && !key.leftArrow && !key.rightArrow && !key.upArrow && !key.downArrow && !key.escape && !key.tab) return;
    handler(input, key);
  }, options);
}

