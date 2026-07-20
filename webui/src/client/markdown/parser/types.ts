/** Markdown 模块 · 块级 AST（画布 / 标题树 / 批注） */

export type InlineMark =
  | { type: "text"; text: string }
  | { type: "strong"; children: InlineMark[] }
  | { type: "em"; children: InlineMark[] }
  | { type: "del"; children: InlineMark[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: InlineMark[] };

export type BlockKind =
  | "heading"
  | "paragraph"
  | "list" // 连续 ul/ol/task 顶层项合并成一块
  | "list_item"
  | "task"
  | "code"
  | "blockquote"
  | "table"
  | "hr";

export type ListType = "ul" | "ol" | "task";

export type MdBlock = {
  id: string;
  kind: BlockKind;
  /** 0-based 源码行 */
  lineStart: number;
  lineEnd: number;
  /** 列表/任务缩进层级 */
  indent: number;
  /** 标题 level 1–6 */
  headingLevel?: number;
  /** 有序表序号 */
  orderedIndex?: number;
  checked?: boolean;
  /** 代码语言 */
  lang?: string;
  /** list 容器类型 */
  listType?: ListType;
  /** 纯文本（搜索 / 批注摘录） */
  text: string;
  /** 行内 AST */
  inlines: InlineMark[];
  /** 代码块原文 */
  code?: string;
  /** 表格：首行为表头 */
  tableRows?: string[][];
  children: MdBlock[];
};

export type MdSection = {
  id: string;
  title: string;
  level: number;
  lineStart: number;
  lineEnd: number;
  /** 本节标题下的块（不含子节标题块本身进 children 树） */
  blocks: MdBlock[];
  children: MdSection[];
};

export type MdDocument = {
  sections: MdSection[];
  /** 文档序全部块（扁平，用于全局） */
  allBlocks: MdBlock[];
  raw: string;
  lines: string[];
};

/** 简单 diff 行 */
export type DiffLine = {
  type: "equal" | "add" | "del";
  text: string;
  oldLine?: number;
  newLine?: number;
};
