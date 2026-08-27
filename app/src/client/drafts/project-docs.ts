/**
 * Draft project-mode fixtures + pure helpers.
 * Mirrors CLI `.maou/project/` (USER/PROJECT/RULE/DESIGN/EXPERIENCE) + docs/.
 */

export type ProjectDocKind =
  | "user"
  | "project"
  | "rule"
  | "design"
  | "experience"
  | "doc"
  | "other";

export type ProjectDoc = {
  path: string;
  title: string;
  kind: ProjectDocKind;
  content: string;
  dirty?: boolean;
};

export type ProjectOutlineItem = {
  id: string;
  level: number;
  title: string;
  line: number;
};

export type ProjectTreeNode = {
  name: string;
  path: string;
  kind: "folder" | "file";
  docKind?: ProjectDocKind;
  children?: ProjectTreeNode[];
};

/** Showcase project docs for draft project mode. */
export const PROJECT_DOCS: ProjectDoc[] = [
  {
    path: ".maou/project/PROJECT.md",
    title: "PROJECT",
    kind: "project",
    content: [
      "# maou-sdk",
      "",
      "Monorepo：CLI · agent · app · tools。",
      "",
      "## 目标",
      "",
      "- 终端优先的 agent 体验",
      "- WebUI 草稿站对齐 CLI 语义",
      "- 项目说明落在 `.maou/project/`",
      "",
      "## 结构",
      "",
      "| 包 | 职责 |",
      "|----|------|",
      "| cli | TUI / 主题 / 会话 |",
      "| app | 聊天 + 项目工作台草稿 |",
      "| agent | 运行时与工具编排 |",
      "",
      "## 状态",
      "",
      "草稿阶段：聊天界面已通；**项目界面**用本地假数据演示文档树 / 预览 / 大纲。",
    ].join("\n"),
  },
  {
    path: ".maou/project/USER.md",
    title: "USER",
    kind: "user",
    content: [
      "# 用户偏好",
      "",
      "- 中文优先",
      "- 扁平 UI · 暖灰阶 · 酸绿信号",
      "- 工具卡 / 消息头 / 跳转与 CLI 对齐",
      "",
      "## 沟通",
      "",
      "1. 先给可扫读结构",
      "2. 再给细节与路径",
      "3. 改动能本地预览",
    ].join("\n"),
  },
  {
    path: ".maou/project/RULE.md",
    title: "RULE",
    kind: "rule",
    content: [
      "# 规则",
      "",
      "## 必须",
      "",
      "- [x] 草稿站不接 live API",
      "- [x] 场景假数据集中在 fixtures",
      "- [ ] 视觉：形状 + 色调双通道",
      "",
      "## 禁止",
      "",
      "- 发明色表外颜色",
      "- 用玻璃/圆角堆装饰",
      "",
      "~~旧：纯蓝强调~~ → 酸绿信号",
    ].join("\n"),
  },
  {
    path: ".maou/project/DESIGN.md",
    title: "DESIGN",
    kind: "design",
    content: [
      "# 设计语言",
      "",
      "Tau Ceti：**Braun 暖灰 + 酸性机能**。",
      "",
      "## 区域",
      "",
      "- 顶栏：酸绿纯色 + 黑墨 logo",
      "- 聊天：void 画布 + 用户块 + ToolCard",
      "- 项目：文档树 | 编辑/预览 | 大纲",
      "",
      "```ts",
      "type UiMode = \"chat\" | \"project\" | \"team\" | \"proactive\" | \"settings\";",
      "```",
    ].join("\n"),
  },
  {
    path: ".maou/project/EXPERIENCE.md",
    title: "EXPERIENCE",
    kind: "experience",
    content: [
      "# 经验",
      "",
      "- 审批弹出时仍可输入",
      "- busy + approval 流式条要共存",
      "- 列表前空行才能被 DraftMarkdown 识别为 ul/ol",
    ].join("\n"),
  },
  {
    path: "docs/README.md",
    title: "README",
    kind: "doc",
    content: [
      "# 文档入口",
      "",
      "项目文档与 `.maou/project/*` 说明。",
      "",
      "## 快速链接",
      "",
      "- [架构](./architecture.md)",
      "- 项目说明见 `.maou/project/PROJECT.md`",
    ].join("\n"),
  },
  {
    path: "docs/architecture.md",
    title: "architecture",
    kind: "doc",
    content: [
      "# 架构",
      "",
      "## 运行时",
      "",
      "Agent loop → tools → session jsonl。",
      "",
      "## WebUI 草稿",
      "",
      "```",
      "DraftShell",
      "  chat   → ContextPanel",
      "  project → ProjectWorkbench",
      "  team   → TeamBoard (agent 名册)",
      "```",
      "",
      "### 数据",
      "",
      "纯 fixtures，无后端。",
    ].join("\n"),
  },
];

export const DEFAULT_PROJECT_DOC_PATH = ".maou/project/PROJECT.md";

