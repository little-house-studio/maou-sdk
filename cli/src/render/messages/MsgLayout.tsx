/**
 * MsgLayout —— 对话区统一「logo 列 | 正文列」版式。
 *
 * 最左固定 LOGO_W 列留给节点符号（▸ ◈ ▣ * ─ 等），正文永不侵占该列，
 * 便于从左边快速扫节点位置。
 *
 *   |▸ | load_1 | user | 22:13
 *   |  | 用户说的话…
 *   |◈ | ↺1 | ai | …
 *   |  | 助手正文 / markdown
 *   |  | * think …
 *   |  | [tool card]
 *   |▣ | 系统/搜索结果
 */

import React from "react";
import { Box, Text } from "ink";

/** logo 列宽：1 符号 + 1 空格 */
export const LOGO_W = 2;

/** 把符号规范成刚好 LOGO_W 宽（右补空格；多字符截断） */
export function padLogo(logo: string): string {
  if (!logo) return " ".repeat(LOGO_W);
  const chars = [...logo];
  if (chars.length >= LOGO_W) return chars.slice(0, LOGO_W).join("");
  return logo + " ".repeat(LOGO_W - chars.length);
}

/** 空 logo 列（正文续行） */
export const LOGO_EMPTY = " ".repeat(LOGO_W);

/**
 * 单行：logo + 同行文本（元信息头 / 单行系统事件）。
 */
export function MsgHead({
  logo,
  color,
  bold,
  children,
}: {
  logo: string;
  color?: string;
  bold?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Box width={LOGO_W} flexShrink={0}>
        <Text color={color} bold={bold}>{padLogo(logo)}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        {typeof children === "string" || typeof children === "number" ? (
          <Text color={color} bold={bold} wrap="wrap">{children}</Text>
        ) : (
          children
        )}
      </Box>
    </Box>
  );
}

/**
 * 正文块：左侧空 logo 列 + 右侧内容（永远不对齐到最左）。
 */
export function MsgBody({
  children,
  width,
}: {
  children: React.ReactNode;
  /** 可选：限制正文区宽度（用户灰底框等） */
  width?: number;
}) {
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Box width={LOGO_W} flexShrink={0}>
        <Text>{LOGO_EMPTY}</Text>
      </Box>
      <Box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        {...(width !== undefined ? { width } : {})}
      >
        {children}
      </Box>
    </Box>
  );
}

/**
 * 整条消息外壳：可选顶部分隔（不进 logo 列，全宽细线）+ 子内容。
 */
export function MsgShell({
  children,
  marginTop,
}: {
  children: React.ReactNode;
  marginTop?: number;
}) {
  return (
    <Box flexDirection="column" marginTop={marginTop ?? 0} flexShrink={0}>
      {children}
    </Box>
  );
}
