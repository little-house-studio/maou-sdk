/**
 * Tau Ceti 调色板 —— Braun / TE / 计算机艺术 / ASCII / 酸性机能 / 极简信息美学。
 *
 * 主色阶：黑 → 深灰 → 中灰 → 浅灰 → 白
 * 辅色：荧光黄绿（主强调）· 危险橙红 · 警告黄 · 浅罗兰 · 计算机深蓝 · 荧光青
 */

import type { ThemeTokens } from "./tokens.js";

/** 设计系统原色（带 alpha 的 #RRGGBBAA 在此落为 #RRGGBB） */
const C = {
  black: "#101010",     // 最黑主背景
  gray20: "#242424",    // 次黑 / 深灰（面板、用户气泡、边框）
  gray80: "#808080",
  grayC5: "#C5C5C5",
  white: "#FFFFFF",
  acid: "#C7FF20",      // 荧光黄绿（主）
  danger: "#FF741D",    // 危险橙红（次）
  warn: "#FFD900",      // 警告黄
  violet: "#8363FF",    // 浅罗兰紫
  deepBlue: "#2121FF",  // 计算机深蓝
  cyan: "#3BFFA7",      // 荧光青
} as const;

export const TAU_CETI: ThemeTokens = {
  // 通用
  bg: C.black,
  panelBg: C.gray20,
  fg: C.grayC5,
  muted: C.gray80,
  dim: C.gray80,

  // 边框
  border: C.gray20,
  borderMuted: C.gray20,
  borderAccent: C.acid,

  // 强调
  accent: C.acid,       // 主：荧光黄绿
  accent2: C.cyan,      // 次：荧光青

  // 状态
  ok: C.cyan,           // 成功 / 就绪
  warn: C.warn,         // 等待 / 警告
  err: C.danger,        // 失败 / 危险
  info: C.deepBlue,

  // 角色
  user: C.white,        // 用户正文：显眼白
  assistant: C.grayC5,
  system: C.violet,
  tool: C.acid,
  toolResult: C.cyan,

  // 思考级别（灰 → 酸 → 警告 → 危险）
  thinkingOff: C.gray20,
  thinkingMinimal: C.gray80,
  thinkingLow: C.grayC5,
  thinkingMedium: C.warn,
  thinkingHigh: C.acid,
  thinkingXhigh: C.danger,

  // 语法高亮
  syntaxComment: C.gray80,
  syntaxKeyword: C.acid,
  syntaxString: C.cyan,
  syntaxNumber: C.warn,
  syntaxFunction: C.deepBlue,
  syntaxType: C.violet,
  syntaxOperator: C.grayC5,
  syntaxVariable: C.white,
  syntaxPunctuation: C.gray80,

  // Markdown
  mdHeading: C.acid,
  mdHeading2: C.cyan,
  mdHeading3: C.warn,
  mdCode: C.cyan,
  mdCodeBlock: C.grayC5,
  mdCodeBlockBorder: C.gray20,
  mdQuote: C.gray80,
  mdQuoteBorder: C.acid,
  mdHr: C.gray20,
  mdLink: C.deepBlue,
  mdListBullet: C.acid,

  // Diff
  toolDiffAdded: C.cyan,
  toolDiffRemoved: C.danger,
  toolDiffContext: C.gray80,

  // 背景块
  selectedBg: C.gray20,
  // 用户气泡：深灰底，正文用纯白
  userBg: C.gray20,
  systemBg: C.gray20,
  toolPendingBg: C.gray20,
  toolSuccessBg: C.black,
  toolErrorBg: C.gray20,
  // 底部 chrome：白灰 #C5C5C5；输入槽略深一档，能看出「写字区」又别太深导致黑字
  footerBg: C.grayC5,
  inputFieldBg: "#B0B0B0",

  // 模式
  bashMode: C.cyan,
};
