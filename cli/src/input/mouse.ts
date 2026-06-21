/** 鼠标 SGR 解析 —— 启用/解析点击事件（点到字符位置） */

export interface MouseEvent {
  type: "down" | "up" | "move" | "wheelUp" | "wheelDown";
  col: number; // 1-based 终端列
  row: number; // 1-based 终端行
  button: number;
}

/** 启用 SGR 鼠标模式（写入 stdout） */
export function enableMouse(out: NodeJS.WriteStream): void {
  out.write("\x1b[?1000h"); // 点击
  out.write("\x1b[?1006h"); // SGR 扩展坐标
}
export function disableMouse(out: NodeJS.WriteStream): void {
  out.write("\x1b[?1006l");
  out.write("\x1b[?1000l");
}

/** 解析一段 stdin 数据里的 SGR 鼠标报告。返回事件数组（可能为空） */
export function parseMouse(data: string): MouseEvent[] {
  const events: MouseEvent[] = [];
  // SGR: ESC [ < btn ; col ; row (M|m)
  const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(data))) {
    const btn = parseInt(m[1]!, 10);
    const col = parseInt(m[2]!, 10);
    const row = parseInt(m[3]!, 10);
    const release = m[4] === "m";
    let type: MouseEvent["type"] = release ? "up" : "down";
    let button = btn & 3;
    if (btn & 64) { type = (btn & 1) ? "wheelDown" : "wheelUp"; }
    else if (btn & 32) { type = "move"; }
    events.push({ type, col, row, button });
  }
  return events;
}
