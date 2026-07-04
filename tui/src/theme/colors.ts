// ── 配色：Marathon 酸性（黑底 + 签名黄绿 C1FD05 标题 + 绿色AI/橙色user/电光蓝/红/紫） ──
//
// 配色常量与真彩前景/背景色函数。被 themes.ts 及各 render 模块引用。

export const C = {
  bg: "0A0A0A",        // 主背景（近黑）
  panelBg: "141414",   // 面板/卡片底
  inputBg: "141414",   // 输入框底
  fg: "E8E8E8",        // 主文字（近白，高对比）
  muted: "8A8A8A",     // 次要文字
  dim: "555555",       // 暗淡
  border: "7b7b7bff",    // 边框
  borderAccent: "3A4A0A", // 选中面板边框（签名色暗版）
  accent: "bffd05b2",    // 标题/强调（Marathon 签名酸性黄绿，最亮）
  accent2: "0A64FE",   // 电光蓝（链接/信息）
  ok: "C1FD05",        // 霓虹绿（成功/状态）
  warn: "FF5E00",      // 电光橙（警告）
  err: "FC0D01",       // 纯红（错误）
  info: "0A64FE",      // 电光蓝（信息）
  highlight: "FFF01F", // 霓虹黄（选中/匹配）
  magenta: "BC13FE",   // 霓虹紫（系统提示）
  cardBg: "e0c975ff",    // 工具卡片背景（暗黄底，衬托黄色边框+内容）
  user: "FF5E00",      // user 消息（电光橙，区别于 AI）
  assistant: "C1FD05", // assistant 消息（霓虹绿）
  system: "BC13FE",    // system（紫）
  tool: "FFF01F",      // 工具名（黄）
  cache: "C1FD05",     // 缓存率（霓虹绿）
};

/** 真彩前景色函数：text → \x1b[38;2;R;G;Bm{text}\x1b[0m */
export function fg(hex: string): (t: string) => string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (t: string) => `\x1b[38;2;${r};${g};${b}m${t}\x1b[0m`;
}

/** 真彩背景色函数：text → \x1b[48;2;R;G;Bm{text}\x1b[0m（填满整行需配合 pad） */
export function bg(hex: string): (t: string) => string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (t: string) => `\x1b[48;2;${r};${g};${b}m${t}\x1b[0m`;
}