export function getProjectDoc(
  path: string,
  docs: ProjectDoc[] = PROJECT_DOCS,
): ProjectDoc | null {
  return docs.find((d) => d.path === path) ?? null;
}

/** Parse ATX headings for outline (line 0-based). */
export function parseProjectOutline(content: string): ProjectOutlineItem[] {
  const lines = content.split("\n");
  const out: ProjectOutlineItem[] = [];
  lines.forEach((line, i) => {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!m) return;
    const level = m[1]!.length;
    const title = m[2]!.trim();
    out.push({
      id: `h-${i}-${level}`,
      level,
      title,
      line: i,
    });
  });
  return out;
}

/** Build a simple folder tree from flat project doc paths. */
export function buildProjectTree(
  docs: ProjectDoc[] = PROJECT_DOCS,
): ProjectTreeNode[] {
  type Mutable = ProjectTreeNode & { children: Mutable[] };
  const root: Mutable[] = [];

  for (const doc of docs) {
    const segs = doc.path.split("/").filter(Boolean);
    if (segs.length === 0) continue;
    const fileName = segs[segs.length - 1]!;
    const folderParts = segs.slice(0, -1);
    let parent = root;
    if (folderParts.length > 0) {
      // rebuild full path on each folder level
      let acc: string[] = [];
      let cur = root;
      for (const p of folderParts) {
        acc.push(p);
        let folder = cur.find((n) => n.name === p && n.kind === "folder");
        if (!folder) {
          folder = {
            name: p,
            path: acc.join("/"),
            kind: "folder",
            children: [],
          };
          cur.push(folder);
        }
        cur = folder.children;
      }
      parent = cur;
    }
    parent.push({
      name: fileName,
      path: doc.path,
      kind: "file",
      docKind: doc.kind,
      children: [],
    });
  }

  const sortRec = (nodes: Mutable[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.children.length) sortRec(n.children);
  };
  sortRec(root);
  return root;
}

export function projectDocKindLabel(kind: ProjectDocKind): string {
  switch (kind) {
    case "user":
      return "USER";
    case "project":
      return "PROJECT";
    case "rule":
      return "RULE";
    case "design":
      return "DESIGN";
    case "experience":
      return "EXPERIENCE";
    case "doc":
      return "DOC";
    default:
      return "FILE";
  }
}

/** True when draft content differs from fixture baseline. */
export function isMarkdownDirty(content: string, baseline: string): boolean {
  return content !== baseline;
}

/**
 * Set the first task list item whose label equals `taskText` to checked/unchecked.
 * Matches `- [ ] label` / `- [x] label` (also `*`).
 */
export function setTaskChecked(
  content: string,
  taskText: string,
  checked: boolean,
): string {
  const lines = content.split("\n");
  const mark = checked ? "x" : " ";
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*[-*]\s+)\[([ xX])\]\s+(.*)$/.exec(lines[i]!);
    if (!m) continue;
    if ((m[3] ?? "") !== taskText) continue;
    lines[i] = `${m[1]}[${mark}] ${m[3]}`;
    return lines.join("\n");
  }
  return content;
}

/** Line / char stats for editor status strip. */
export function markdownDocStats(content: string): {
  lines: number;
  chars: number;
} {
  if (content.length === 0) return { lines: 0, chars: 0 };
  const lines = content.split("\n").length;
  return { lines, chars: content.length };
}

/** Case-insensitive path/name filter for the doc tree search box. */
export function pathMatchesFilter(path: string, filter: string): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  return path.toLowerCase().includes(q);
}

/** True when `filePath` is exactly `folderPath` or nested under it. */
export function isPathUnderFolder(folderPath: string, filePath: string): boolean {
  if (!folderPath) return true;
  if (filePath === folderPath) return true;
  const prefix = folderPath.endsWith("/") ? folderPath : `${folderPath}/`;
  return filePath.startsWith(prefix);
}

