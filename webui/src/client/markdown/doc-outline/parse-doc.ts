/**
 * 自研 Markdown 解析 —— 需求 / PRD 文档专用
 *
 * - 标题树（跳过 code fence）
 * - 标题元数据：REQ-id、[P0]、状态词、#标签
 * - 正文：缩进树 + 任务列表 - [ ]
 * - 章节统计聚合（验收进度）
 */

import type {
  BodyKind,
  BodyNode,
  DocParseResult,
  DocSection,
  DocStats,
  ReqPriority,
  ReqStatus,
  SectionRole,
  SectionStats,
} from "./types";

function stripTrailingHashes(raw: string): string {
  return raw.replace(/\s+#+\s*$/, "").trim();
}

function matchHeading(
  line: string,
): { level: number; title: string } | null {
  const m = line.match(/^(#{1,6})\s+(.+)$/);
  if (!m) return null;
  return { level: m[1]!.length, title: stripTrailingHashes(m[2]!) };
}

function indentLevel(line: string): number {
  let i = 0;
  let spaces = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === " ") spaces += 1;
    else if (c === "\t") spaces += 2;
    else break;
    i++;
  }
  return Math.floor(spaces / 2);
}

/** 从标题解析需求元数据 */
export function parseTitleMeta(rawTitle: string): {
  displayTitle: string;
  reqId: string | null;
  priority: ReqPriority;
  status: ReqStatus;
  tags: string[];
  role: SectionRole;
} {
  let t = rawTitle.trim();
  let reqId: string | null = null;
  let priority: ReqPriority = null;
  let status: ReqStatus = null;
  const tags: string[] = [];

  // REQ-001 / req_001 / US-12
  const idM = t.match(/\b((?:REQ|US|FR|NFR|AC)[-_]?\d+)\b/i);
  if (idM) {
    reqId = idM[1]!.toUpperCase().replace("_", "-");
    t = t.replace(idM[0], " ").trim();
  }

  // [P0] P0: 优先级P1
  const pM = t.match(/\[?\s*P\s*([0-3])\s*\]?|^P([0-3])[:：\s]/i);
  if (pM) {
    const n = pM[1] ?? pM[2];
    priority = `P${n}` as ReqPriority;
    t = t.replace(pM[0], " ").trim();
  } else if (/高优先|必须|P0|blocker/i.test(rawTitle) && !priority) {
    if (/高优先|必须|blocker/i.test(rawTitle)) priority = "P0";
  }

  // 状态
  const statusRules: Array<[RegExp, ReqStatus]> = [
    [/\[?\s*(done|已完成|完成|closed|已上线)\s*\]?/i, "done"],
    [/\[?\s*(wip|进行中|开发中|in\s*progress)\s*\]?/i, "wip"],
    [/\[?\s*(blocked|阻塞|卡点)\s*\]?/i, "blocked"],
    [/\[?\s*(todo|待办|未开始)\s*\]?/i, "todo"],
    [/\[?\s*(draft|草稿)\s*\]?/i, "draft"],
  ];
  for (const [re, st] of statusRules) {
    if (re.test(t) || re.test(rawTitle)) {
      status = st;
      t = t.replace(re, " ").trim();
      break;
    }
  }

  // #tag
  const tagRe = /#([\w\u4e00-\u9fff-]+)/g;
  let tm: RegExpExecArray | null;
  while ((tm = tagRe.exec(rawTitle)) !== null) {
    tags.push(tm[1]!);
  }
  t = t.replace(/#([\w\u4e00-\u9fff-]+)/g, " ").trim();
  t = t.replace(/\s{2,}/g, " ").replace(/^[-–—:：|]\s*/, "").trim() || rawTitle;

  const role = inferRole(rawTitle, t);
  return { displayTitle: t, reqId, priority, status, tags, role };
}

function inferRole(raw: string, display: string): SectionRole {
  const s = `${raw} ${display}`;
  if (/验收|acceptance|ac\b|验收标准|定义完成|DoD/i.test(s)) return "acceptance";
  if (/用户故事|user\s*story|as a\b/i.test(s)) return "story";
  if (/非功能|性能|安全|可用性|NFR/i.test(s)) return "nfr";
  if (/风险|risk|依赖|dependency/i.test(s)) return "risk";
  if (/里程碑|roadmap|排期|milestone/i.test(s)) return "milestone";
  if (/接口|API|协议/i.test(s)) return "api";
  if (/数据|模型|schema|表结构/i.test(s)) return "data";
  if (/背景|现状|context|background/i.test(s)) return "background";
  if (/目标|目的|goal|objective|愿景/i.test(s)) return "goal";
  if (/范围|scope|非目标|out of scope/i.test(s)) return "scope";
  if (/角色|persona|用户画像|谁会用/i.test(s)) return "persona";
  if (/功能|特性|feature|模块|能力/i.test(s)) return "feature";
  return "other";
}

export const ROLE_LABEL: Record<SectionRole, string> = {
  doc: "文档",
  background: "背景",
  goal: "目标",
  scope: "范围",
  persona: "角色",
  feature: "功能",
  story: "故事",
  acceptance: "验收",
  nfr: "非功能",
  risk: "风险",
  milestone: "里程碑",
  api: "接口",
  data: "数据",
  other: "章节",
};

function emptyStats(): SectionStats {
  return {
    tasksOpen: 0,
    tasksDone: 0,
    childCount: 0,
    descendantCount: 0,
    hasBody: false,
    hasCode: false,
    progress: null,
  };
}

function countTasksInBody(body: string): { open: number; done: number; hasCode: boolean } {
  let open = 0;
  let done = 0;
  let hasCode = false;
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      if (!inFence) hasCode = true;
      continue;
    }
    if (inFence) {
      hasCode = true;
      continue;
    }
    if (/^\s*[-*+]\s+\[x\]/i.test(line)) done += 1;
    else if (/^\s*[-*+]\s+\[\s?\]/.test(line)) open += 1;
  }
  return { open, done, hasCode };
}

