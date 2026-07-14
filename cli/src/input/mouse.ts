/** 鼠标 SGR 解析（1000/1002/1003 + 1006） */

export interface MouseEvent {
  type: "down" | "up" | "drag" | "motion" | "wheelUp" | "wheelDown";
  col: number; // 1-based
  row: number; // 1-based
  button: number;
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
}

export function enableMouse(
  out: NodeJS.WriteStream,
  opts: { drag?: boolean; anyMotion?: boolean } = {},
): void {
  const modes: string[] = [];
  if (opts.anyMotion) modes.push("\x1b[?1003h");
  else if (opts.drag) modes.push("\x1b[?1002h");
  else modes.push("\x1b[?1000h");
  modes.push("\x1b[?1006h");
  out.write(modes.join(""));
}

export function disableMouse(out: NodeJS.WriteStream): void {
  out.write("\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l");
  // 重置 OSC 22 指针（避免退出后仍保持手型）
  try {
    out.write("\x1b]22;\x1b\\\x1b]22;\x07");
  } catch {
    /* ignore */
  }
}

export const MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

export function parseMouse(data: string): MouseEvent[] {
  const events: MouseEvent[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(MOUSE_RE.source, "g");
  while ((m = re.exec(data))) {
    const btn = parseInt(m[1]!, 10);
    const col = parseInt(m[2]!, 10);
    const row = parseInt(m[3]!, 10);
    const release = m[4] === "m";
    // 修饰键：+4 shift, +8 meta, +16 ctrl（xterm）
    const shift = !!(btn & 4);
    const meta = !!(btn & 8);
    const ctrl = !!(btn & 16);
    let type: MouseEvent["type"] = release ? "up" : "down";
    let button = btn & 3;
    if (btn & 64) type = (btn & 1) ? "wheelDown" : "wheelUp";
    else if (btn & 32) {
      type = button === 3 ? "motion" : "drag";
    }
    events.push({ type, col, row, button, shift, meta, ctrl });
  }
  return events;
}

export function stripMouseSequences(data: string): string {
  return data.replace(new RegExp(MOUSE_RE.source, "g"), "");
}

export function isMouseData(data: string): boolean {
  return /^\x1b\[</.test(data);
}
