import React, { useEffect, useMemo, useRef } from "react";
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
 * Wire 暖灰源码主题（对齐 draft-shell --n-*，避免默认 CM dark 冷蓝黑）
 */
function createWireEditorTheme() {
  return EditorView.theme(
    {
      "&": {
        backgroundColor: "#1a1817",
        color: "#c9c2b6",
        height: "100%",
      },
      ".cm-scroller": {
        fontFamily:
          'var(--font-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
        lineHeight: "1.55",
      },
      ".cm-content": {
        caretColor: "var(--n-accent, #0256FF)",
        padding: "8px 0",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--n-accent, #0256FF)",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        {
          backgroundColor: "color-mix(in srgb, var(--n-accent, #0256FF) 22%, transparent) !important",
        },
      ".cm-activeLine": {
        backgroundColor: "#211e1c",
      },
      ".cm-gutters": {
        backgroundColor: "#282522",
        color: "#8a8278",
        border: "none",
        borderRight: "1px solid #3d3834",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "#2f2b28",
        color: "#c9c2b6",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 8px 0 6px",
        minWidth: "2.4em",
      },
      ".cm-foldGutter .cm-gutterElement": {
        color: "#8a8278",
      },
      ".cm-matchingBracket, .cm-nonmatchingBracket": {
        backgroundColor: "color-mix(in srgb, var(--n-accent, #0256FF) 16%, transparent)",
        outline: "1px solid color-mix(in srgb, var(--n-accent, #0256FF) 45%, transparent)",
      },
      ".cm-tooltip": {
        backgroundColor: "#282522",
        color: "#f5f0e8",
        border: "1px solid #3d3834",
      },
    },
    { dark: true },
  );
}

/**
 * Markdown 源码编辑器（CodeMirror）—— 文本预览/源码与 wire 壳同色
 */
export function SourceEditor({
  value,
  editable = true,
  pendingJumpLine,
  onChange,
  onJumpHandled,
}: SourceEditorProps) {
  const viewRef = useRef<EditorView | null>(null);
  const wireTheme = useMemo(() => createWireEditorTheme(), []);

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
    <div className="md-editor md-editor-full md-editor--wire">
      <CodeMirror
        value={value}
        height="100%"
        theme={wireTheme}
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
