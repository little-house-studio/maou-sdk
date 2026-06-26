/** Panel —— 显存区域式容器（按显示宽度硬裁剪 + 手动边框）
 *  设计原则：
 *  - Ink/Yoga 按字符数算宽度，CJK=1char但2cols → 含⚡/☰等字符时实际显示宽度超出width
 *  - 解决：不依赖Ink的width做裁剪，手动按stringWidth计算显示宽度，格式化每行为固定宽度字符串
 *  - 边框和内容作为整体字符串渲染，确保显示宽度精确匹配
 */
import React from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { currentTheme } from "../theme.js";

type BorderStyle = "single" | "round" | "double" | "bold" | "classic";

const BORDER_CHARS: Record<BorderStyle, { tl: string; tr: string; bl: string; br: string; h: string; v: string }> = {
  single: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
  round: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
  double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" },
  bold: { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" },
  classic: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" },
};

/** 将文本截断/填充到指定显示宽度（CJK=2列，ASCII=1列） */
function fitWidth(text: string, maxW: number): string {
  const sw = stringWidth(text);
  if (sw === maxW) return text;
  if (sw < maxW) return text + " ".repeat(maxW - sw);
  // 截断
  let w = 0;
  let result = "";
  for (const ch of [...text]) {
    const cw = stringWidth(ch);
    if (w + cw > maxW) break;
    result += ch;
    w += cw;
  }
  // 补齐
  if (w < maxW) result += " ".repeat(maxW - w);
  return result;
}

/** 提取 React 子节点中的所有文本 */
function extractText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (React.isValidElement(children)) {
    const props = children.props as any;
    if (props.children) return extractText(props.children);
  }
  return "";
}

export function Panel({
  title,
  children,
  borderStyle = "single",
  borderColor,
  focused = false,
  flexGrow,
  width,
  height,
  padX = 0,
  titleStyle = "block",
  icon,
}: {
  title?: string;
  children?: React.ReactNode;
  borderStyle?: BorderStyle;
  borderColor?: string;
  focused?: boolean;
  flexGrow?: number;
  width?: number | string;
  height?: number | string;
  padX?: number;
  titleStyle?: "block" | "overlay" | "none";
  icon?: string;
}) {
  const t = currentTheme;
  const bc = focused ? t.accent : borderColor ?? t.border;
  const bc2 = BORDER_CHARS[borderStyle];
  const titleText = `${icon ? `${icon} ` : ""}${title ?? ""}${focused ? " ◆" : ""}`;

  // 数值宽度
  const numW = typeof width === "number" ? width : 0;
  // 内容显示宽度 = 总宽 - 2(边框) - 2*padX
  const contentW = numW > 0 ? numW - 2 - padX * 2 : 0;

  // 提取子节点的文本行
  const childArray = React.Children.toArray(children);
  const lines: { text: string; color?: string; bold?: boolean; bg?: string }[] = [];

  for (const child of childArray) {
    if (React.isValidElement(child) && child.type === Text) {
      const props = child.props as any;
      lines.push({
        text: extractText(props.children),
        color: props.color,
        bold: props.bold,
        bg: props.backgroundColor,
      });
    } else if (typeof child === "string") {
      lines.push({ text: child });
    } else {
      // 非 Text 元素，提取文本
      lines.push({ text: extractText(child) });
    }
  }

  // 渲染：手动构建每行字符串，确保显示宽度精确
  const renderLine = (text: string, color?: string, bold?: boolean, bg?: string) => {
    const padded = padX > 0 ? " ".repeat(padX) + fitWidth(text, contentW) + " ".repeat(padX) : fitWidth(text, contentW);
    return (
      <Text color={color} bold={bold} backgroundColor={bg}>
        {bc2.v}{padded}{bc2.v}
      </Text>
    );
  };

  if (title !== undefined && titleStyle === "block") {
    // 色块标题 + 手动边框
    const titleLine = fitWidth(` ${titleText} `, numW - 2);
    return (
      <Box flexDirection="column" flexGrow={flexGrow} width={numW > 0 ? numW : undefined} flexShrink={0}>
        <Text color={bc} bold>{bc2.tl}{bc2.h.repeat(numW > 0 ? numW - 2 : 0)}{bc2.tr}</Text>
        <Text backgroundColor={bc} color={t.bg} bold>{bc2.v}{titleLine}{bc2.v}</Text>
        {lines.map((l, i) => (
          <React.Fragment key={i}>{renderLine(l.text, l.color, l.bold, l.bg)}</React.Fragment>
        ))}
        <Text color={bc} bold>{bc2.bl}{bc2.h.repeat(numW > 0 ? numW - 2 : 0)}{bc2.br}</Text>
      </Box>
    );
  }

  // 无标题或 overlay 风格
  return (
    <Box flexDirection="column" flexGrow={flexGrow} width={numW > 0 ? numW : undefined} flexShrink={0}>
      <Text color={bc} bold>{bc2.tl}{bc2.h.repeat(numW > 0 ? numW - 2 : 0)}{bc2.tr}</Text>
      {title !== undefined && titleStyle === "overlay" && (
        <Text color={bc} bold>{bc2.v}{fitWidth(` ${titleText} `, contentW)}{bc2.v}</Text>
      )}
      {lines.map((l, i) => (
        <React.Fragment key={i}>{renderLine(l.text, l.color, l.bold, l.bg)}</React.Fragment>
      ))}
      <Text color={bc} bold>{bc2.bl}{bc2.h.repeat(numW > 0 ? numW - 2 : 0)}{bc2.br}</Text>
    </Box>
  );
}

/** VFD 反色填色标签 */
export function VfdTag({
  label,
  value,
  color,
  inverse = true,
}: {
  label?: string;
  value: string;
  color?: string;
  inverse?: boolean;
}) {
  const t = currentTheme;
  const c = color ?? t.accent;
  if (inverse) {
    return (
      <Text backgroundColor={c} color={t.bg} bold>
        {label ? ` ${label} ` : ""}{value}{" "}
      </Text>
    );
  }
  return (
    <Text color={c} bold>
      {label ? `${label} ` : ""}{value}
    </Text>
  );
}

/** 分隔线 */
export function Divider({
  char = "─",
  color,
  width,
}: {
  char?: string;
  color?: string;
  width?: number;
}) {
  const t = currentTheme;
  const c = color ?? t.borderSoft;
  if (typeof width === "number") {
    return (
      <Box width={width} flexShrink={0}>
        <Text color={c}>{char.repeat(width)}</Text>
      </Box>
    );
  }
  return (
    <Box flexGrow={1} flexShrink={0} overflow="hidden">
      <Text color={c}>{char.repeat(80)}</Text>
    </Box>
  );
}