/** Escape a string for use inside a CSS attribute selector. */
export function escapeCssAttrSelector(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Ranked doc paths for quick-open (⌘P): basename/path/title substring match.
 * Empty query returns docs in original order.
 */
export function filterDocsForQuickOpen(
  docs: { path: string; title: string }[],
  query: string,
): { path: string; title: string; name: string }[] {
  const q = query.trim().toLowerCase();
  const mapped = docs.map((d) => ({
    path: d.path,
    title: d.title,
    name: d.path.split("/").pop() ?? d.path,
  }));
  if (!q) return mapped;
  return mapped.filter(
    (d) =>
      d.path.toLowerCase().includes(q) ||
      d.title.toLowerCase().includes(q) ||
      d.name.toLowerCase().includes(q),
  );
}

/**
 * Prune tree to paths matching filter (keeps ancestor folders of hits).
 * Empty filter returns the input tree unchanged.
 */
export function filterProjectTree(
  nodes: ProjectTreeNode[],
  filter: string,
): ProjectTreeNode[] {
  const q = filter.trim();
  if (!q) return nodes;

  const walk = (list: ProjectTreeNode[]): ProjectTreeNode[] => {
    const out: ProjectTreeNode[] = [];
    for (const n of list) {
      if (n.kind === "file") {
        if (pathMatchesFilter(n.path, q) || pathMatchesFilter(n.name, q)) {
          out.push(n);
        }
        continue;
      }
      const kids = walk(n.children ?? []);
      if (kids.length > 0 || pathMatchesFilter(n.path, q) || pathMatchesFilter(n.name, q)) {
        out.push({ ...n, children: kids });
      }
    }
    return out;
  };
  return walk(nodes);
}

/** First outline line whose title equals `title`, or null. */
export function findHeadingLineByTitle(
  content: string,
  title: string,
): number | null {
  const hit = parseProjectOutline(content).find((h) => h.title === title);
  return hit ? hit.line : null;
}

/** First 0-based line containing query (case-insensitive), or null. */
export function findLineContaining(
  content: string,
  query: string,
): number | null {
  const all = findAllLinesContaining(content, query);
  return all.length ? all[0]! : null;
}

/** All 0-based lines containing query (case-insensitive). */
export function findAllLinesContaining(
  content: string,
  query: string,
): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const lines = content.split("\n");
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.toLowerCase().includes(q)) out.push(i);
  }
  return out;
}

/**
 * Next match after `afterLine` (exclusive), wrapping to the first match.
 * When afterLine is null, returns the first match.
 */
export function findNextLineContaining(
  content: string,
  query: string,
  afterLine: number | null,
): { line: number; index: number; total: number } | null {
  const all = findAllLinesContaining(content, query);
  if (all.length === 0) return null;
  if (afterLine == null) {
    return { line: all[0]!, index: 0, total: all.length };
  }
  for (let i = 0; i < all.length; i++) {
    if (all[i]! > afterLine) {
      return { line: all[i]!, index: i, total: all.length };
    }
  }
  return { line: all[0]!, index: 0, total: all.length };
}

/**
 * Previous match before `beforeLine` (exclusive), wrapping to the last match.
 * When beforeLine is null, returns the last match.
 */
export function findPrevLineContaining(
  content: string,
  query: string,
  beforeLine: number | null,
): { line: number; index: number; total: number } | null {
  const all = findAllLinesContaining(content, query);
  if (all.length === 0) return null;
  if (beforeLine == null) {
    const i = all.length - 1;
    return { line: all[i]!, index: i, total: all.length };
  }
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i]! < beforeLine) {
      return { line: all[i]!, index: i, total: all.length };
    }
  }
  const i = all.length - 1;
  return { line: all[i]!, index: i, total: all.length };
}

/** Append an ATX heading at end of document (keeps trailing newline). */
export function appendHeading(
  content: string,
  title: string,
  level = 2,
): string {
  const hashes = "#".repeat(Math.min(6, Math.max(1, level)));
  const t = title.trim() || "新标题";
  const body = content.replace(/\s*$/, "");
  if (!body) return `${hashes} ${t}\n`;
  return `${body}\n\n${hashes} ${t}\n`;
}

/** Rename ATX heading text at 0-based line; no-op if line is not a heading. */
export function renameHeadingAtLine(
  content: string,
  line: number,
  newTitle: string,
): string {
  const lines = content.split("\n");
  if (line < 0 || line >= lines.length) return content;
  const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[line]!);
  if (!m) return content;
  const title = newTitle.trim() || m[2]!;
  lines[line] = `${m[1]} ${title}`;
  return lines.join("\n");
}

/**
 * If `oldTitle` matches an outline heading, rename that heading to `newTitle`.
 * Used when a canvas node label is edited so MD stays aligned.
 */
export function syncHeadingRename(
  content: string,
  oldTitle: string,
  newTitle: string,
): string {
  const from = oldTitle.trim();
  const to = newTitle.trim();
  if (!from || from === to) return content;
  const line = findHeadingLineByTitle(content, from);
  if (line == null) return content;
  return renameHeadingAtLine(content, line, to || from);
}

/** Filter outline items by title substring (case-insensitive). */
export function filterOutlineItems<T extends { title: string }>(
  items: T[],
  filter: string,
): T[] {
  const q = filter.trim().toLowerCase();
  if (!q) return items;
  return items.filter((h) => h.title.toLowerCase().includes(q));
}

export type ProjectViewMode = "split" | "preview" | "source" | "canvas";

export const PROJECT_VIEW_MODES: ProjectViewMode[] = [
  "split",
  "preview",
  "source",
  "canvas",
];

export function parseProjectViewMode(raw: string | null | undefined): ProjectViewMode | null {
  if (!raw) return null;
  return (PROJECT_VIEW_MODES as string[]).includes(raw)
    ? (raw as ProjectViewMode)
    : null;
}
