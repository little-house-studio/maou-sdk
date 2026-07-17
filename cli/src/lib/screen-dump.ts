/**
 * 整屏截图 → 剪贴板。
 *
 * Ink 显存路径已删除。Ratatui 选区/复制由子进程处理；
 * 此处保留快捷键识别 + 明确提示（避免 silent no-op）。
 */

import { copyToClipboard } from "../input/osc52.js";

export type ScreenDumpResult =
  | { ok: true; chars: number; lines: number }
  | { ok: false; reason: "empty" | "copy_failed" | "error" | "unsupported"; message: string };

/**
 * 尝试整屏文字截图。
 * Ratatui 下无 Node 帧缓冲，返回 unsupported（store 会 toast）。
 */
export function copyScreenDump(): ScreenDumpResult {
  return {
    ok: false,
    reason: "unsupported",
    message:
      "整屏截图已随 Ink 移除；请用鼠标选区 / 终端复制，或后续 Ratatui 导出",
  };
}

/** 是否触发「整屏截图」快捷键 */
export function isScreenDumpHotkey(
  char: string,
  key: {
    ctrl?: boolean;
    shift?: boolean;
    meta?: boolean;
  },
): boolean {
  const c = char ?? "";
  if (key.ctrl && !key.meta && (c === "g" || c === "G" || c === "\x07")) {
    return true;
  }
  if (key.ctrl && (c === "\\" || c === "\x1c")) {
    return true;
  }
  if (
    key.ctrl &&
    key.shift &&
    (c === "s" || c === "S" || c === "d" || c === "D")
  ) {
    return true;
  }
  if (
    key.meta &&
    key.shift &&
    (c === "s" || c === "S" || c === "d" || c === "D")
  ) {
    return true;
  }
  return false;
}

/** 测试/调试：把任意文本写入剪贴板 */
export function copyTextDump(text: string): ScreenDumpResult {
  try {
    if (!text?.trim()) {
      return { ok: false, reason: "empty", message: "内容为空" };
    }
    const ok = copyToClipboard(text);
    if (!ok) {
      return {
        ok: false,
        reason: "copy_failed",
        message: `复制失败（${text.length} 字）`,
      };
    }
    return { ok: true, chars: text.length, lines: text.split("\n").length };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: `复制失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
