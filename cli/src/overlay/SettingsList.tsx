/**
 * SettingsList —— 只读摘要（完整交互见 SettingsDialog）。
 * 条目来自 config/cli-settings。
 */

import React from "react";
import { Text } from "ink";
import { Overlay } from "./Overlay.js";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useLoadedTheme } from "../theme/theme-context.js";
import { settingsForSurface } from "../config/cli-settings.js";

export function SettingsList() {
  const t = useTheme();
  const loaded = useLoadedTheme();
  const thinkingLevel = useStore((s) => s.thinkingLevel);
  const approvalMode = useStore((s) => s.approvalMode);
  const perfHud = useStore((s) => s.perfHud);
  const mouseCapture = useStore((s) => s.mouseCapture);
  const provider = useStore((s) => s.provider);
  const model = useStore((s) => s.model);

  const settings = settingsForSurface("ink", {
    provider,
    model,
    approvalMode,
    thinkingLevel,
    themeName: loaded.name || loaded.id,
    perfHud,
    mouseCapture,
  });

  return (
    <Overlay title="设置" footer="Esc 关闭 · Ctrl+, 完整设置" width={52}>
      {settings.map((it) => (
        <Text key={it.value}>
          <Text color={t.accent} bold>
            {it.label.padEnd(12)}
          </Text>
          <Text color={t.fg}>{it.description}</Text>
        </Text>
      ))}
    </Overlay>
  );
}
