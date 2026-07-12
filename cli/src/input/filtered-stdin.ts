/**
 * filtered-stdin.ts —— 从 stdin 剥离鼠标 SGR/SS3/OSC 序列后再喂给 Ink。
 *
 * 解决 react-ink-textarea 内部 useInput 把 SGR 鼠标序列当文本插入的乱码 bug。
 * 关键：
 *  - 跨 chunk 半包（如 `\x1b[<35` + `;83;30M`）必须挂起
 *  - 中文等 UTF-8 多字节绝不能用 latin1 字符串当最终文本写出
 *    （旧实现 toString("latin1") + write(string) 会把「你」变成「ä½ 」）
 *  - 不完整 UTF-8 尾字节也要挂起，避免半个汉字被拆成替换符
 *
 * 策略：全程用 latin1 仅作「按字节」的正则剥离；写出时 Buffer.from(s,"latin1")
 * 还原原始字节，Ink 按 UTF-8 读到正确中文。
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
function incompleteCsiTail(s: string): string {
  const esc = s.match(/\x1b(?:\[[0-9;?]*<?[0-9;]*)?$/);
  if (esc) return esc[0];
  const orphan = s.match(/\[<\d*(?:;\d*){0,2}$/);
  if (orphan) return orphan[0];
  if (s.endsWith("\x1b")) return "\x1b";
  return "";
}

/**
 * 字符串末尾不完整 UTF-8 序列的字节数（latin1 视角下 1 char = 1 byte）。
 * 返回应挂起的尾部长度。
 */
function incompleteUtf8TailLen(s: string): number {
  if (!s) return 0;
  const n = s.length;
  // 从末尾往前找首字节
  for (let i = 1; i <= 4 && i <= n; i++) {
    const b = s.charCodeAt(n - i);
    if (b < 0x80) {
      // ASCII：若 i===1 完整；若 i>1 说明前面有孤立 continuation，只挂 continuation
      return i === 1 ? 0 : i - 1;
    }
    if ((b & 0xc0) === 0x80) {
      // continuation 0x80-0xBF，继续往前
      continue;
    }
    // 首字节
    let need = 0;
    if ((b & 0xe0) === 0xc0) need = 2;
    else if ((b & 0xf0) === 0xe0) need = 3;
    else if ((b & 0xf8) === 0xf0) need = 4;
    else return i; // 非法首字节，整段挂起等更多数据或超时丢弃
    if (i < need) return i; // 序列不完整
    return 0; // 完整
  }
  // 全是 continuation
  return Math.min(3, n);
}

function stripComplete(s: string): string {
  return s
    .replace(SGR_MOUSE, "")
    .replace(SGR_MOUSE_ORPHAN, "")
    .replace(SS3, "")
    .replace(OSC_DCS, "");
}

/** latin1 字节串 → 原始 Buffer 写出（保留 UTF-8 中文） */
function writeBytes(filtered: PassThrough, latin1Str: string): void {
  if (!latin1Str) return;
  filtered.write(Buffer.from(latin1Str, "latin1"));
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

  /** latin1 字节串挂起缓冲 */
  let pending = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const holdTail = (s: string): { emit: string; hold: string } => {
    const csi = incompleteCsiTail(s);
    let body = s;
    let hold = "";
    if (csi && s.endsWith(csi)) {
      body = s.slice(0, -csi.length);
      hold = csi;
    }
    const u8 = incompleteUtf8TailLen(body);
    if (u8 > 0) {
      hold = body.slice(-u8) + hold;
      body = body.slice(0, -u8);
    }
    return { emit: body, hold };
  };

  const flushPendingIfStale = () => {
    flushTimer = null;
    if (!pending) return;
    // 超时：丢掉未完成 CSI；不完整 UTF-8 仍尽量写出（可能出 �，好过卡死）
    const csi = incompleteCsiTail(pending);
    if (csi && pending.endsWith(csi)) {
      pending = pending.slice(0, -csi.length);
    }
    if (pending) {
      const clean = stripComplete(pending);
      pending = "";
      writeBytes(filtered, clean);
    }
  };

  source.on("data", (chunk: Buffer) => {
    // latin1：1:1 保留每个字节，便于按字节剥 CSI；最终用 Buffer 还原
    pending += chunk.toString("latin1");
    pending = stripComplete(pending);

    const { emit, hold } = holdTail(pending);
    pending = hold;
    if (hold) {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flushPendingIfStale, 50);
    } else if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    writeBytes(filtered, emit);
  });

  source.on("end", () => {
    if (flushTimer) clearTimeout(flushTimer);
    if (pending) {
      writeBytes(filtered, stripComplete(pending));
      pending = "";
    }
    filtered.end();
  });

  return filtered;
}

/**
 * 修复「UTF-8 被当成 latin1」的历史乱码（如 ä½ → 你）。
 * 仅当修复后含更多 CJK 且原串像 mojibake 时才替换。
 */
export function repairUtf8Mojibake(s: string): string {
  if (!s || s.length < 2) return s;
  // 已有正常 CJK 且无典型 latin1 高位乱码 → 不碰
  const hasCjk = /[\u4e00-\u9fff]/.test(s);
  const hasMojibake = /[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/.test(s)
    || /Ã.|Â.|å.|æ.|é.|è.|ä./.test(s);
  if (hasCjk && !hasMojibake) return s;
  if (!hasMojibake && !/[^\x00-\x7f]/.test(s)) return s;

  try {
    const repaired = Buffer.from(s, "latin1").toString("utf8");
    if (!repaired || repaired.includes("\uFFFD")) return s;
    const cjkBefore = (s.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const cjkAfter = (repaired.match(/[\u4e00-\u9fff]/g) ?? []).length;
    // 修复后 CJK 明显增多，或原串无 CJK 但修复后有
    if (cjkAfter > cjkBefore) return repaired;
    // 修复后去掉替换符更短、可读
    if (!hasCjk && /[\u4e00-\u9fff]/.test(repaired)) return repaired;
  } catch {
    /* keep original */
  }
  return s;
}
