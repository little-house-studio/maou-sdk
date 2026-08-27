/**
 * 画布：按当前标题节渲染块树
 */

import type { MdBlock, MdSection } from "../parser";
import { parseInlines } from "../parser";
import { BlockNode } from "./BlockNode";

export type DocumentCanvasProps = {
  /** 当前聚焦的节（level 0 = 整文档根包装） */
  section: MdSection;
  filePath: string;
  mode: "browse" | "annotate";
  selectedIds: Set<string>;
  /** blockId → color */
  annotColors: Map<string, string>;
  onSelectBlock: (block: MdBlock, e: React.MouseEvent) => void;
  onContextMenu: (block: MdBlock, e: React.MouseEvent) => void;
  onToggleTask?: (block: MdBlock) => void;
  onTableChange?: (block: MdBlock, rows: string[][]) => void;
  onProseChange?: (block: MdBlock, plainText: string) => void;
  onSelectSection?: (sectionId: string) => void;
};

function SectionChunk({
  sec,
  depth,
  ...rest
}: {
  sec: MdSection;
  depth: number;
} & Omit<DocumentCanvasProps, "section">) {
  const heading: MdBlock | null =
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
      : null;

  return (
    <div className="mdc-section" data-section-id={sec.id}>
      {heading ? (
        <BlockNode
          block={heading}
          selectedIds={rest.selectedIds}
          annotColors={rest.annotColors}
          mode={rest.mode}
          onSelect={(b, e) => {
            rest.onSelectBlock(b, e);
            rest.onSelectSection?.(sec.id);
          }}
          onContextMenu={rest.onContextMenu}
        />
      ) : null}
      {sec.blocks.map((b) => (
        <BlockNode
          key={b.id}
          block={b}
          selectedIds={rest.selectedIds}
          annotColors={rest.annotColors}
          mode={rest.mode}
          onSelect={rest.onSelectBlock}
          onContextMenu={rest.onContextMenu}
          onToggleTask={rest.onToggleTask}
          onTableChange={rest.onTableChange}
          onProseChange={rest.onProseChange}
        />
      ))}
      {sec.children.map((c) => (
        <SectionChunk key={c.id} sec={c} depth={depth + 1} {...rest} />
      ))}
    </div>
  );
}

export function DocumentCanvas(props: DocumentCanvasProps) {
  const { section } = props;
  return (
    <div className="mdc-canvas">
      <SectionChunk sec={section} depth={0} {...props} />
    </div>
  );
}
