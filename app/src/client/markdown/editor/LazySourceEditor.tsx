/**
 * Async SourceEditor boundary — CodeMirror must not enter chat first-paint graph.
 */
import React, { lazy, Suspense, type ReactElement } from "react";

export type LazySourceEditorProps = {
  value: string;
  editable?: boolean;
  pendingJumpLine?: number | null;
  onChange: (value: string) => void;
  onJumpHandled?: () => void;
};

const SourceEditorLazy = lazy(() =>
  import("./SourceEditor").then((m) => ({ default: m.SourceEditor })),
);

export function LazySourceEditor(props: LazySourceEditorProps): ReactElement {
  return (
    <Suspense
      fallback={
        <div
          className="md-editor-loading"
          data-source-editor-loading="true"
          aria-busy="true"
        >
          加载编辑器…
        </div>
      }
    >
      <SourceEditorLazy {...props} />
    </Suspense>
  );
}
