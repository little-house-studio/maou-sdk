/**
 * OSC 22 —— 改变终端鼠标指针形状（非文本光标）。
 *
 * 协议：`OSC 22 ; <shape> ST`（Kitty / Ghostty / iTerm2 / foot 等）。
 * 形状名对齐 CSS cursor：pointer / text / grab / grabbing / progress / default…
 * 不支持的终端会忽略序列，无害。
 *
 * 不支持 OSC 22 的宿主（指针形状由宿主自行决定，应用改不了）：
 *   - **Apple 自带 Terminal.app**（`TERM_PROGRAM=Apple_Terminal`）
 *   - VS Code / xterm.js、WezTerm、Windows Terminal、Hyper
 * 这些环境上：
 *   - 整窗常显示 I 形（宿主在开启鼠标上报时的默认行为，不是 maou 逻辑错误）
 *   - 可点击处尽量用 OSC 8 伪链接触发手型（见 osc8-link.ts；VS Code 有效，Terminal.app 有限）
 *
 * @see https://sw.kovidgoyal.net/kitty/pointer-shapes/
 * @see https://ghostty.org/docs/vt/osc/22
 */

/** 常用指针形状（CSS cursor 名） */
export type PointerShape =
  | "default"
  | "pointer"   // 手型 —— 可点击
  | "text"      // I 型 —— 输入/选文
  | "grab"      // 可抓
  | "grabbing"  // 拖拽中
  | "progress"  // 忙碌/流式
  | "wait"
  | "not-allowed"
  | "crosshair"
  | "help"
  | "move"
  | "copy"
  | "col-resize"
  | "row-resize"
  | "n-resize"
  | "s-resize"
  | "e-resize"
  | "w-resize";

let lastShape: string | null = null;
let exitHooked = false;

/** 明确不支持 OSC 22 的 TERM_PROGRAM（仍可能支持 OSC 8 手型） */
const OSC22_UNSUPPORTED_PROGRAMS = new Set([
  "Apple_Terminal",   // macOS 自带终端：无 OSC 22，开鼠标上报时常固定 I 形
  "vscode",           // xterm.js — 无 OSC 22
  "WindowsTerminal",  // 截至 2026 未实现
  "WezTerm",          // 截至 2026 未实现
  "Hyper",
]);

/** 是否值得尝试 OSC 22 */
export function osc22Supported(): boolean {
  if (!process.stdout.isTTY) return false;
  if (process.env.MAOU_POINTER === "0") return false; // 显式关闭
  if (process.env.MAOU_POINTER === "1") return true;  // 强制开

  const tp = process.env.TERM_PROGRAM ?? "";
  if (OSC22_UNSUPPORTED_PROGRAMS.has(tp)) return false;

  const term = (process.env.TERM ?? "").toLowerCase();
  // 已知支持 OSC 22 的宿主
  if (
    tp === "ghostty" ||
    tp === "kitty" ||
    tp === "iTerm.app" ||
    tp === "WarpTerminal"
  ) {
    return true;
  }
  if (
    term.includes("kitty") ||
    term.includes("ghostty") ||
    term.includes("foot")
  ) {
    return true;
  }
  // 未知终端：默认尝试（失败无害）；不包含 wezterm/xterm 泛匹配以免误判
  return false;
}

function writeOsc22(shape: string): void {
  if (!process.stdout.isTTY) return;
  // Kitty 规范用 ST；部分实现只认 BEL —— 双写兼容
  const st = `\x1b]22;${shape}\x1b\\`;
  const bel = `\x1b]22;${shape}\x07`;
  const body = st + bel;
  const seq = process.env.TMUX
    ? `\x1bPtmux;\x1b${body.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`
    : body;
  try {
    process.stdout.write(seq);
  } catch {
    /* ignore */
  }
}

function ensureExitHook(): void {
  if (exitHooked) return;
  exitHooked = true;
  const reset = () => {
    try {
      lastShape = null;
      writeOsc22("");
    } catch {
      /* ignore */
    }
  };
  process.on("exit", reset);
  process.on("SIGINT", reset);
  process.on("SIGTERM", reset);
}

/**
 * 设置鼠标指针形状。同形状去重，避免 motion 刷屏。
 * @param shape CSS cursor 名；传 `default` 或 `""` 重置
 */
export function setPointerShape(shape: PointerShape | "" | string): void {
  if (!osc22Supported()) return;
  ensureExitHook();
  const key = !shape || shape === "default" ? "" : String(shape);
  if (lastShape === key) return;
  lastShape = key;
  writeOsc22(key);
}

/** 强制重置指针（退出 / 关鼠标时） */
export function resetPointerShape(): void {
  if (!process.stdout.isTTY) return;
  lastShape = null;
  writeOsc22("");
}

/**
 * 根据 UI 状态解析应显示的指针。
 * 优先级：拖选 > 可点击 > 输入区 > 流式 > 默认
 */
export function resolvePointerShape(opts: {
  dragging?: boolean;
  clickable?: boolean;
  overInput?: boolean;
  streaming?: boolean;
}): PointerShape {
  if (opts.dragging) return "grabbing";
  if (opts.clickable) return "pointer";
  if (opts.overInput) return "text";
  if (opts.streaming) return "progress";
  return "default";
}
