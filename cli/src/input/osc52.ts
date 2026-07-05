/**
 * OSC52 —— 系统剪贴板写入（OSC 52）。
 * 序列：\x1b]52;c:<base64>\x07
 * 逐终端降级：iTerm2/Alacritty/kitty/Ghostty/WezTerm/Apple Terminal 写。
 * 注：Apple Terminal（Terminal.app）经实测支持 OSC52（2026-07 验证），
 *   旧认知"无操作"已被推翻。
 * SSH 环境下 Claude Code 也用此机制（带平台回退，这里简化只发 OSC52）。
 */

/** 检测终端是否支持 OSC52 */
export function osc52Supported(): boolean {
  const tp = process.env.TERM_PROGRAM ?? "";
  const term = process.env.TERM ?? "";
  // 已知支持
  if (["iTerm.app", "WezTerm", "ghostty", "kitty", "Apple_Terminal"].includes(tp)) return true;
  if (term.startsWith("xterm-kitty") || term.startsWith("xterm-ghostty") || term === "wezterm") return true;
  if (tp === "vscode") return true; // VSCode 终端支持
  // Alacritty 需配置开启，保守认为支持
  if (tp === "Alacritty") return true;
  // Windows Terminal
  if (tp === "WindowsTerminal") return true;
  // tmux 下若 set-clipboard on 则支持（无法可靠检测，保守不写）
  return false;
}

function b64encode(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

/** 写文本到系统剪贴板（OSC 52） */
export function osc52(text: string): void {
  if (!osc52Supported()) return;
  // 包裹 DCS passthrough（tmux 兼容，非 tmux无害）
  const seq = `\x1b]52;c;${b64encode(text)}\x07`;
  process.stdout.write(seq);
}
