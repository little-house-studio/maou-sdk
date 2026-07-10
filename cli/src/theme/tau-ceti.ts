/**
 * Tau Ceti 调色板 —— Marathon 磁带复古未来主义。
 *
 * 暗棕底（殖民地炭棕）+ 火焰橙（accent）+ 数据青（accent2）。
 * 低饱和暗底 + 少量高饱和强调，无水晶炫彩。每个装饰元素配色都有信息功能。
 */

import type { ThemeTokens } from "./tokens.js";

export const TAU_CETI: ThemeTokens = {
  // 通用
  bg: "#0C0A08",       // 殖民地炭棕
  panelBg: "#14110D",  // 舱壁底（overlay 背景，不透明，规避 Ink #929 CJK 重叠）
  fg: "#D7CFC4",       // 仪器文字
  muted: "#6B6358",    // 暗铁
  dim: "#443F38",      // 更暗

  // 边框
  border: "#2A2520",
  borderMuted: "#1C1814",
  borderAccent: "#FF8A3D",

  // 强调
  accent: "#FF8A3D",   // 火焰橙
  accent2: "#26C6DA",  // 数据青

  // 状态
  ok: "#66D6A0",       // 就绪青绿
  warn: "#FFC44D",     // 警告金
  err: "#FF5252",      // 危险红
  info: "#4DD0E1",     // 读数青

  // 角色
  user: "#FFAB78",     // 通话橙
  assistant: "#D7CFC4",
  system: "#B39DDB",   // AI 紫
  tool: "#FFD18A",     // 工具暖橙
  toolResult: "#66D6A0",

  // 思考级别（从暗到亮，编辑器边框色）
  thinkingOff: "#443F38",
  thinkingMinimal: "#6B6358",
  thinkingLow: "#8D8579",
  thinkingMedium: "#FFC44D",
  thinkingHigh: "#FF8A3D",
  thinkingXhigh: "#FF5252",

  // 语法高亮（暗底上的可读色）
  syntaxComment: "#6B6358",
  syntaxKeyword: "#FF8A3D",
  syntaxString: "#66D6A0",
  syntaxNumber: "#FFC44D",
  syntaxFunction: "#26C6DA",
  syntaxType: "#B39DDB",
  syntaxOperator: "#D7CFC4",
  syntaxVariable: "#D7CFC4",
  syntaxPunctuation: "#6B6358",

  // Markdown
  mdHeading: "#FF8A3D",
  mdHeading2: "#FFAB78",
  mdHeading3: "#FFC44D",
  mdCode: "#26C6DA",
  mdCodeBlock: "#D7CFC4",
  mdCodeBlockBorder: "#2A2520",
  mdQuote: "#6B6358",
  mdQuoteBorder: "#FF8A3D",
  mdHr: "#2A2520",
  mdLink: "#26C6DA",
  mdListBullet: "#FF8A3D",

  // Diff
  toolDiffAdded: "#66D6A0",
  toolDiffRemoved: "#FF5252",
  toolDiffContext: "#6B6358",

  // 背景块
  selectedBg: "#1C1814",
  // 用户消息灰底：整块长方形，明显高于主背景 #0C0A08
  userBg: "#3A3530",
  systemBg: "#14110D",
  toolPendingBg: "#1C1814",
  toolSuccessBg: "#0C0A08",
  toolErrorBg: "#1C1814",

  // 模式
  bashMode: "#66D6A0",
};
