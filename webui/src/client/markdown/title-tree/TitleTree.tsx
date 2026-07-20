import { useState } from "react";
import type { MdSection } from "../parser";

export type TitleTreeProps = {
  sections: MdSection[];
  activeId: string | null;
  onSelect: (id: string) => void;
};

function Node({
  sec,
  activeId,
  depth,
  onSelect,
}: {
  sec: MdSection;
  activeId: string | null;
  depth: number;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(depth < 3);
  const has = sec.children.length > 0;
  const active = sec.id === activeId;

  return (
    <div>
      <div
        className={"md-title-row" + (active ? " active" : "")}
        style={{ paddingLeft: 6 + depth * 10 }}
      >
        {has ? (
          <button
            type="button"
            className="md-title-caret"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="md-title-caret spacer" />
        )}
        <button
          type="button"
          className="md-title-label"
          onClick={() => onSelect(sec.id)}
          title={sec.title}
        >
          <span className="md-title-lv">H{sec.level}</span>
          <span className="md-title-text">{sec.title}</span>
        </button>
      </div>
      {open &&
        has &&
        sec.children.map((c) => (
          <Node
            key={c.id}
            sec={c}
            activeId={activeId}
            depth={depth + 1}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

/** 标题树：点击后画布仅显示该层级内容 */
export function TitleTree({ sections, activeId, onSelect }: TitleTreeProps) {
  return (
    <aside className="md-title-tree">
      <div className="md-side-head">标题</div>
      <div className="md-title-scroll">
        <button
          type="button"
          className={"md-title-row root" + (activeId === "sec-root" ? " active" : "")}
          onClick={() => onSelect("sec-root")}
        >
          <span className="md-title-lv">DOC</span>
          <span className="md-title-text">全文</span>
        </button>
        {sections.map((s) => (
          <Node
            key={s.id}
            sec={s}
            activeId={activeId}
            depth={0}
            onSelect={onSelect}
          />
        ))}
      </div>
    </aside>
  );
}
