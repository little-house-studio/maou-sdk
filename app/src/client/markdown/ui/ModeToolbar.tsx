/** 底部悬浮 · 模式切换 */

export type EditorMode = "browse" | "annotate" | "source";

export type ModeToolbarProps = {
  mode: EditorMode;
  onChange: (m: EditorMode) => void;
  annotateCount?: number;
};

export function ModeToolbar({ mode, onChange, annotateCount }: ModeToolbarProps) {
  return (
    <div className="md-mode-dock">
      <button
        type="button"
        className={mode === "browse" ? "active" : ""}
        onClick={() => onChange("browse")}
      >
        浏览
      </button>
      <button
        type="button"
        className={mode === "annotate" ? "active" : ""}
        onClick={() => onChange("annotate")}
      >
        批注多选
        {annotateCount ? ` · ${annotateCount}` : ""}
      </button>
      <button
        type="button"
        className={mode === "source" ? "active" : ""}
        onClick={() => onChange("source")}
      >
        源码
      </button>
    </div>
  );
}
