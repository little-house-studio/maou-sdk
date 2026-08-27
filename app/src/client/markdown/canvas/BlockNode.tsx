import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import type { MdBlock } from "../parser";

/** 卡片形态：整块列表 / 代码 / 表格（单项嵌在 list 内） */
export function isCardKind(kind: MdBlock["kind"]): boolean {
  return kind === "list" || kind === "code" || kind === "table";
}

/** 正文流：标题 / 段落 / 引用 — 可直接编辑，非卡片 */
export function isProseKind(kind: MdBlock["kind"]): boolean {
  return kind === "heading" || kind === "paragraph" || kind === "blockquote";
}

export type BlockNodeProps = {
  block: MdBlock;
  selected?: boolean;
  selectedIds?: Set<string>;
  annotColor?: string | null;
  annotColors?: Map<string, string>;
  mode: "browse" | "annotate";
  onSelect: (block: MdBlock, e: MouseEvent) => void;
  onContextMenu: (block: MdBlock, e: MouseEvent) => void;
  onToggleTask?: (block: MdBlock) => void;
  onTableChange?: (block: MdBlock, rows: string[][]) => void;
  /** 正文/标题/列表文字编辑回写 */
  onProseChange?: (block: MdBlock, plainText: string) => void;
};

function ProseEditable({
  text,
  className,
  multiline,
  onCommit,
}: {
  text: string;
  className?: string;
  multiline?: boolean;
  onCommit: (t: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const focused = useRef(false);

  useLayoutEffect(() => {
    if (focused.current || !ref.current) return;
    if (ref.current.innerText !== text) {
      ref.current.innerText = text;
    }
  }, [text]);

  return (
    <div
      ref={ref}
      className={className}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      data-multiline={multiline ? "1" : "0"}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={(e) => {
        focused.current = false;
        const next = e.currentTarget.innerText.replace(/\u00a0/g, " ");
        // 去掉 contentEditable 末尾常驻换行
        const normalized = multiline
          ? next.replace(/\n$/, "")
          : next.replace(/\n/g, " ").trimEnd();
        if (normalized !== text) onCommit(normalized);
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (!multiline && e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLElement).blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

export function BlockNode({
  block,
  selected,
  selectedIds,
  annotColor,
  annotColors,
  mode,
  onSelect,
  onContextMenu,
  onToggleTask,
  onTableChange,
  onProseChange,
}: BlockNodeProps) {
  const [collapsed, setCollapsed] = useState(block.kind === "code");
  const [openKids, setOpenKids] = useState(true);
  const hasKids = block.children.length > 0;
  const isSelected = selected || selectedIds?.has(block.id);
  const color = annotColor ?? annotColors?.get(block.id);
  const card = isCardKind(block.kind);
  const prose = isProseKind(block.kind);
  const listItem = block.kind === "list_item" || block.kind === "task";
  /** 列表容器内的项：不是独立卡片，只是行 */
  const inListRow = listItem;

  const cls = [
    "mdc-block",
    `kind-${block.kind}`,
    card ? "is-card" : inListRow ? "is-list-row" : "is-prose",
    isSelected && (card || mode === "annotate") ? "selected" : "",
    color ? "annotated" : "",
    block.kind === "heading" ? `h${block.headingLevel ?? 1}` : "",
    block.kind === "list" && block.listType
      ? `list-${block.listType}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const style: CSSProperties = {
    marginLeft:
      block.indent > 0 && inListRow ? block.indent * 14 : undefined,
    ...(color && (card || mode === "annotate" || inListRow)
      ? { boxShadow: `inset 3px 0 0 ${color}`, background: `${color}14` }
      : null),
  };

  const handleClick = (e: MouseEvent) => {
    // 浏览模式：正文不触发选中
    if (prose && mode !== "annotate") {
      return;
    }
    // 列表项点击：选中所属整块 list（冒泡由父处理）— 项本身也可批注
    if (card || mode === "annotate" || listItem) {
      onSelect(block, e);
    }
  };

  return (
    <div
      className={
        "mdc-block-wrap" +
        (card ? " wrap-card" : inListRow ? " wrap-list-row" : " wrap-prose")
      }
    >
      <div
        className={cls}
        style={style}
        data-block-id={block.id}
        data-card={card ? "1" : "0"}
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(block, e);
        }}
      >
        {block.kind === "list" ? (
          <button
            type="button"
            className="mdc-fold"
            onClick={(e) => {
              e.stopPropagation();
              setOpenKids((v) => !v);
            }}
            title={openKids ? "折叠列表" : "展开列表"}
          >
            {openKids ? "▾" : "▸"}
          </button>
        ) : null}
        {block.kind === "list" ? (
          <span className="mdc-list-label">
            {block.listType === "task"
              ? "任务"
              : block.listType === "ol"
                ? "有序"
                : "列表"}
          </span>
        ) : null}

        {block.kind === "list_item" || block.kind === "task" ? (
          <button
            type="button"
            className="mdc-fold"
            onClick={(e) => {
              e.stopPropagation();
              setOpenKids((v) => !v);
            }}
            title={openKids ? "折叠" : "展开"}
          >
            {hasKids ? (openKids ? "▾" : "▸") : "·"}
          </button>
        ) : block.kind === "code" ? (
          <button
            type="button"
            className="mdc-fold"
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed((v) => !v);
            }}
          >
            {collapsed ? "▸ 代码" : "▾ 代码"}
          </button>
        ) : null}

        {block.kind === "task" ? (
          <button
            type="button"
            className={"mdc-check" + (block.checked ? " on" : "")}
            onClick={(e) => {
              e.stopPropagation();
              onToggleTask?.(block);
            }}
          >
            {block.checked ? "✓" : ""}
          </button>
        ) : null}

        {block.kind === "list_item" && block.orderedIndex != null ? (
          <span className="mdc-ol-num">{block.orderedIndex}.</span>
        ) : null}

        {block.kind === "heading" ? (
          <ProseEditable
            className="mdc-heading-text mdc-prose-edit"
            text={block.text}
            onCommit={(t) => onProseChange?.(block, t)}
          />
        ) : block.kind === "code" ? (
          <div className="mdc-code-wrap">
            <span className="mdc-code-lang">{block.lang || "code"}</span>
            {!collapsed && (
              <pre className="mdc-code">
                <code
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const t = e.currentTarget.innerText.replace(/\n$/, "");
                    if (t !== (block.code || "")) onProseChange?.(block, t);
                  }}
                >
                  {block.code}
                </code>
              </pre>
            )}
            {collapsed && (
              <span className="mdc-code-preview">
                {(block.code || "").split("\n")[0]?.slice(0, 80)}
                {(block.code || "").includes("\n") ? " …" : ""}
              </span>
            )}
          </div>
        ) : block.kind === "blockquote" ? (
          <blockquote className="mdc-quote">
            <ProseEditable
              className="mdc-prose-edit"
              text={block.text}
              multiline
              onCommit={(t) => onProseChange?.(block, t)}
            />
          </blockquote>
        ) : block.kind === "table" && block.tableRows ? (
          <TableEditor
            rows={block.tableRows}
            onChange={(rows) => onTableChange?.(block, rows)}
            onContextMenu={(e) => onContextMenu(block, e)}
          />
        ) : block.kind === "hr" ? (
          <hr className="mdc-hr" />
        ) : block.kind === "list" ? (
          <span className="mdc-list-meta">
            {block.children.length} 项 · L{block.lineStart + 1}
          </span>
        ) : block.kind === "list_item" || block.kind === "task" ? (
          <ProseEditable
            className="mdc-text mdc-prose-edit mdc-card-text"
            text={block.text}
            onCommit={(t) => onProseChange?.(block, t)}
          />
        ) : (
          /* paragraph */
          <ProseEditable
            className="mdc-text mdc-prose-edit"
            text={block.text}
            multiline
            onCommit={(t) => onProseChange?.(block, t)}
          />
        )}
      </div>

      {hasKids && openKids && (
        <div
          className={
            "mdc-children" + (block.kind === "list" ? " mdc-list-body" : "")
          }
        >
          {block.children.map((c) => (
            <BlockNode
              key={c.id}
              block={c}
              selectedIds={selectedIds}
              annotColors={annotColors}
              mode={mode}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              onToggleTask={onToggleTask}
              onTableChange={onTableChange}
              onProseChange={onProseChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TableEditor({
  rows,
  onChange,
  onContextMenu,
}: {
  rows: string[][];
  onChange: (rows: string[][]) => void;
  onContextMenu: (e: MouseEvent) => void;
}) {
  const cols = Math.max(1, ...rows.map((r) => r.length));

  const setCell = (ri: number, ci: number, v: string) => {
    const next = rows.map((r) => [...r]);
    while (next[ri]!.length < cols) next[ri]!.push("");
    next[ri]![ci] = v;
    onChange(next);
  };

  const addRow = () => {
    onChange([...rows, Array.from({ length: cols }, () => "")]);
  };
  const addCol = () => {
    onChange(rows.map((r) => [...r, ""]));
  };
  const delRow = (ri: number) => {
    if (rows.length <= 1) return;
    onChange(rows.filter((_, i) => i !== ri));
  };
  const delCol = (ci: number) => {
    if (cols <= 1) return;
    onChange(rows.map((r) => r.filter((_, i) => i !== ci)));
  };

  return (
    <div className="mdc-table-wrap" onContextMenu={onContextMenu}>
      <table className="mdc-table">
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {Array.from({ length: cols }, (_, ci) => (
                <td key={ci}>
                  <input
                    className="mdc-table-input"
                    value={row[ci] ?? ""}
                    onChange={(e) => setCell(ri, ci, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
              ))}
              <td className="mdc-table-ops">
                <button
                  type="button"
                  className="linkish"
                  onClick={(e) => {
                    e.stopPropagation();
                    delRow(ri);
                  }}
                >
                  −行
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mdc-table-bar">
        <button type="button" className="linkish" onClick={addRow}>
          + 行
        </button>
        <button type="button" className="linkish" onClick={addCol}>
          + 列
        </button>
        {Array.from({ length: cols }, (_, ci) => (
          <button
            key={ci}
            type="button"
            className="linkish"
            onClick={() => delCol(ci)}
          >
            −列{ci + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
