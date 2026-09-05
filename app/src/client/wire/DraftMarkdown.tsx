/**
 * Chat / project preview markdown — powered by react-markdown + remark-gfm.
 *
 * CommonMark + GFM: headings, lists, task lists, tables, strikethrough,
 * autolinks, fenced code, blockquotes, hr, emphasis, links.
 * Raw HTML is NOT rendered (safe by default).
 * Keeps `dm-*` class names for existing wire.css styles.
 */
import React, { useMemo, useRef, type ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { looksLikeLocalPath, openLocalPath, splitPathTokens } from "../open-local";
import { splitMarkdownBlocks } from "./markdown-blocks";

export type DraftMarkdownProps = {
  source: string;
  className?: string;
  /** Click ATX heading in preview (project: jump to source). */
  onHeadingClick?: (title: string, level: number) => void;
  /** Toggle `- [ ]` / `- [x]` task items (project: write back to MD). */
  onTaskToggle?: (taskText: string, checked: boolean) => void;
  /** 正文里的本地路径可点开。 */
  linkPaths?: boolean;
  /**
   * 正在流式增长的正文：按顶层块分别渲染并 memo，每帧只重解析尾块。
   * DOM 与整段渲染逐字一致（见 markdown-blocks.test.ts）。本实例一旦分块就一直分块，
   * 生成结束时不会再整段重解析一次。
   */
  streaming?: boolean;
};

function PathAware({ children }: { children?: ReactNode }) {
  return (
    <>
      {React.Children.map(children, (ch, idx) => {
        if (typeof ch !== "string") return ch;
        return splitPathTokens(ch).map((part, i) =>
          part.path ? (
            <button
              key={`${idx}-${part.path}-${i}`}
              type="button"
              className="dm-path"
              onClick={() => void openLocalPath(part.path!)}
            >
              {part.text}
            </button>
          ) : (
            <React.Fragment key={`${idx}-${i}`}>{part.text}</React.Fragment>
          ),
        );
      })}
    </>
  );
}

function plainText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return plainText(props?.children);
  }
  return "";
}

/** 是否为 markdown 列表项行（含缩进嵌套） */
function isListItemLine(line: string): boolean {
  return /^(\s*)([-*+]|\d{1,3}\.)\s+\S/.test(line);
}

/**
 * 压掉列表项之间的空行，避免 CommonMark「松散列表」给每项包 <p> 造成隔行。
 * 段落之间的空行仍保留（前后都不是列表项时）。
 */
export function tightenMarkdownListBlankLines(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      let j = i;
      while (j < lines.length && lines[j]!.trim() === "") j++;
      let prev = "";
      for (let k = out.length - 1; k >= 0; k--) {
        if (out[k]!.trim() !== "") {
          prev = out[k]!;
          break;
        }
      }
      const next = j < lines.length ? lines[j]! : "";
      if (isListItemLine(prev) && isListItemLine(next)) {
        // 列表项之间：丢弃空行 → 紧凑列表
        i = j;
        continue;
      }
      // 非列表：只保留一个空行
      out.push("");
      i = j;
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
}

