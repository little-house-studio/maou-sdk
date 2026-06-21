/** useCleanInput —— useInput 包装：丢弃鼠标 SGR 序列，防止点击插入乱码 */
import { useInput, type Key } from "ink";

/** 匹配 SGR 鼠标序列残留（点击/滚轮被 Ink 当成普通输入时的形态） */
const MOUSE_INPUT = /\x1b?\[?<\d{1,4};\d{1,4};\d{1,4}[Mm]/;

export function useCleanInput(
  handler: (input: string, key: Key) => void,
  options?: Parameters<typeof useInput>[1],
): void {
  useInput((input, key) => {
    if (input && MOUSE_INPUT.test(input)) return; // 吞掉鼠标转义，不进文本流
    handler(input, key);
  }, options);
}
