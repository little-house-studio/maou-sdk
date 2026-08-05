/**
 * UI 表情 / 语义图标
 *
 * 使用 Unicode 表情（系统 Color Emoji 渲染），不捆绑专有字体文件。
 * 字体栈见 fonts.css `--font-emoji`：
 *   Apple Color Emoji / Segoe UI Emoji / Noto Color Emoji / Twemoji Mozilla
 *
 * 许可说明（可商用）：
 * - Unicode 字符本身无版权限制
 * - 系统自带 emoji 字体由 OS 许可覆盖最终用户展示
 * - 若日后改为 Twemoji SVG：图形 CC-BY 4.0（需署名 Twitter/Twemoji），代码 MIT
 * - 像素壳仍用 Fusion Pixel（已有），不把像素字当正文
 *
 * 仅在「替代后不影响操作辨识」处使用（按钮前缀、状态提示等）。
 */
import React from "react";

/** 语义 → emoji 映射（可随设计扩展） */
export const UI_EMOJI = {
  settings: "⚙️",
  plug: "🔌",
  test: "📡",
  paint: "🎨",
  pin: "📌",
  ok: "✅",
  fail: "❌",
  warn: "⚠️",
  folder: "📁",
  file: "📄",
  robot: "🤖",
  spark: "✨",
  link: "🔗",
  key: "🔑",
  clock: "🕒",
  gallery: "🖼️",
  rocket: "🚀",
  chat: "💬",
  terminal: "⌨️",
  save: "💾",
  trash: "🗑️",
  add: "➕",
  close: "✖️",
  search: "🔍",
  star: "⭐",
  light: "💡",
} as const;

export type UiEmojiName = keyof typeof UI_EMOJI;

export type UiEmojiProps = {
  name: UiEmojiName;
  /** 旁注（给读屏；装饰性时可不传） */
  label?: string;
  className?: string;
  /** 仅装饰：aria-hidden */
  decorative?: boolean;
};

/** 单个语义表情 */
export function UiEmoji({
  name,
  label,
  className = "",
  decorative = true,
}: UiEmojiProps) {
  const ch = UI_EMOJI[name];
  return (
    <span
      className={`ui-emoji ${className}`.trim()}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label || name}
      title={label}
    >
      {ch}
    </span>
  );
}

/** 按钮/标签前缀：表情 + 空格（由 CSS margin 控制） */
export function EmojiLabel({
  name,
  children,
  className = "",
}: {
  name: UiEmojiName;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={className}>
      <UiEmoji name={name} decorative />
      <span className="ui-emoji-gap">{children}</span>
    </span>
  );
}
