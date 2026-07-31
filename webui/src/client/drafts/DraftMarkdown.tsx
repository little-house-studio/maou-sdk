import { createElement, Fragment, type ReactNode } from "react";

/**
 * Lightweight, dependency-free markdown for draft chat bodies + project preview.
 * Supports: ATX headings, tables, task lists, blockquotes, hr, fenced/inline code,
 * **bold**, *italic*, ~~strike~~, links, paragraphs.
 * React text nodes are auto-escaped — no raw HTML injection.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re =
    /(`[^`\n]+`|~~[^~\n]+~~|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    const tok = m[0]!;
    if (tok.startsWith("`")) {
      nodes.push(
        createElement(
          "code",
          { key: `${keyPrefix}-c${k++}`, className: "dm-code" },
          tok.slice(1, -1),
        ),
      );
    } else if (tok.startsWith("~~")) {
      nodes.push(
        createElement(
          "del",
          { key: `${keyPrefix}-s${k++}`, className: "dm-del" },
          tok.slice(2, -2),
        ),
      );
    } else if (tok.startsWith("**")) {
      nodes.push(
        createElement(
          "strong",
          { key: `${keyPrefix}-b${k++}` },
          tok.slice(2, -2),
        ),
      );
    } else if (tok.startsWith("*")) {
      nodes.push(
        createElement(
          "em",
          { key: `${keyPrefix}-i${k++}` },
          tok.slice(1, -1),
        ),
      );
    } else if (m[2] && m[3]) {
      nodes.push(
        createElement(
          "a",
          {
            key: `${keyPrefix}-a${k++}`,
            href: m[3],
            className: "dm-link",
            target: "_blank",
            rel: "noreferrer noopener",
          },
          m[2],
        ),
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function splitTableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableCells(line);
  if (cells.length < 1) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function tryRenderTable(lines: string[], key: string): ReactNode | null {
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  if (nonEmpty.length < 2) return null;
  if (!nonEmpty[0]!.includes("|") || !isTableSeparator(nonEmpty[1]!)) {
    return null;
  }
  const header = splitTableCells(nonEmpty[0]!);
  const body = nonEmpty.slice(2).map(splitTableCells);
  return createElement(
    "table",
    { key, className: "dm-table" },
    createElement(
      "thead",
      { key: `${key}-thead` },
      createElement(
        "tr",
        { key: `${key}-hr` },
        header.map((c, i) =>
          createElement(
            "th",
            { key: `${key}-th${i}` },
            ...renderInline(c, `${key}-thi${i}`),
          ),
        ),
      ),
    ),
    createElement(
      "tbody",
      { key: `${key}-tbody` },
      body.map((row, ri) =>
        createElement(
          "tr",
          { key: `${key}-tr${ri}` },
          header.map((_, ci) =>
            createElement(
              "td",
              { key: `${key}-td${ri}-${ci}` },
              ...renderInline(row[ci] ?? "", `${key}-tdi${ri}-${ci}`),
            ),
          ),
        ),
      ),
    ),
  );
}

function renderParagraph(
  text: string,
  key: string,
  onTaskToggle?: (taskText: string, checked: boolean) => void,
): ReactNode {
  const lines = text.split("\n");
  const nonEmpty = lines.filter((l) => l.trim());
  const table = tryRenderTable(lines, key);
  if (table) return table;

  // Horizontal rule
  if (nonEmpty.length === 1 && /^(-{3,}|\*{3,}|_{3,})$/.test(nonEmpty[0]!)) {
    return createElement("hr", { key, className: "dm-hr" });
  }

  // Blockquote: all non-empty lines start with >
  const quoteish =
    nonEmpty.length > 0 && nonEmpty.every((l) => /^>\s?/.test(l));
  if (quoteish) {
    const inner = nonEmpty.map((l) => l.replace(/^>\s?/, "")).join("\n");
    return createElement(
      "blockquote",
      { key, className: "dm-quote" },
      renderParagraph(inner, `${key}-q`),
    );
  }

  const listish =
    nonEmpty.length > 0 &&
    nonEmpty.every(
      (l) =>
        /^[-*]\s+(\[[ xX]\]\s+)?/.test(l) || /^\d+\.\s+/.test(l),
    );
  if (listish) {
    const ordered = nonEmpty.every((l) => /^\d+\.\s+/.test(l));
    const hasTask = nonEmpty.some((l) => /^[-*]\s+\[[ xX]\]\s+/.test(l));
    return createElement(
      ordered ? "ol" : "ul",
      {
        key,
        className: `dm-list${hasTask ? " dm-task-list" : ""}`,
      },
      nonEmpty.map((l, i) => {
        const task = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(l);
        if (task) {
          const checked = task[1] !== " ";
          const label = task[2] ?? "";
          return createElement(
            "li",
            {
              key: `${key}-li${i}`,
              className: `dm-task${checked ? " is-checked" : ""}`,
            },
            createElement("input", {
              type: "checkbox",
              className: "dm-task-check",
              checked,
              readOnly: !onTaskToggle,
              disabled: !onTaskToggle,
              "aria-label": label || "任务项",
              onChange: onTaskToggle
                ? (e: { target: { checked: boolean } }) => {
                    onTaskToggle(label, e.target.checked);
                  }
                : undefined,
              onClick: (e: { stopPropagation: () => void }) => {
                e.stopPropagation();
              },
            }),
            createElement(
              "span",
              { className: "dm-task-label" },
              ...renderInline(label, `${key}-li${i}`),
            ),
          );
        }
        return createElement(
          "li",
          { key: `${key}-li${i}` },
          ...renderInline(l.replace(/^([-*]|\d+\.)\s+/, ""), `${key}-li${i}`),
        );
      }),
    );
  }

  const parts: ReactNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) parts.push(createElement("br", { key: `${key}-br${i}` }));
    parts.push(
      createElement(
        Fragment,
        { key: `${key}-ln${i}` },
        ...renderInline(line, `${key}-ln${i}`),
      ),
    );
  });
  return createElement("p", { key, className: "dm-p" }, parts);
}

export type DraftMarkdownProps = {
  source: string;
  className?: string;
  /** Click ATX heading in preview (project: jump to source). */
  onHeadingClick?: (title: string, level: number) => void;
  /** Toggle `- [ ]` / `- [x]` task items (project: write back to MD). */
  onTaskToggle?: (taskText: string, checked: boolean) => void;
};

