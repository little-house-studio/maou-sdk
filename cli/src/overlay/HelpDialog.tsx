/**
 * HelpDialog —— 快捷键帮助。
 */

import React from "react";
import { Text } from "ink";
import { Overlay } from "./Overlay.js";
import { useTheme } from "../theme/theme-context.js";

const KEYS: [string, string][] = [
  ["Enter", "发送"],
  ["Alt+Enter", "换行"],
  ["Tab / Shift+Tab", "补全确认 / 切换思考级别"],
  ["Ctrl+K", "命令面板"],
  ["Ctrl+M", "选择模型"],
  ["Ctrl+N", "新对话"],
  ["Ctrl+E", "全屏编辑器（Enter 换行不发送）"],
  ["Ctrl+G", "外部 $EDITOR"],
  ["Esc", "中断 / 关闭弹窗"],
  ["Ctrl+C", "退出"],
];

export function HelpDialog() {
  const t = useTheme();
  return (
    <Overlay title="帮助" footer="Esc 关闭" width={56}>
      {KEYS.map(([k, d]) => (
        <Text key={k}>
          <Text color={t.accent} bold>{k.padEnd(20)}</Text>
          <Text color={t.fg}>{d}</Text>
        </Text>
      ))}
    </Overlay>
  );
}