function buildComponents(
  onHeadingClick?: (title: string, level: number) => void,
  onTaskToggle?: (taskText: string, checked: boolean) => void,
  linkPaths?: boolean,
): Components {
  const heading =
    (level: 1 | 2 | 3 | 4 | 5 | 6) =>
    ({ children }: { children?: ReactNode }) => {
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      const title = plainText(children).trim();
      return (
        <Tag
          className={`dm-h dm-h${level}${onHeadingClick ? " is-clickable" : ""}`}
          data-heading-level={level}
          data-heading-title={title}
          onClick={
            onHeadingClick ? () => onHeadingClick(title, level) : undefined
          }
          title={onHeadingClick ? "点击定位到源码" : undefined}
        >
          {children}
        </Tag>
      );
    };

  return {
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),
    p: ({ children }) => (
      <p className="dm-p">{linkPaths ? <PathAware>{children}</PathAware> : children}</p>
    ),
    a: ({ href, children }) => (
      <a
        className="dm-link"
        href={href}
        target="_blank"
        rel="noreferrer noopener"
      >
        {children}
      </a>
    ),
    strong: ({ children }) => <strong>{children}</strong>,
    em: ({ children }) => <em>{children}</em>,
    del: ({ children }) => <del className="dm-del">{children}</del>,
    hr: () => <hr className="dm-hr" />,
    blockquote: ({ children }) => (
      <blockquote className="dm-quote">{children}</blockquote>
    ),
    ul: ({ children, className }) => {
      const isTask =
        typeof className === "string" &&
        className.includes("contains-task-list");
      return (
        <ul className={`dm-list${isTask ? " dm-task-list" : ""}`}>{children}</ul>
      );
    },
    ol: ({ children }) => <ol className="dm-list">{children}</ol>,
    li: ({ children, className }) => {
      const isTask =
        typeof className === "string" && className.includes("task-list-item");
      if (!isTask) {
        return <li>{children}</li>;
      }
      // remark-gfm puts checked state on <input>, not always on li class
      const kids = React.Children.toArray(children);
      const checked = kids.some((ch) => {
        if (!React.isValidElement(ch)) return false;
        const p = ch.props as { type?: string; checked?: boolean };
        return p.type === "checkbox" && Boolean(p.checked);
      });
      return (
        <li
          className={`dm-task task-list-item${checked ? " is-checked" : ""}`}
        >
          {children}
        </li>
      );
    },
    input: ({ type, checked }) => {
      if (type !== "checkbox") {
        return <input type={type} checked={checked} readOnly />;
      }
      return (
        <input
          type="checkbox"
          className="dm-task-check"
          checked={Boolean(checked)}
          readOnly={!onTaskToggle}
          disabled={!onTaskToggle}
          onChange={
            onTaskToggle
              ? (e) => {
                  onTaskToggle("", e.target.checked);
                }
              : undefined
          }
          onClick={(e) => e.stopPropagation()}
          aria-label="任务项"
        />
      );
    },
    table: ({ children }) => <table className="dm-table">{children}</table>,
    thead: ({ children }) => <thead>{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr>{children}</tr>,
    th: ({ children }) => <th>{children}</th>,
    td: ({ children }) => <td>{children}</td>,
    pre: ({ children }) => <pre className="dm-pre">{children}</pre>,
    code: ({ className, children }) => {
      // Fenced blocks: parent is <pre>, className has language-*
      const isBlock = Boolean(className && /language-/.test(className));
      if (isBlock || (typeof children === "string" && children.includes("\n"))) {
        return (
          <code className={`dm-code-block ${className || ""}`.trim()}>
            {children}
          </code>
        );
      }
      // Also treat multi-line without language as block code (inside pre)
      if (className) {
        return (
          <code className={`dm-code-block ${className}`.trim()}>{children}</code>
        );
      }
      if (
        linkPaths &&
        typeof children === "string" &&
        looksLikeLocalPath(children)
      ) {
        return (
          <button
            type="button"
            className="dm-code dm-path"
            onClick={() => void openLocalPath(children.trim())}
          >
            {children}
          </button>
        );
      }
      return <code className="dm-code">{children}</code>;
    },
  };
}

const DEFAULT_MD_COMPONENTS = buildComponents(undefined, undefined, false);
/** Stable plugin list — a fresh array per render is a needless prop change. */
const REMARK_PLUGINS = [remarkGfm];

/** One top-level block; memo'd so unchanged blocks skip parse + reconcile. */
const MdBlock = React.memo(function MdBlock({
  text,
  components,
}: {
  text: string;
  components: Components;
}) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
      {text}
    </ReactMarkdown>
  );
});

export const DraftMarkdown = React.memo(function DraftMarkdown({
  source,
  className = "",
  onHeadingClick,
  onTaskToggle,
  linkPaths = false,
  streaming = false,
}: DraftMarkdownProps) {
  // 分块是「粘住」的：流式期间用过就一直用，结束时不再整段重解析。
  const chunked = useRef(false);
  if (streaming) chunked.current = true;

  const raw = source ?? "";
  // Keep the renderer object stable while the source grows. MdBlock compares
  // this prop by reference; rebuilding it here would make every unchanged
  // markdown block parse again on each streaming frame.
  const components = useMemo(
    () =>
      onHeadingClick || onTaskToggle || linkPaths
        ? buildComponents(onHeadingClick, onTaskToggle, linkPaths)
        : DEFAULT_MD_COMPONENTS,
    [onHeadingClick, onTaskToggle, linkPaths],
  );

  if (!raw.trim()) {
    return <div className={`draft-md ${className}`.trim()} />;
  }
  // 列表项间空行 → 松散 <p> 叠 margin，视觉「隔行」；压成紧凑列表
  const text = tightenMarkdownListBlankLines(raw);

  const blocks = chunked.current ? splitMarkdownBlocks(text) : null;
  if (blocks) {
    // react-markdown 在顶层块之间输出 "\n" 文本节点；这里逐块补回同样的节点。
    return (
      <div
        className={`draft-md ${className}`.trim()}
        data-md-engine="react-markdown"
      >
        {blocks.map((block, i) => (
          <React.Fragment key={i}>
            {i > 0 ? "\n" : null}
            <MdBlock text={block} components={components} />
          </React.Fragment>
        ))}
      </div>
    );
  }

  return (
    <div
      className={`draft-md ${className}`.trim()}
      data-md-engine="react-markdown"
    >
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
