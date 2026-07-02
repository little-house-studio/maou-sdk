/** useCleanInput —— useInput 包装：丢弃鼠标 SGR 序列 + 转义序列，防止点击插入乱码 */
import { useInput, type Key } from "ink";

/** 匹配 SGR 鼠标序列（1000/1002/1003/1006 模式） */
const MOUSE_RE = /\x1b\[<\d+;\d+;\d+[Mm]/;
/** 匹配其它 ANSI 转义序列（避免控制序列被当文本插入） */
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z<]/;

export function useCleanInput(
  handler: (input: string, key: Key) => void,
  options?: Parameters<typeof useInput>[1],
): void {
  useInput((input, key) => {
    // 吞掉鼠标转义序列
    if (input && (MOUSE_RE.test(input) || ANSI_RE.test(input))) return;
    // 吞掉空输入
    if (!input && !key.return && !key.backspace && !key.delete && !key.leftArrow && !key.rightArrow && !key.upArrow && !key.downArrow && !key.escape && !key.tab) return;
    handler(input, key);
  }, options);
}
