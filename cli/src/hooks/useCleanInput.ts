/** useCleanInput —— useInput 包装：丢弃鼠标 SGR 序列 + 转义序列，防止点击插入乱码 */
import { useInput, type Key } from "ink";

/** 匹配 SGR 鼠标序列（1000/1002/1003/1006 模式） */
const MOUSE_RE = /\x1b\[<\d+;\d+;\d+[Mm]/;
/** ESC 被剥离后的残片：`[<35;83;30M`（曾直接进输入框） */
const MOUSE_ORPHAN_RE = /\[<\d+;\d+;\d+[Mm]/;
/**
 * 匹配其它 ANSI 转义序列（避免控制序列被当文本插入）。
 * 末尾类含 ~ 以兜底 F5-F12（\x1b[15~）、PgUp/Ins（\x1b[5~）、
 * modifyOtherKeys（\x1b[27;5;65~）——否则 parseKeypress 无映射时
 * 这些 ~ 结尾序列会被 useInput 当文本插入乱码。
 */
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z<~]/;
/** SS3 序列（F1-F4 \x1bOP、SS3 方向键 \x1bOA），parseKeypress 通常能消化但兜底 */
const SS3_RE = /\x1bO[A-Z]/;

function isControlGarbage(input: string): boolean {
  if (!input) return false;
  if (MOUSE_RE.test(input) || MOUSE_ORPHAN_RE.test(input)) return true;
  if (ANSI_RE.test(input) || SS3_RE.test(input)) return true;
  // 纯残片：整段就是 `[<…M` 或含不可见 CSI 开头
  if (/^\[<\d/.test(input)) return true;
  return false;
}

export function useCleanInput(
  handler: (input: string, key: Key) => void,
  options?: Parameters<typeof useInput>[1],
): void {
  useInput((input, key) => {
    // Esc / 方向 / 翻页 / 编辑键：始终放行
    if (
      key.escape ||
      key.upArrow ||
      key.downArrow ||
      key.leftArrow ||
      key.rightArrow ||
      key.pageUp ||
      key.pageDown ||
      key.return ||
      key.tab ||
      key.backspace ||
      key.delete
    ) {
      handler(input, key);
      return;
    }
    // Ctrl / Meta 组合键（Ctrl+C 等）：input 可能是 "\x03"/"c"/空，绝不能当空输入丢掉
    if (key.ctrl || key.meta) {
      handler(input, key);
      return;
    }
    // 裸 ESC 字符（部分终端 key.escape 未置位）
    if (input === "\x1b") {
      handler(input, { ...key, escape: true });
      return;
    }
    // ETX（ASCII 3）= Ctrl+C，部分环境不置 key.ctrl
    if (input === "\x03") {
      handler(input, { ...key, ctrl: true });
      return;
    }
    // 吞掉鼠标/ANSI/SS3 转义序列（含无 ESC 残片）
    if (input && isControlGarbage(input)) return;
    // 吞掉空输入（无任何键标志）
    if (!input) return;
    handler(input, key);
  }, options);
}

