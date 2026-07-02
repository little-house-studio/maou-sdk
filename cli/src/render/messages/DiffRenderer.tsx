/**
 * DiffRenderer —— 工具调用 diff 渲染（unified diff 着色）。
 * 用于 edit/create 工具结果显示。toolDiffAdded/Removed/Context token。
 */

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../../theme/theme-context.js";

export function DiffRenderer({ diff }: { diff: string }) {
  const t = useTheme();
  const lines = diff.split("\n");

  return (
    <Box flexDirection="column" paddingLeft={3}>
      {lines.map((l, i) => {
        if (l.startsWith("+++") || l.startsWith("---")) {
          return <Text key={i} color={t.dim}>{l}</Text>;
        }
        if (l.startsWith("+")) {
          return <Text key={i} color={t.toolDiffAdded}>+ {l.slice(1)}</Text>;
        }
        if (l.startsWith("-")) {
          return <Text key={i} color={t.toolDiffRemoved}>- {l.slice(1)}</Text>;
        }
        if (l.startsWith("@@")) {
          return <Text key={i} color={t.info}>{l}</Text>;
        }
        return <Text key={i} color={t.toolDiffContext}>  {l}</Text>;
      })}
    </Box>
  );
}
