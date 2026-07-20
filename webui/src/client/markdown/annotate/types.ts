/** 批注多选 · 选区与备注 */

export type AnnotateHit = {
  id: string;
  /** block 或 section id */
  targetId: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  text: string;
};

export type AnnotationGroup = {
  id: string;
  color: string;
  note: string;
  /** 快速备注标签 */
  quickTag?: string;
  hits: AnnotateHit[];
};

export const ANNOT_COLORS = [
  "#c7ff20",
  "#5eead4",
  "#a8c8ff",
  "#f0abfc",
  "#fbbf24",
  "#ff6b4a",
];

export const QUICK_NOTES = [
  "细化这里",
  "补充验收",
  "需要对齐",
  "删减冗余",
  "补充案例",
  "标为风险",
];

/**
 * 把[<文件路径>里面的（行号范围）'<文本>']…
 */
export function formatAnnotationMessage(
  groups: AnnotationGroup[],
): string {
  const parts: string[] = [];
  for (const g of groups) {
    if (!g.hits.length) continue;
    const chunks = g.hits.map((h) => {
      const range =
        h.lineEnd > h.lineStart + 1
          ? `${h.lineStart + 1}-${h.lineEnd}`
          : `${h.lineStart + 1}`;
      const excerpt = h.text.replace(/'/g, "’").slice(0, 200);
      return `${h.filePath}里面的（${range}）'${excerpt}'`;
    });
    const body = chunks.join("、");
    const note = g.note || g.quickTag || "";
    parts.push(`把[${body}]${note}`);
  }
  return parts.join("\n\n");
}