function enrichStats(sec: DocSection): void {
  const local = countTasksInBody(sec.body);
  let tasksOpen = local.open;
  let tasksDone = local.done;
  let descendantCount = 0;
  let hasCode = local.hasCode;

  for (const c of sec.children) {
    enrichStats(c);
    tasksOpen += c.stats.tasksOpen;
    tasksDone += c.stats.tasksDone;
    descendantCount += 1 + c.stats.descendantCount;
    if (c.stats.hasCode) hasCode = true;
  }

  const total = tasksOpen + tasksDone;
  sec.stats = {
    tasksOpen,
    tasksDone,
    childCount: sec.children.length,
    descendantCount,
    hasBody: !!sec.body.trim(),
    hasCode,
    progress: total > 0 ? Math.round((tasksDone / total) * 100) : null,
  };
}

function collectDocStats(root: DocSection): DocStats {
  const byPriority: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byRole: Record<string, number> = {};
  let sectionCount = 0;
  let leafCount = 0;

  const walk = (s: DocSection) => {
    if (s.level > 0) {
      sectionCount += 1;
      if (s.children.length === 0) leafCount += 1;
      if (s.priority) byPriority[s.priority] = (byPriority[s.priority] ?? 0) + 1;
      if (s.status) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
      byRole[s.role] = (byRole[s.role] ?? 0) + 1;
    }
    for (const c of s.children) walk(c);
  };
  walk(root);

  const tasksOpen = root.stats.tasksOpen;
  const tasksDone = root.stats.tasksDone;
  const total = tasksOpen + tasksDone;

  return {
    sectionCount,
    leafCount,
    tasksOpen,
    tasksDone,
    byPriority,
    byStatus,
    byRole,
    progress: total > 0 ? Math.round((tasksDone / total) * 100) : null,
  };
}

function makeSection(
  partial: Omit<DocSection, "displayTitle" | "reqId" | "priority" | "status" | "role" | "tags" | "stats"> & {
    title: string;
  },
): DocSection {
  const meta = parseTitleMeta(partial.title);
  return {
    ...partial,
    displayTitle: meta.displayTitle,
    reqId: meta.reqId,
    priority: meta.priority,
    status: meta.status,
    role: partial.level === 0 ? "doc" : meta.role,
    tags: meta.tags,
    stats: emptyStats(),
  };
}

/**
 * 解析整篇 → 标题树 + 元数据 + 统计
 */
