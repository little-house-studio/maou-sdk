/**
 * filtered-stdin.ts —— 从 stdin 剥离鼠标 SGR/SS3/OSC 序列后再喂给 Ink。
 *
 * 解决 react-ink-textarea 内部 useInput 把 SGR 鼠标序列当文本插入的乱码 bug
 * （react-ink-textarea 不经 useCleanInput，无法靠 useCleanInput 拦截）。
 * 在 Ink render 前用此 stream 作为 stdin，序列在到达 Ink useInput 前被剥离。
 *
 * 保留：键盘字符、方向键、Ctrl 组合、Enter/Esc/Tab/Backspace。
 * 剥离：SGR 鼠标（\x1b[<...M/m）、SS3（\x1bO[XZ]）、OSC/DCS（\x1b]...\x07）。
 *
 * 实现：包装原 stdin，代理 raw mode/isTTY 等 Ink 需要的接口。
 */

import { PassThrough } from "node:stream";

const SGR_MOUSE = /\x1b\[<\d+;\d+;\d+[Mm]/g;
const SS3 = /\x1bO[A-Z]/g;
const OSC_DCS = /\x1b[\]P][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** 包装原 stdin，剥离 SGR/SS3/OSC 序列后转发，代理 TTY 接口给 Ink。返回类型 cast 为 any 以兼容 Ink 的 ReadStream 期望。 */
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
  source.on("data", (chunk: Buffer) => {
    pending += chunk.toString("utf-8");
    pending = pending.replace(SGR_MOUSE, "").replace(SS3, "").replace(OSC_DCS, "");
    if (pending) {
      filtered.write(pending);
      pending = "";
    }
  });
  source.on("end", () => filtered.end());

  return filtered;
}
