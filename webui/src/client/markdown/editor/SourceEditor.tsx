import React, { useEffect, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";

export type SourceEditorProps = {
  value: string;
  editable?: boolean;
  pendingJumpLine?: number | null;
  onChange: (value: string) => void;
  onJumpHandled?: () => void;
};

/**
 * Markdown 源码编辑器（CodeMirror）
 * 后续可扩展：diff、协同、插件栏等
 */
export function SourceEditor({
  value,
  editable = true,
  pendingJumpLine,
  onChange,
  onJumpHandled,
}: SourceEditorProps) {
  const viewRef = useRef<EditorView | null>(null);

  const jumpToLine = (line: number) => {
    const view = viewRef.current;
    if (!view) return false;
    const doc = view.state.doc;
    const ln = Math.max(0, Math.min(line, doc.lines - 1));
    // CodeMirror lines are 1-based
    const row = doc.line(ln + 1);
    // Select full line so find/outline jumps are obvious
    view.dispatch({
      selection: { anchor: row.from, head: row.to },
      effects: EditorView.scrollIntoView(row.from, { y: "center" }),
    });
    view.focus();
    return true;
  };

  useEffect(() => {
    if (pendingJumpLine == null) return;
    const t = window.setTimeout(() => {
      if (jumpToLine(pendingJumpLine)) onJumpHandled?.();
    }, 40);
    return () => clearTimeout(t);
  }, [pendingJumpLine, value, onJumpHandled]);

  return (
    <div className="md-editor md-editor-full">
      <CodeMirror
        value={value}
        height="100%"
        theme="dark"
        extensions={[markdown(), EditorView.lineWrapping]}
        onChange={onChange}
        onCreateEditor={(view) => {
          viewRef.current = view;
          if (pendingJumpLine != null) {
            requestAnimationFrame(() => {
              if (jumpToLine(pendingJumpLine)) onJumpHandled?.();
            });
          }
        }}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          bracketMatching: true,
        }}
        editable={editable}
      />
    </div>
  );
}
