/** 鼠标 SGR —— 修复版：不抢拖选 + 消费转义序列（防乱码） */

export interface MouseEvent {
  type: "down" | "up" | "drag" | "motion" | "wheelUp" | "wheelDown";
  col: number; // 1-based
  row: number; // 1-based
  button: number;
}

/**
 * 启用鼠标 SGR(1006)。
 * - drag=false, anyMotion=false：1000 模式（仅按下/释放/滚轮）
 * - drag=true, anyMotion=false：1002 模式（额外上报按住拖动）
 * - drag=true, anyMotion=true：1003 模式（全跟踪，含 hover motion）
 * 1006 是纯编码格式，对选字零影响。
 */
export function enableMouse(out: NodeJS.WriteStream, opts: { drag?: boolean; anyMotion?: boolean } = {}): void {
  const modes: string[] = [];
  if (opts.anyMotion) modes.push("\x1b[?1003h");
  else if (opts.drag) modes.push("\x1b[?1002h");
  else modes.push("\x1b[?1000h");
  modes.push("\x1b[?1006h");
  out.write(modes.join(""));
}
export function disableMouse(out: NodeJS.WriteStream): void {
  // 关掉所有可能开过的模式
  out.write("\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l");
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
    else if (btn & 32) {
      // motion：button===3 表示无按键移动（hover），否则是按住拖动
      type = button === 3 ? "motion" : "drag";
    }
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
