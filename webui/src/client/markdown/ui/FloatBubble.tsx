import { QUICK_NOTES } from "../annotate/types";

export type FloatBubbleProps = {
  x: number;
  y: number;
  /** above = 卡片顶边正上方；below = 卡片底边下方（顶部空间不足时） */
  place?: "above" | "below";
  visible: boolean;
  mode: "browse" | "annotate";
  note: string;
  onNoteChange: (v: string) => void;
  onQuick: (tag: string) => void;
  onConfirmAnnotate: () => void;
  onAlignSelection: () => void;
  onClose: () => void;
};

export function FloatBubble({
  x,
  y,
  place = "above",
  visible,
  mode,
  note,
  onNoteChange,
  onQuick,
  onConfirmAnnotate,
  onAlignSelection,
  onClose,
}: FloatBubbleProps) {
  if (!visible) return null;
  return (
    <div
      className={"md-float-bubble" + (place === "below" ? " place-below" : " place-above")}
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="md-float-actions">
        {mode === "annotate" ? (
          <button
            type="button"
            className="md-btn primary md-btn-sm"
            onClick={onConfirmAnnotate}
          >
            批注
          </button>
        ) : null}
        <button
          type="button"
          className="md-btn md-btn-sm"
          onClick={onAlignSelection}
        >
          对齐
        </button>
        <button
          type="button"
          className="md-btn ghost md-btn-sm"
          onClick={onClose}
          title="关闭"
        >
          ×
        </button>
      </div>
      <div className="md-float-quick">
        {QUICK_NOTES.map((q) => (
          <button
            key={q}
            type="button"
            className="md-chip"
            onClick={() => onQuick(q)}
          >
            {q}
          </button>
        ))}
      </div>
      <input
        className="md-float-input"
        placeholder="备注…"
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirmAnnotate();
        }}
      />
    </div>
  );
}
