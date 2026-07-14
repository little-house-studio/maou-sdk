/**
 * ThemeTokens —— 51-token 主题系统类型定义。
 *
 * 对齐 maou-agent/docs/tui-report.md §8 的 51-token 分类，使未来与 pi-tui
 * 主题 JSON 格式可互导。分类：通用/状态/边框/角色/思考级别/语法/Markdown/
 * Diff/模式。每个 token 在调色板实例中必须填值（无死 token）。
 */

export interface ThemeTokens {
  // ── 通用（5）─────────────────────────────────────────
  bg: string;          // 主背景
  panelBg: string;     // 面板/overlay 底
  fg: string;          // 主前景
  muted: string;       // 次要文字
  dim: string;         // 暗调/占位

  // ── 边框（3）─────────────────────────────────────────
  border: string;
  borderMuted: string;
  borderAccent: string;

  // ── 强调（2）─────────────────────────────────────────
  accent: string;      // 主强调（荧光黄绿）
  accent2: string;     // 次强调（荧光青）

  // ── 状态（4）─────────────────────────────────────────
  ok: string;
  warn: string;
  err: string;
  info: string;

  // ── 角色色（5）───────────────────────────────────────
  user: string;
  assistant: string;
  system: string;
  tool: string;
  toolResult: string;

  // ── 思考级别（6）─────────────────────────────────────
  thinkingOff: string;
  thinkingMinimal: string;
  thinkingLow: string;
  thinkingMedium: string;
  thinkingHigh: string;
  thinkingXhigh: string;

  // ── 语法高亮（9）─────────────────────────────────────
  syntaxComment: string;
  syntaxKeyword: string;
  syntaxString: string;
  syntaxNumber: string;
  syntaxFunction: string;
  syntaxType: string;
  syntaxOperator: string;
  syntaxVariable: string;
  syntaxPunctuation: string;

  // ── Markdown（11）────────────────────────────────────
  mdHeading: string;
  mdHeading2: string;
  mdHeading3: string;
  mdCode: string;
  mdCodeBlock: string;
  mdCodeBlockBorder: string;
  mdQuote: string;
  mdQuoteBorder: string;
  mdHr: string;
  mdLink: string;
  mdListBullet: string;

  // ── Diff（3）─────────────────────────────────────────
  toolDiffAdded: string;
  toolDiffRemoved: string;
  toolDiffContext: string;

  // ── 背景块（8+）──────────────────────────────────────
  selectedBg: string;
  userBg: string;
  systemBg: string;
  toolPendingBg: string;
  toolSuccessBg: string;
  toolErrorBg: string;
  /** 底部 chrome（InputBar+InfoBar+NavBar）底：白灰 #C5C5C5 */
  footerBg: string;
  /** 可写输入区底：中灰 #808080 */
  inputFieldBg: string;
  /** AI Markdown 居中纸面背景（中性深灰抬升，非冷蓝） */
  assistantMdBg: string;
  /** AI Markdown 纸面边框（弱；默认无粗框） */
  mdPaperBorder: string;

  // ── 模式（1）─────────────────────────────────────────
  bashMode: string;
}

// 装饰元素符号（非颜色，统一字符，便于全局替换）
export interface ThemeSymbols {
  separator: string;     // // 代号分隔
  index: string;         // ▌ 编号
  marker: string;        // ▸ 标记/选中
  barFull: string;       // █ 数据条满
  barEmpty: string;      // ░ 数据条空
  channel: string;       // [ch.NN] 信道框
  recDot: string;        // ● 录制点
  spinner: string;       // ⠋⠙⠹... 思考/工具 spinner
}

export const SYMBOLS: ThemeSymbols = {
  separator: "//",
  index: "▌",
  marker: "▸",
  barFull: "█",
  barEmpty: "░",
  channel: "ch",
  recDot: "●",
  spinner: "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏",
};

// sparkline 字符梯度（低→高）
export const SPARKLINE_CHARS = "▁▂▃▄▅▆▇█";