/** Render a blank-line-separated block; ATX headings become h1–h6. */
function renderBlock(
  text: string,
  key: string,
  onHeadingClick?: (title: string, level: number) => void,
  onTaskToggle?: (taskText: string, checked: boolean) => void,
): ReactNode {
  const lines = text.split("\n");
  const hasHeading = lines.some((l) => /^#{1,6}\s+\S/.test(l));
  if (!hasHeading) return renderParagraph(text, key, onTaskToggle);

  const out: ReactNode[] = [];
  let bi = 0;
  let buf: string[] = [];
  const flushBuf = () => {
    if (buf.length === 0) return;
    const chunk = buf.join("\n");
    buf = [];
    if (chunk.trim()) {
      out.push(renderParagraph(chunk, `${key}-p${bi++}`, onTaskToggle));
    }
  };
  for (const line of lines) {
    const hm = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (hm) {
      flushBuf();
      const level = hm[1]!.length;
      const title = hm[2]!;
      const tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      out.push(
        createElement(
          tag,
          {
            key: `${key}-h${bi++}`,
            className: `dm-h dm-h${level}${
              onHeadingClick ? " is-clickable" : ""
            }`,
            "data-heading-level": level,
            "data-heading-title": title,
            onClick: onHeadingClick
              ? () => onHeadingClick(title, level)
              : undefined,
            title: onHeadingClick ? "点击定位到源码" : undefined,
          },
          ...renderInline(title, `${key}-hi${bi}`),
        ),
      );
    } else {
      buf.push(line);
    }
  }
  flushBuf();
  if (out.length === 0) return renderParagraph(text, key, onTaskToggle);
  if (out.length === 1) return out[0]!;
  return createElement(Fragment, { key }, ...out);
}

export function DraftMarkdown({
  source,
  className = "",
  onHeadingClick,
  onTaskToggle,
}: DraftMarkdownProps) {
  const text = source ?? "";
  if (!text.trim()) {
    return createElement("div", {
      className: `draft-md ${className}`.trim(),
    });
  }

  const blocks: ReactNode[] = [];
  const fenceRe = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let bi = 0;
  while ((m = fenceRe.exec(text)) !== null) {
    if (m.index > last) {
      const plain = text.slice(last, m.index).trim();
      if (plain) {
        for (const para of plain.split(/\n{2,}/)) {
          if (para.trim()) {
            blocks.push(
              renderBlock(para, `p${bi++}`, onHeadingClick, onTaskToggle),
            );
          }
        }
      }
    }
    const lang = m[1] || "";
    const code = (m[2] || "").replace(/\n$/, "");
    blocks.push(
      createElement(
        "pre",
        {
          key: `pre${bi++}`,
          className: `dm-pre${lang ? ` language-${lang}` : ""}`,
        },
        createElement("code", { className: "dm-code-block" }, code),
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    const plain = text.slice(last).trim();
    if (plain) {
      for (const para of plain.split(/\n{2,}/)) {
        if (para.trim()) {
          blocks.push(
            renderBlock(para, `p${bi++}`, onHeadingClick, onTaskToggle),
          );
        }
      }
    }
  }

  return createElement(
    "div",
    { className: `draft-md ${className}`.trim() },
    blocks,
  );
}
