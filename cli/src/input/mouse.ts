/** 鼠标 SGR —— 修复版：不抢拖选 + 消费转义序列（防乱码） */

export interface MouseEvent {
  type: "down" | "up" | "drag" | "wheelUp" | "wheelDown";
  col: number; // 1-based
  row: number; // 1-based
  button: number;
}

/**
 * 启用鼠标：只用 1000（按下/释放，不含移动/拖动）+ 1006 SGR。
 * 故意不启用 1002/1003（按钮拖动/全跟踪）—— 这样终端原生拖选复制仍可用（你标的优先项）。
 */
export function enableMouse(out: NodeJS.WriteStream): void {
  out.write("\x1b[?1000h\x1b[?1006h");
}
export function disableMouse(out: NodeJS.WriteStream): void {
  out.write("\x1b[?1006l\x1b[?1000l");
}

/** SGR 鼠标转义正则（用于解析 + 从输入流剥离） */
export const MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

/** 解析一段数据里的鼠标事件 */
export function parseMouse(data: string): MouseEvent[] {
  const events: MouseEvent[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(MOUSE_RE.source, "g");
  while ((m = re.exec(data))) {
    const btn = parseInt(m[1]!, 10);
    const col = parseInt(m[2]!, 10);
    const row = parseInt(m[3]!, 10);
    const release = m[4] === "m";
    let type: MouseEvent["type"] = release ? "up" : "down";
    let button = btn & 3;
    if (btn & 64) type = (btn & 1) ? "wheelDown" : "wheelUp";
    else if (btn & 32) type = "drag";
    events.push({ type, col, row, button });
  }
  return events;
}

/**
 * 从输入字符串里剥离鼠标转义序列，返回"干净的键盘输入"。
 * 修复"点击输入框插入乱码"：鼠标 SGR 序列不再被当普通字符。
 */
export function stripMouseSequences(data: string): string {
  return data.replace(new RegExp(MOUSE_RE.source, "g"), "");
}

/** 判断一段数据是否（主要）是鼠标序列 */
export function isMouseData(data: string): boolean {
  return /^\x1b\[</.test(data);
}
