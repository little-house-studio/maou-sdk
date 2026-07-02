/**
 * CodeBlock —— 代码气泡（cli-highlight 全彩，无内边距）。
 */

import React from "react";
import { Box, Text } from "ink";
import { highlight } from "cli-highlight";
import { useTheme } from "../../theme/theme-context.js";

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const t = useTheme();
  try {
    const hl = highlight(code, { language: lang || undefined });
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={t.mdCodeBlockBorder} paddingX={1}>
        {lang && <Text color={t.dim}>‹{lang}›</Text>}
        {hl.split("\n").map((l, i) => <Text key={i}>{l || " "}</Text>)}
      </Box>
    );
  } catch {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={t.mdCodeBlockBorder} paddingX={1}>
        {code.split("\n").map((l, i) => <Text key={i} color={t.mdCodeBlock}>{l || " "}</Text>)}
      </Box>
    );
  }
}
