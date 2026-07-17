/**
 * HelpDialog —— 快捷键帮助（config/cli-commands 同源）。
 */

import React from "react";
import { Text } from "ink";
import { Overlay } from "./Overlay.js";
import { useTheme } from "../theme/theme-context.js";
import { helpKeyRows } from "../config/cli-commands.js";

export function HelpDialog() {
  const t = useTheme();
  const keys = helpKeyRows();
  return (
    <Overlay title="帮助" footer="Esc 关闭" width={56}>
      {keys.map(([k, d]) => (
        <Text key={k}>
          <Text color={t.accent} bold>
            {k.padEnd(20)}
          </Text>
          <Text color={t.fg}>{d}</Text>
        </Text>
      ))}
    </Overlay>
  );
}
