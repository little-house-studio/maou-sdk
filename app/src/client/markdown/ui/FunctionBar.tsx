/** 顶部功能栏 */

export type FunctionBarProps = {
  filePath: string | null;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onRefresh: () => void;
  onNew: () => void;
  /** 对齐：把变更发给主 agent */
  onAlign: () => void;
  alignDisabled?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
};

export function FunctionBar({
  filePath,
  dirty,
  busy,
  onSave,
  onRefresh,
  onNew,
  onAlign,
  alignDisabled,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: FunctionBarProps) {
  return (
    <div className="md-func-bar">
      <span className="md-func-title">
        Markdown
        {filePath ? (
          <span className="term-active-label">
            {" "}
            · {filePath}
            {dirty ? " · 未保存" : ""}
          </span>
        ) : null}
      </span>
      <div className="md-func-actions">
        <button
          type="button"
          className="md-btn"
          disabled={!canUndo || busy}
          onClick={onUndo}
          title="撤回 ⌘/Ctrl+Z"
        >
          撤回
        </button>
        <button
          type="button"
          className="md-btn"
          disabled={!canRedo || busy}
          onClick={onRedo}
          title="重做 ⌘/Ctrl+Shift+Z"
        >
          重做
        </button>
        <button
          type="button"
          className="md-btn primary"
          disabled={alignDisabled || busy}
          onClick={onAlign}
          title="将变更与批注作为指令发给主 Agent，要求对齐文档"
        >
          对齐
        </button>
        <button type="button" className="md-btn" onClick={onRefresh}>
          刷新
        </button>
        <button type="button" className="md-btn" onClick={onNew}>
          新建
        </button>
        <button
          type="button"
          className="md-btn"
          disabled={!filePath || !dirty || busy}
          onClick={onSave}
        >
          保存
        </button>
      </div>
    </div>
  );
}
