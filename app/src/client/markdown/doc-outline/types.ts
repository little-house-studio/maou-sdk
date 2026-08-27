/** 需求文档大纲 · 面向写 PRD / 需求对齐的人群 */

export type ReqPriority = "P0" | "P1" | "P2" | "P3" | null;

export type ReqStatus =
  | "todo"
  | "wip"
  | "done"
  | "blocked"
  | "draft"
  | null;

/** 章节语义角色（从标题/关键词推断） */
export type SectionRole =
  | "doc"
  | "background"
  | "goal"
  | "scope"
  | "persona"
  | "feature"
  | "story"
  | "acceptance"
  | "nfr"
  | "risk"
  | "milestone"
  | "api"
  | "data"
  | "other";

export type SectionStats = {
  /** 本章 + 子孙 未完成任务 */
  tasksOpen: number;
  tasksDone: number;
  /** 直接子标题数 */
  childCount: number;
  /** 子孙标题总数 */
  descendantCount: number;
  hasBody: boolean;
  hasCode: boolean;
  /** 0–100，无任务时 null */
  progress: number | null;
};

/** 标题层级章节 */
export type DocSection = {
  id: string;
  /** 原始标题全文 */
  title: string;
  /** 去掉 ID/优先级/状态标记后的展示名 */
  displayTitle: string;
  level: number;
  lineStart: number;
  lineEnd: number;
  body: string;
  children: DocSection[];
  /** 需求编号 REQ-001 等 */
  reqId: string | null;
  priority: ReqPriority;
  status: ReqStatus;
  role: SectionRole;
  tags: string[];
  stats: SectionStats;
};

export type BodyKind =
  | "paragraph"
  | "list_item"
  | "task"
  | "code"
  | "blockquote"
  | "table_row"
  | "hr"
  | "raw";

export type BodyNode = {
  id: string;
  kind: BodyKind;
  text: string;
  lang?: string;
  indent: number;
  lineStart: number;
  lineEnd: number;
  children: BodyNode[];
  /** task only */
  checked?: boolean;
};

export type DocStats = {
  sectionCount: number;
  leafCount: number;
  tasksOpen: number;
  tasksDone: number;
  byPriority: Record<string, number>;
  byStatus: Record<string, number>;
  byRole: Record<string, number>;
  progress: number | null;
};

export type DocParseResult = {
  root: DocSection;
  byId: Map<string, DocSection>;
  stats: DocStats;
};
