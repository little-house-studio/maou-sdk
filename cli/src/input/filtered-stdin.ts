/**
 * filtered-stdin.ts —— 从 stdin 剥离鼠标 SGR/SS3/OSC 序列后再喂给 Ink。
 *
 * 解决 react-ink-textarea 内部 useInput 把 SGR 鼠标序列当文本插入的乱码 bug。
 * 关键：跨 chunk 半包（如 `\x1b[<35` + `;83;30M`）必须挂起，否则会写出
 * `[<35;83;30M` 这种进输入框的垃圾。
 *
 * 旧实现：legacy 无单独备份；本文件可 git 回退。
 */

import { PassThrough } from "node:stream";

/** 完整 SGR 鼠标（1006）：CSI < btn ; col ; row M/m */
const SGR_MOUSE = /\x1b\[<\d+;\d+;\d+[Mm]/g;
/** ESC 已被吃掉后的残片（Ink parseKeypress 或半包残留） */
const SGR_MOUSE_ORPHAN = /\[<\d+;\d+;\d+[Mm]/g;
const SS3 = /\x1bO[A-Z]/g;
const OSC_DCS = /\x1b[\]P][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/**
 * 是否可能是未写完的 CSI/鼠标前缀，应留在 pending。
 * 例：\x1b  \x1b[  \x1b[<  \x1b[<35  \x1b[<35;83  \x1b[<35;83;30
 * 以及无 ESC 的残片：[<  [<35  [<35;1  等
 */
function incompleteTail(s: string): string {
  // 优先：以 ESC 开头的未完成 CSI
  const esc = s.match(/\x1b(?:\[[0-9;?]*<?[0-9;]*)?$/);
  if (esc) return esc[0];
  // 无 ESC：以 [< 开头的未完成 SGR 残片
  const orphan = s.match(/\[<\d*(?:;\d*){0,2}$/);
  if (orphan) return orphan[0];
  // 单独一个 ESC 结尾
  if (s.endsWith("\x1b")) return "\x1b";
  return "";
}

function stripComplete(s: string): string {
  return s
    .replace(SGR_MOUSE, "")
    .replace(SGR_MOUSE_ORPHAN, "")
    .replace(SS3, "")
    .replace(OSC_DCS, "");
}

/** 包装原 stdin，剥离 SGR/SS3/OSC 序列后转发，代理 TTY 接口给 Ink。 */
export function createFilteredStdin(source: NodeJS.ReadableStream & {
  isTTY?: boolean; isRaw?: boolean; setRawMode?: (m: boolean) => unknown;
  ref?: () => unknown; unref?: () => unknown; resume?: () => unknown; pause?: () => unknown;
}): any {
  const filtered: any = new PassThrough();
  filtered.isTTY = source.isTTY ?? true;
  filtered.isRaw = false;
  filtered.setRawMode = (mode: boolean) => {
    filtered.isRaw = mode;
    source.setRawMode?.(mode);
    return filtered;
  };
  filtered.ref = () => { source.ref?.(); return filtered; };
  filtered.unref = () => { source.unref?.(); return filtered; };
  filtered.resume = () => { source.resume?.(); return filtered; };
  filtered.pause = () => { source.pause?.(); return filtered; };

  let pending = "";
  // 挂起超时：半包卡住时 50ms 后丢弃（避免 ESC 卡死键盘）
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushPendingIfStale = () => {
    flushTimer = null;
    if (!pending) return;
    // 超时仍不完整：丢弃挂起的控制序列前缀，只放行可打印残片
    const drop = incompleteTail(pending);
    if (drop && pending.endsWith(drop)) {
      pending = pending.slice(0, -drop.length);
    }
    if (pending) {
      const clean = stripComplete(pending);
      pending = "";
      if (clean) filtered.write(clean);
    } else {
      pending = "";
    }
  };

  source.on("data", (chunk: Buffer) => {
    // latin1 保 0x1b 字节；utf-8 对纯 CSI 也一样，但与 mouse 解析一致
    pending += chunk.toString("latin1");
    pending = stripComplete(pending);

    const hold = incompleteTail(pending);
    let emit = pending;
    if (hold && pending.endsWith(hold)) {
      emit = pending.slice(0, -hold.length);
      pending = hold;
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flushPendingIfStale, 50);
    } else {
      pending = "";
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    }

    if (emit) filtered.write(emit);
  });
  source.on("end", () => {
    if (flushTimer) clearTimeout(flushTimer);
    if (pending) {
      const clean = stripComplete(pending);
      if (clean) filtered.write(clean);
      pending = "";
    }
    filtered.end();
  });

  return filtered;
}
