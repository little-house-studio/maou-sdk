/**
 * DiffRenderer —— 用 diff 库解析/着色 unified diff。
 * 优先 parsePatch；失败则按行 +/-/@@ 着色（兼容非标准工具输出）。
 *
 * 旧实现：legacy/pre-lib-migration/render/messages/DiffRenderer.tsx
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { parsePatch, type StructuredPatch } from "diff";
import { useTheme } from "../../theme/theme-context.js";

type Row = { kind: "meta" | "add" | "del" | "hunk" | "ctx"; text: string };

function rowsFromPatch(patches: StructuredPatch[]): Row[] {
  const rows: Row[] = [];
  for (const p of patches) {
    if (p.oldFileName) rows.push({ kind: "meta", text: `--- ${p.oldFileName}` });
    if (p.newFileName) rows.push({ kind: "meta", text: `+++ ${p.newFileName}` });
    for (const h of p.hunks) {
      rows.push({
        kind: "hunk",
        text: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
      });
      for (const line of h.lines) {
        if (line.startsWith("+")) rows.push({ kind: "add", text: line.slice(1) });
        else if (line.startsWith("-")) rows.push({ kind: "del", text: line.slice(1) });
        else if (line.startsWith("\\")) rows.push({ kind: "meta", text: line });
        else rows.push({ kind: "ctx", text: line.startsWith(" ") ? line.slice(1) : line });
      }
    }
  }
  return rows;
}

function rowsFromLines(diff: string): Row[] {
  return diff.split("\n").map((l) => {
    if (l.startsWith("+++") || l.startsWith("---")) return { kind: "meta" as const, text: l };
    if (l.startsWith("+")) return { kind: "add" as const, text: l.slice(1) };
    if (l.startsWith("-")) return { kind: "del" as const, text: l.slice(1) };
    if (l.startsWith("@@")) return { kind: "hunk" as const, text: l };
    return { kind: "ctx" as const, text: l };
  });
}

export function DiffRenderer({ diff }: { diff: string }) {
  const t = useTheme();
  const rows = useMemo(() => {
    if (!diff) return [] as Row[];
    try {
      const patches = parsePatch(diff);
      if (patches.length > 0 && patches.some((p) => p.hunks?.length)) {
        return rowsFromPatch(patches);
      }
    } catch { /* fall through */ }
    return rowsFromLines(diff);
  }, [diff]);

  return (
    <Box flexDirection="column" paddingLeft={3}>
      {rows.map((r, i) => {
        if (r.kind === "meta") return <Text key={i} color={t.dim}>{r.text}</Text>;
        if (r.kind === "add") return <Text key={i} color={t.toolDiffAdded}>+ {r.text}</Text>;
        if (r.kind === "del") return <Text key={i} color={t.toolDiffRemoved}>- {r.text}</Text>;
        if (r.kind === "hunk") return <Text key={i} color={t.info}>{r.text}</Text>;
        return <Text key={i} color={t.toolDiffContext}>  {r.text}</Text>;
      })}
    </Box>
  );
}
