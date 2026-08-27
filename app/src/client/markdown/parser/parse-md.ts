/**
 * 自研 Markdown 解析 → 章节树 + 块 AST
 */

import { parseInlines, inlinesToPlain } from "./inline";
import type { ListType, MdBlock, MdDocument, MdSection } from "./types";

let _seq = 0;
function bid(prefix: string): string {
  _seq += 1;
  return `${prefix}-${_seq}`;
}

function indentLevel(line: string): number {
  let spaces = 0;
  for (const c of line) {
    if (c === " ") spaces += 1;
    else if (c === "\t") spaces += 2;
    else break;
  }
  return Math.floor(spaces / 2);
}

function matchHeading(line: string): { level: number; title: string } | null {
  const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
  if (!m) return null;
  return { level: m[1]!.length, title: m[2]!.replace(/\s+#+\s*$/, "").trim() };
}

function matchList(
  line: string,
): { indent: number; ordered: boolean; index?: number; rest: string } | null {
  const u = line.match(/^(\s*)([-*+])\s+(.*)$/);
  if (u) return { indent: indentLevel(line), ordered: false, rest: u[3] ?? "" };
  const o = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (o)
    return {
      indent: indentLevel(line),
      ordered: true,
      index: Number(o[2]),
      rest: o[3] ?? "",
    };
  return null;
}

function matchTask(
  line: string,
): { indent: number; checked: boolean; text: string } | null {
  const m = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
  if (!m) return null;
  return {
    indent: indentLevel(line),
    checked: m[2]!.toLowerCase() === "x",
    text: m[3] ?? "",
  };
}

function parseTableRows(lines: string[], start: number): {
  rows: string[][];
  end: number;
} {
  const rows: string[][] = [];
  let i = start;
  while (i < lines.length) {
    const L = lines[i] ?? "";
    if (!/^\s*\|/.test(L)) break;
    if (/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(L)) {
      i += 1;
      continue; // separator
    }
    const cells = L.replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((c) => c.trim());
    rows.push(cells);
    i += 1;
  }
  return { rows, end: i };
}

function attachChild(stack: { indent: number; block: MdBlock }[], block: MdBlock, indent: number) {
  while (stack.length && stack[stack.length - 1]!.indent >= indent) {
    stack.pop();
  }
  if (stack.length === 0) {
    return { root: true as const };
  }
  stack[stack.length - 1]!.block.children.push(block);
  return { root: false as const };
}

/**
 * 解析某行范围内的块（不含子标题行）
 */
export function parseBlocksInRange(
  lines: string[],
  from: number,
  to: number,
): MdBlock[] {
  const roots: MdBlock[] = [];
  const stack: { indent: number; block: MdBlock }[] = [];
  let i = from;

  const pushRootOrChild = (block: MdBlock, indent: number, asContainer: boolean) => {
    const r = attachChild(stack, block, indent);
    if (r.root) roots.push(block);
    if (asContainer) stack.push({ indent, block });
    else if (stack.length && stack[stack.length - 1]!.block === block) {
      /* stay */
    } else if (!r.root && asContainer === false) {
      // leaf: don't keep non-list on stack unless list/task
    }
  };

  while (i < to) {
    const line = lines[i] ?? "";
    const abs = i;

    // fence
    const fence = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const indent = indentLevel(line);
      const tick = fence[2]!;
      const lang = (fence[3] ?? "").trim() || undefined;
      const codeLines: string[] = [];
      i += 1;
      while (i < to) {
        const L = lines[i] ?? "";
        if (L.match(new RegExp(`^\\s*${tick[0]!.repeat(tick.length)}\\s*$`))) {
          break;
        }
        codeLines.push(L);
        i += 1;
      }
      const code = codeLines.join("\n");
      const block: MdBlock = {
        id: bid("code"),
        kind: "code",
        lineStart: abs,
        lineEnd: i + 1,
        indent,
        lang,
        text: code,
        inlines: [],
        code,
        children: [],
      };
      const r = attachChild(stack, block, indent);
      if (r.root) roots.push(block);
      i += 1;
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (matchHeading(line)) {
      // 范围内的标题按 paragraph 处理（章节边界在上层切）
      // 若在 section body 内出现更深层标题，上层会先切开
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      const block: MdBlock = {
        id: bid("hr"),
        kind: "hr",
        lineStart: abs,
        lineEnd: abs + 1,
        indent: 0,
        text: "—",
        inlines: [],
        children: [],
      };
      roots.push(block);
      stack.length = 0;
      i += 1;
      continue;
    }

    if (/^\s*\|/.test(line)) {
      const { rows, end } = parseTableRows(lines, i);
      if (rows.length) {
        const block: MdBlock = {
          id: bid("table"),
          kind: "table",
          lineStart: abs,
          lineEnd: end,
          indent: 0,
          text: rows.map((r) => r.join(" | ")).join("\n"),
          inlines: [],
          tableRows: rows,
          children: [],
        };
        roots.push(block);
        stack.length = 0;
      }
      i = end;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const parts: string[] = [];
      const start = abs;
      while (i < to && /^\s*>/.test(lines[i] ?? "")) {
        parts.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i += 1;
      }
      const text = parts.join("\n");
      const block: MdBlock = {
        id: bid("bq"),
        kind: "blockquote",
        lineStart: start,
        lineEnd: i,
        indent: 0,
        text,
        inlines: parseInlines(text.replace(/\n/g, " ")),
        children: [],
      };
      roots.push(block);
      stack.length = 0;
      continue;
    }

    const task = matchTask(line);
    if (task) {
      const inlines = parseInlines(task.text);
      const block: MdBlock = {
        id: bid("task"),
        kind: "task",
        lineStart: abs,
        lineEnd: abs + 1,
        indent: task.indent,
        checked: task.checked,
        text: task.text,
        inlines,
        children: [],
      };
      const r = attachChild(stack, block, task.indent);
      if (r.root) roots.push(block);
      stack.push({ indent: task.indent, block });
      i += 1;
      continue;
    }

    const list = matchList(line);
    if (list) {
      // 避免把 task 当 list（已处理）
      const inlines = parseInlines(list.rest);
      const block: MdBlock = {
        id: bid("li"),
        kind: "list_item",
        lineStart: abs,
        lineEnd: abs + 1,
        indent: list.indent,
        orderedIndex: list.ordered ? list.index : undefined,
        text: list.rest,
        inlines,
        children: [],
      };
      const r = attachChild(stack, block, list.indent);
      if (r.root) roots.push(block);
      stack.push({ indent: list.indent, block });
      i += 1;
      continue;
    }

    // paragraph：合并连续行
    const start = abs;
    const paraLines: string[] = [line.trim()];
    i += 1;
    while (i < to) {
      const L = lines[i] ?? "";
      if (!L.trim()) break;
      if (matchHeading(L)) break;
      if (/^\s*(```|~~~)/.test(L)) break;
      if (matchList(L) || matchTask(L)) break;
      if (/^\s*>/.test(L) || /^\s*\|/.test(L)) break;
      if (/^\s*([-*_])\1{2,}\s*$/.test(L)) break;
      paraLines.push(L.trim());
      i += 1;
    }
    const text = paraLines.join(" ");
    const block: MdBlock = {
      id: bid("p"),
      kind: "paragraph",
      lineStart: start,
      lineEnd: i,
      indent: 0,
      text,
      inlines: parseInlines(text),
      children: [],
    };
    roots.push(block);
    stack.length = 0;
  }

  return groupConsecutiveLists(roots);
}

/**
 * 连续顶层 list_item / task 合并为一个 list 块
 * （中间被段落/代码/标题等打断则拆成多个 list 块）
 */
function listFlavor(b: MdBlock): ListType | null {
  if (b.kind === "task") return "task";
  if (b.kind === "list_item") {
    return b.orderedIndex != null ? "ol" : "ul";
  }
  return null;
}

function groupConsecutiveLists(roots: MdBlock[]): MdBlock[] {
  const out: MdBlock[] = [];
  let i = 0;
  while (i < roots.length) {
    const b = roots[i]!;
    const flavor = listFlavor(b);
    if (!flavor) {
      out.push(b);
      i += 1;
      continue;
    }
    const items: MdBlock[] = [];
    const start = b.lineStart;
    let end = b.lineEnd;
    while (i < roots.length) {
      const cur = roots[i]!;
      const f = listFlavor(cur);
      if (f !== flavor) break;
      items.push(cur);
      end = Math.max(end, cur.lineEnd);
      // 子树 lineEnd 也要算进
      const walkEnd = (n: MdBlock) => {
        end = Math.max(end, n.lineEnd);
        for (const c of n.children) walkEnd(c);
      };
      walkEnd(cur);
      i += 1;
    }
    const label =
      flavor === "task"
        ? "任务列表"
        : flavor === "ol"
          ? "有序列表"
          : "无序列表";
    out.push({
      id: bid("list"),
      kind: "list",
      lineStart: start,
      lineEnd: end,
      indent: 0,
      listType: flavor,
      text: label,
      inlines: [{ type: "text", text: label }],
      children: items,
    });
  }
  return out;
}

export function parseMarkdownDocument(source: string): MdDocument {
  _seq = 0;
  const raw = source.replace(/\r\n/g, "\n");
  const lines = raw.split("\n");

  type Flat = { level: number; title: string; line: number };
  const flats: Flat[] = [];
  let inFence = false;
  let fenceMark = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = line.match(/^(\s*)(`{3,}|~{3,})/);
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
    if (h) flats.push({ level: h.level, title: h.title, line: i });
  }

  const root: MdSection = {
    id: "sec-root",
    title: "Document",
    level: 0,
    lineStart: 0,
    lineEnd: lines.length,
    blocks: [],
    children: [],
  };

  const stack: MdSection[] = [root];
  for (const f of flats) {
    const sec: MdSection = {
      id: `sec-${f.line}`,
      title: f.title,
      level: f.level,
      lineStart: f.line,
      lineEnd: lines.length,
      blocks: [],
      children: [],
    };
    while (stack.length > 1 && stack[stack.length - 1]!.level >= f.level) {
      stack.pop();
    }
    stack[stack.length - 1]!.children.push(sec);
    stack.push(sec);
  }

  // lineEnd + blocks
  const allSecs: MdSection[] = [];
  const walk = (s: MdSection) => {
    if (s.level > 0) allSecs.push(s);
    for (const c of s.children) walk(c);
  };
  walk(root);
  allSecs.sort((a, b) => a.lineStart - b.lineStart);

  for (let i = 0; i < allSecs.length; i++) {
    const sec = allSecs[i]!;
    let end = lines.length;
    for (let j = i + 1; j < allSecs.length; j++) {
      if (allSecs[j]!.level <= sec.level) {
        end = allSecs[j]!.lineStart;
        break;
      }
    }
    sec.lineEnd = end;
    const bodyStart = sec.lineStart + 1;
    const firstChild = sec.children[0];
    const bodyEnd = firstChild ? firstChild.lineStart : end;
    sec.blocks = parseBlocksInRange(lines, bodyStart, bodyEnd);
  }

  // 前言
  if (allSecs.length > 0) {
    root.blocks = parseBlocksInRange(lines, 0, allSecs[0]!.lineStart);
  } else {
    root.blocks = parseBlocksInRange(lines, 0, lines.length);
  }

  const allBlocks: MdBlock[] = [];
  const collect = (blocks: MdBlock[]) => {
    for (const b of blocks) {
      allBlocks.push(b);
      collect(b.children);
    }
  };
  const collectSec = (s: MdSection) => {
    // heading pseudo-block for selection
    if (s.level > 0) {
      allBlocks.push({
        id: s.id,
        kind: "heading",
        lineStart: s.lineStart,
        lineEnd: s.lineStart + 1,
        indent: 0,
        headingLevel: s.level,
        text: s.title,
        inlines: parseInlines(s.title),
        children: [],
      });
    }
    collect(s.blocks);
    for (const c of s.children) collectSec(c);
  };
  collectSec(root);

  return { sections: root.children, allBlocks, raw, lines };
}

export function findSectionById(
  sections: MdSection[],
  id: string,
): MdSection | null {
  for (const s of sections) {
    if (s.id === id) return s;
    const f = findSectionById(s.children, id);
    if (f) return f;
  }
  return null;
}

/** 当前节 + 子孙在画布上展示的块序列（含标题块） */
export function sectionCanvasBlocks(sec: MdSection): {
  heading?: MdBlock;
  blocks: MdBlock[];
  childSections: MdSection[];
} {
  const heading: MdBlock | undefined =
    sec.level > 0
      ? {
          id: sec.id,
          kind: "heading",
          lineStart: sec.lineStart,
          lineEnd: sec.lineStart + 1,
          indent: 0,
          headingLevel: sec.level,
          text: sec.title,
          inlines: parseInlines(sec.title),
          children: [],
        }
      : undefined;
  return {
    heading,
    blocks: sec.blocks,
    childSections: sec.children,
  };
}

export { inlinesToPlain };