export function parseDocTree(
  source: string,
  opts?: { fileLabel?: string },
): DocParseResult {
  const label = opts?.fileLabel || "Document";
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  type Flat = { level: number; title: string; line: number; id: string };
  const flats: Flat[] = [];
  let inFence = false;
  let fenceMark = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const mark = fence[2]![0]!;
      if (!inFence) {
        inFence = true;
        fenceMark = mark;
      } else if (mark === fenceMark) {
        inFence = false;
        fenceMark = "";
      }
      continue;
    }
    if (inFence) continue;
    const h = matchHeading(line);
    if (!h) continue;
    flats.push({
      level: h.level,
      title: h.title,
      line: i,
      id: `sec-${i}-${h.level}`,
    });
  }

  const root = makeSection({
    id: "sec-root",
    title: label,
    level: 0,
    lineStart: 0,
    lineEnd: lines.length,
    body: "",
    children: [],
  });
  root.displayTitle = label;
  root.role = "doc";

  const stack: DocSection[] = [root];
  const byId = new Map<string, DocSection>();
  byId.set(root.id, root);

  for (const f of flats) {
    const sec = makeSection({
      id: f.id,
      title: f.title,
      level: f.level,
      lineStart: f.line,
      lineEnd: lines.length,
      body: "",
      children: [],
    });
    while (stack.length > 1 && stack[stack.length - 1]!.level >= f.level) {
      stack.pop();
    }
    stack[stack.length - 1]!.children.push(sec);
    stack.push(sec);
    byId.set(sec.id, sec);
  }

  const ordered = [...byId.values()]
    .filter((s) => s.id !== "sec-root")
    .sort((a, b) => a.lineStart - b.lineStart);

  for (let i = 0; i < ordered.length; i++) {
    const sec = ordered[i]!;
    let end = lines.length;
    for (let j = i + 1; j < ordered.length; j++) {
      if (ordered[j]!.level <= sec.level) {
        end = ordered[j]!.lineStart;
        break;
      }
    }
    const firstChild = sec.children[0];
    const bodyEnd = firstChild ? firstChild.lineStart : end;
    sec.lineEnd = end;
    const bodyLines = lines.slice(sec.lineStart + 1, bodyEnd);
    while (bodyLines.length && !bodyLines[0]!.trim()) bodyLines.shift();
    while (bodyLines.length && !bodyLines[bodyLines.length - 1]!.trim()) {
      bodyLines.pop();
    }
    sec.body = bodyLines.join("\n");
  }

  if (ordered.length > 0) {
    const preface = lines.slice(0, ordered[0]!.lineStart);
    while (preface.length && !preface[0]!.trim()) preface.shift();
    while (preface.length && !preface[preface.length - 1]!.trim()) {
      preface.pop();
    }
    root.body = preface.join("\n");
  } else {
    root.body = source;
  }

  enrichStats(root);
  const stats = collectDocStats(root);
  return { root, byId, stats };
}

function isListItem(line: string): { marker: string; text: string } | null {
  const m = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
  if (!m) return null;
  return { marker: m[2]!, text: m[3] ?? "" };
}

function isTaskItem(
  line: string,
): { checked: boolean; text: string; indent: number } | null {
  const m = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
  if (!m) return null;
  return {
    indent: indentLevel(line),
    checked: m[2]!.toLowerCase() === "x",
    text: m[3] ?? "",
  };
}

