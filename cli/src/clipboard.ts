/**
 * OSC 52 剪贴板 —— 用终端转义序列把文字写入系统剪贴板。
 * 跨本地/SSH 通用（终端负责落地）。支持的终端：iTerm2 / WezTerm / kitty /
 * Ghostty / Windows Terminal / Alacritty 等；tmux 需 `set -g set-clipboard on`。
 */

/** 生成 OSC52 序列（c=clipboard, p=primary）。BEL 结尾兼容性最好。 */
export function osc52(text: string, selection: "c" | "p" = "c"): string {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  return `\x1b]52;${selection};${b64}\x07`;
}

/** 把文字写入系统剪贴板（默认 process.stdout；传入 Ink 的 stdout 以便测试捕获）。 */
export function copyToClipboard(text: string, out: { write: (s: string) => unknown } = process.stdout): void {
  if (!text) return;
  out.write(osc52(text));
}
