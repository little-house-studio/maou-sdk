/**
 * 整屏显存文字截图 → 剪贴板。
 * 供快捷键 / 斜杠命令 / 命令面板共用。
 */

import { extractFullScreen } from "../render/vram-layer.js";
import { copyToClipboard } from "../input/osc52.js";

export type ScreenDumpResult =
  | { ok: true; chars: number; lines: number }
  | { ok: false; reason: "empty" | "copy_failed" | "error"; message: string };

/** 抽取当前帧缓冲并写入剪贴板（OSC52 + pbcopy 等） */
export function copyScreenDump(): ScreenDumpResult {
  try {
    const text = extractFullScreen();
    if (!text || !text.trim()) {
      return { ok: false, reason: "empty", message: "显存为空，稍后再试" };
    }
    const lines = text.split("\n").length;
    const ok = copyToClipboard(text);
    if (!ok) {
      return {
        ok: false,
        reason: "copy_failed",
        message: `复制失败（${text.length} 字）`,
      };
    }
    return { ok: true, chars: text.length, lines };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: `截屏失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** 是否触发「整屏截图」快捷键（兼容 Mac 经典终端：Ctrl 组合通常无 shift 位） */
export function isScreenDumpHotkey(char: string, key: {
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
}): boolean {
  const c = char ?? "";
  // 1) 主绑定：Ctrl+G（Grab）—— macOS Terminal / iTerm 均可靠，不依赖 Shift
  if (key.ctrl && !key.meta && (c === "g" || c === "G" || c === "\x07")) {
    return true;
  }
  // 2) Ctrl+\ 或 FS(\x1c) —— 备选，少被占用
  if (key.ctrl && (c === "\\" || c === "\x1c")) {
    return true;
  }
  // 3) Ctrl+Shift+S / D —— Kitty / 支持 modifyOtherKeys 的终端
  if (
    key.ctrl &&
    key.shift &&
    (c === "s" || c === "S" || c === "d" || c === "D")
  ) {
    return true;
  }
  // 4) Cmd+Shift+S / D —— 部分终端转发 super/meta（Terminal.app 常拦截 Cmd）
  if (
    key.meta &&
    key.shift &&
    (c === "s" || c === "S" || c === "d" || c === "D")
  ) {
    return true;
  }
  return false;
}
