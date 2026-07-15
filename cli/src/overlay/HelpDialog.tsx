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
  ["Tab / Shift+Tab", "补全确认 / 切换审核模式"],
  ["Ctrl+K", "命令面板"],
  ["Ctrl+M", "选择模型"],
  ["Ctrl+N", "新对话"],
  ["Ctrl+E", "全屏编辑器（Enter 换行不发送）"],
  ["Ctrl+G", "整屏文字截图（显存→剪贴板；Mac 推荐）"],
  ["Ctrl+\\", "同 Ctrl+G（备选）"],
  ["/screenshot", "同 Ctrl+G（命令兜底）"],
  ["Ctrl+Shift+C", "复制选区文字"],
  ["/compact", "强制压缩上下文"],
  ["/usage", "会话用量（费用/时长/改动，同 Claude Code）"],
  ["/cost", "同 /usage"],
  ["/context", "上下文占用与压缩阈值"],
  ["/prompt", "调试预览最终发给 AI 的 system/bake/tools/before_user 等"],
  ["Esc", "取消/返回/关闭（选区→补全→弹层→中断）"],
  ["Ctrl+C", "同 Esc 取消；无可取消时连按退出"],
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
