/**
 * 剪贴板写入：OSC 52 + 本机回退（pbcopy / xclip / wl-copy / clip）。
 * 选区复制优先保证「能贴出来」，再尽量走终端协议。
 */

import { spawn } from "node:child_process";
import { platform } from "node:os";

/** 终端是否声明支持 OSC52（保守列表；不支持仍会走本机回退） */
export function osc52Supported(): boolean {
  const tp = process.env.TERM_PROGRAM ?? "";
  const term = process.env.TERM ?? "";
  if (["iTerm.app", "WezTerm", "ghostty", "kitty", "Apple_Terminal", "vscode", "WindowsTerminal", "Alacritty"].includes(tp)) {
    return true;
  }
  if (term.startsWith("xterm-kitty") || term.startsWith("xterm-ghostty") || term === "wezterm" || term.includes("256color")) {
    return true;
  }
  // tmux / screen 需外层终端支持；仍尝试写（带 DCS passthrough）
  if (process.env.TMUX || process.env.STY) return true;
  return Boolean(process.stdout.isTTY);
}

function b64encode(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

/** 仅写 OSC52（tmux 包 DCS passthrough） */
export function osc52(text: string): void {
  if (!text || !process.stdout.isTTY) return;
  // Under Ratatui, prefer native clipboard (pbcopy) — dual OSC52 from Node+Rust races.
  // copyToClipboard still falls back to spawnClipboard when osc52 is skipped.
  const tui = (
    process.env.MAOU_TUI_ACTIVE ||
    process.env.MAOU_TUI ||
    ""
  ).toLowerCase();
  if (tui === "ratatui" || tui === "rust" || tui === "rt") return;
  // BEL 与 ST 双终结，兼容性更好
  const payload = `\x1b]52;c;${b64encode(text)}\x07`;
  const seq = process.env.TMUX
    ? `\x1bPtmux;\x1b${payload.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`
    : payload;
  try {
    process.stdout.write(seq);
  } catch { /* ignore */ }
}

/**
 * 本机剪贴板命令（fire-and-forget）。
 * 返回是否成功 spawn（不保证内容已写入）。
 */
function spawnClipboard(text: string): boolean {
  const p = platform();
  try {
    if (p === "darwin") {
      const c = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
      c.stdin?.end(text);
      c.unref();
      return true;
    }
    if (p === "win32") {
      // clip.exe 期望 UTF-16LE 时偶发乱码；仍作回退
      const c = spawn("clip", [], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
      c.stdin?.end(text);
      c.unref();
      return true;
    }
    // Linux：优先 wl-copy，再 xclip，再 xsel
    for (const [cmd, args] of [
      ["wl-copy", [] as string[]],
      ["xclip", ["-selection", "clipboard"]],
      ["xsel", ["--clipboard", "--input"]],
    ] as const) {
      try {
        const c = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
        if (c.pid) {
          c.stdin?.end(text);
          c.unref();
          return true;
        }
      } catch { /* try next */ }
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * 复制到剪贴板：OSC52 + 本机命令双写。
 * @returns 是否至少走了一种路径
 */
export function copyToClipboard(text: string): boolean {
  if (!text) return false;
  let ok = false;
  if (osc52Supported() || process.stdout.isTTY) {
    osc52(text);
    ok = true;
  }
  if (spawnClipboard(text)) ok = true;
  return ok;
}