export function parseBodyOutline(body: string, baseLine = 0): BodyNode[] {
  if (!body.trim()) return [];
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const roots: BodyNode[] = [];
  const stack: { indent: number; node: BodyNode }[] = [];
  let i = 0;
  let seq = 0;

  const pushNode = (node: BodyNode, indent: number) => {
    while (stack.length && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1]!.node.children.push(node);
    stack.push({ indent, node });
  };

  const popIfLeafKind = (kind: BodyKind) => {
    if (stack.length && stack[stack.length - 1]!.node.kind === kind) {
      stack.pop();
    }
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const absLine = baseLine + i;

    const fenceOpen = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (fenceOpen) {
      const indent = indentLevel(line);
      const tick = fenceOpen[2]!;
      const lang = (fenceOpen[3] ?? "").trim() || undefined;
      const codeLines: string[] = [];
      const start = absLine;
      i += 1;
      while (i < lines.length) {
        const L = lines[i] ?? "";
        if (L.match(new RegExp(`^\\s*${tick[0]!.repeat(tick.length)}\\s*$`))) break;
        codeLines.push(L);
        i += 1;
      }
      seq += 1;
      pushNode(
        {
          id: `body-${start}-${seq}`,
          kind: "code",
          text: codeLines.join("\n"),
          lang,
          indent,
          lineStart: start,
          lineEnd: baseLine + i + 1,
          children: [],
        },
        indent,
      );
      popIfLeafKind("code");
      i += 1;
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      const indent = indentLevel(line);
      seq += 1;
      pushNode(
        {
          id: `body-${absLine}-${seq}`,
          kind: "hr",
          text: "—",
          indent,
          lineStart: absLine,
          lineEnd: absLine + 1,
          children: [],
        },
        indent,
      );
      popIfLeafKind("hr");
      i += 1;
      continue;
    }

    const task = isTaskItem(line);
    if (task) {
      seq += 1;
      pushNode(
        {
          id: `body-${absLine}-${seq}`,
          kind: "task",
          text: task.text,
          indent: task.indent,
          lineStart: absLine,
          lineEnd: absLine + 1,
          children: [],
          checked: task.checked,
        },
        task.indent,
      );
      i += 1;
      continue;
    }

    const list = isListItem(line);
    if (list) {
      const indent = indentLevel(line);
      seq += 1;
      pushNode(
        {
          id: `body-${absLine}-${seq}`,
          kind: "list_item",
          text: list.text,
          indent,
          lineStart: absLine,
          lineEnd: absLine + 1,
          children: [],
        },
        indent,
      );
      i += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const indent = indentLevel(line);
      seq += 1;
      pushNode(
        {
          id: `body-${absLine}-${seq}`,
          kind: "blockquote",
          text: line.replace(/^\s*>\s?/, ""),
          indent,
          lineStart: absLine,
          lineEnd: absLine + 1,
          children: [],
        },
        indent,
      );
      popIfLeafKind("blockquote");
      i += 1;
      continue;
    }

    if (/^\s*\|/.test(line)) {
      const indent = indentLevel(line);
      seq += 1;
      pushNode(
        {
          id: `body-${absLine}-${seq}`,
          kind: "table_row",
          text: line.trim(),
          indent,
          lineStart: absLine,
          lineEnd: absLine + 1,
          children: [],
        },
        indent,
      );
      popIfLeafKind("table_row");
      i += 1;
      continue;
    }

    const indent = indentLevel(line);
    const para: string[] = [line.trim()];
    const start = absLine;
    i += 1;
    while (i < lines.length) {
      const L = lines[i] ?? "";
      if (!L.trim()) break;
      if (matchHeading(L)) break;
      if (L.match(/^\s*(`{3,}|~{3,})/)) break;
      if (isListItem(L) || isTaskItem(L)) break;
      if (/^\s*>/.test(L) || /^\s*\|/.test(L)) break;
      if (/^\s*([-*_])\1{2,}\s*$/.test(L)) break;
      para.push(L.trim());
      i += 1;
    }
    seq += 1;
    pushNode(
      {
        id: `body-${start}-${seq}`,
        kind: "paragraph",
        text: para.join(" "),
        indent,
        lineStart: start,
        lineEnd: baseLine + i,
        children: [],
      },
      indent,
    );
    popIfLeafKind("paragraph");
  }

  return roots;
}

export function pathToSection(
  root: DocSection,
  id: string,
): DocSection[] | null {
  if (root.id === id) return [root];
  for (const c of root.children) {
    const p = pathToSection(c, id);
    if (p) return [root, ...p];
  }
  return null;
}

export function findSection(root: DocSection, id: string): DocSection | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const f = findSection(c, id);
    if (f) return f;
  }
  return null;
}

export function kindLabel(k: BodyKind): string {
  switch (k) {
    case "code":
      return "CODE";
    case "list_item":
      return "LI";
    case "task":
      return "TASK";
    case "blockquote":
      return "QUOTE";
    case "table_row":
      return "ROW";
    case "hr":
      return "HR";
    case "paragraph":
      return "P";
    default:
      return "MD";
  }
}

export function statusLabel(s: ReqStatus): string {
  switch (s) {
    case "todo":
      return "待办";
    case "wip":
      return "进行中";
    case "done":
      return "完成";
    case "blocked":
      return "阻塞";
    case "draft":
      return "草稿";
    default:
      return "";
  }
}

/** 扁平列出所有非根章节 */
export function flattenSections(root: DocSection): DocSection[] {
  const out: DocSection[] = [];
  const walk = (s: DocSection) => {
    if (s.level > 0) out.push(s);
    for (const c of s.children) walk(c);
  };
  walk(root);
  return out;
}

/** 需求写作提示（空文档 / 帮助） */
export const PRD_WRITING_TIPS = [
  "用 # / ## / ### 分层：背景 → 目标 → 功能 → 验收",
  "标题可写：## [P0] REQ-001 用户登录 [WIP]",
  "验收用任务列表：- [ ] 密码错误提示正确",
  "功能点下挂用户故事与验收标准，方便统计进度",
  "风险 / 非功能 / 接口 用关键词标题，自动识别角色",
];
