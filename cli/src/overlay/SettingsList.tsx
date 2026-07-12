/**
 * SettingsList —— 设置面板（值循环 + 子菜单）。
 * 阶段 7 基础：思考级别 / 主题切换 / 鼠标开关。
 */

import React from "react";
import { Text } from "ink";
import { Overlay } from "./Overlay.js";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { listThemes } from "../theme/hot-reload.js";

export function SettingsList() {
  const t = useTheme();
  const thinkingLevel = useStore((s) => s.thinkingLevel);
  const approvalMode = useStore((s) => s.approvalMode);

  const settings: [string, string][] = [
    ["审核模式", `${approvalMode} (Shift+Tab 循环)`],
    ["思考级别", `${thinkingLevel}`],
    ["主题", `Tau Ceti（${listThemes().length} 个可用）`],
    ["鼠标", "关闭（终端原生拖选）"],
  ];

  return (
    <Overlay title="设置" footer="Esc 关闭" width={50}>
      {settings.map(([k, v]) => (
        <Text key={k}>
          <Text color={t.accent} bold>{k.padEnd(12)}</Text>
          <Text color={t.fg}>{v}</Text>
        </Text>
      ))}
    </Overlay>
  );
}
