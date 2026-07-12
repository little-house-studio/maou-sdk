/**
 * ToastBar —— 底部 chrome 上方的短提示条（Ctrl+C 确认退出、模式切换等）。
 * 数据来自 store.toast；空 text 不渲染。
 */

import React from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";

export function ToastBar() {
  const t = useTheme();
  const toast = useStore((s) => s.toast);
  const term = useTerminalSize();

  if (!toast || !toast.text.trim()) return null;

  const kind = toast.kind ?? "info";
  const bg =
    kind === "err" ? t.err
    : kind === "warn" ? t.warn
    : kind === "ok" ? t.accent
    : t.info;
  const fg = kind === "info" ? "#FFFFFF" : "#000000";

  const prefix =
    kind === "err" ? "✕ "
    : kind === "warn" ? "⚠ "
    : kind === "ok" ? "✓ "
    : "· ";

  const raw = `${prefix}${toast.text}`;
  // 铺满一行，居中更醒目
  const w = Math.max(8, term.cols);
  let core = raw;
  if (stringWidth(core) > w) {
    let out = "";
    let used = 0;
    for (const ch of core) {
      const cw = stringWidth(ch) || 1;
      if (used + cw >= w - 1) break;
      out += ch;
      used += cw;
    }
    core = out + "…";
  }
  const pad = Math.max(0, w - stringWidth(core));
  const left = Math.floor(pad / 2);
  const line = `${" ".repeat(left)}${core}${" ".repeat(pad - left)}`;

  return (
    <Box flexShrink={0} width="100%">
      <Text backgroundColor={bg} color={fg} bold>
        {line}
      </Text>
    </Box>
  );
}
