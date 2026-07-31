import { createElement, Fragment, type ReactNode } from "react";

/**
 * Lightweight, dependency-free markdown for draft chat bodies.
 * Supports: fenced code, inline code, **bold**, *italic*, lists, links, paragraphs.
 * React text nodes are auto-escaped — no raw HTML injection.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[([^\]]+)\]\(([^)\s]+)\))/g;
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

function renderParagraph(text: string, key: string): ReactNode {
  const lines = text.split("\n");
  const nonEmpty = lines.filter((l) => l.trim());
  const listish =
    nonEmpty.length > 0 &&
    nonEmpty.every((l) => /^[-*]\s+/.test(l) || /^\d+\.\s+/.test(l));
  if (listish) {
    const ordered = nonEmpty.every((l) => /^\d+\.\s+/.test(l));
    return createElement(
      ordered ? "ol" : "ul",
      { key, className: "dm-list" },
      nonEmpty.map((l, i) =>
        createElement(
          "li",
          { key: `${key}-li${i}` },
          ...renderInline(l.replace(/^([-*]|\d+\.)\s+/, ""), `${key}-li${i}`),
        ),
      ),
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

export function DraftMarkdown({
  source,
  className = "",
}: {
  source: string;
  className?: string;
}) {
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
          if (para.trim()) blocks.push(renderParagraph(para, `p${bi++}`));
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
        if (para.trim()) blocks.push(renderParagraph(para, `p${bi++}`));
      }
    }
  }

  return createElement(
    "div",
    { className: `draft-md ${className}`.trim() },
    blocks,
  );
}
