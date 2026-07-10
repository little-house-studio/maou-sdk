/**
 * CodeBlock —— cli-highlight 全彩代码气泡（薄壳）。
 *
 * 旧实现：legacy/pre-lib-migration/render/messages/CodeBlock.tsx
 */

import React from "react";
import { Box, Text } from "ink";
import { highlight } from "cli-highlight";
import { useTheme } from "../../theme/theme-context.js";

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const t = useTheme();
  let hl: string | null = null;
  try {
    hl = highlight(code, { language: lang || undefined });
  } catch {
    hl = null;
  }
  const lines = (hl ?? code).split("\n");
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.mdCodeBlockBorder} paddingX={1}>
      {lang && <Text color={t.dim}>‹{lang}›</Text>}
      {lines.map((l, i) =>
        hl
          ? <Text key={i}>{l || " "}</Text>
          : <Text key={i} color={t.mdCodeBlock}>{l || " "}</Text>,
      )}
    </Box>
  );
}
