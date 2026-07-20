/**
 * Markdown 大模块 · 公共入口
 *
 *   import { MarkdownWorkbench } from "./markdown";
 *   import "./markdown/styles.css";
 */

export {
  MarkdownWorkbench,
  EditorPanel,
  type MarkdownWorkbenchProps,
} from "./MarkdownWorkbench";

export {
  fetchMdTree,
  readFsFile,
  writeFsFile,
  createFsFile,
  type FsTreeNode,
} from "./api";

export { FileTree, type FileTreeProps } from "./file-tree/FileTree";
export { SourceEditor, type SourceEditorProps } from "./editor/SourceEditor";
export { DocumentCanvas } from "./canvas/DocumentCanvas";
export { TitleTree } from "./title-tree/TitleTree";
export { CopilotPanel } from "./copilot/CopilotPanel";

export {
  parseMarkdownDocument,
  parseBlocksInRange,
  diffLines,
  type MdBlock,
  type MdSection,
  type MdDocument,
  type DiffLine,
} from "./parser";

export {
  formatAnnotationMessage,
  type AnnotationGroup,
  type AnnotateHit,
} from "./annotate/types";

// 旧需求大纲（仍可用，逐步收敛到 canvas）
export {
  DocOutlineView,
  type DocOutlineViewProps,
  parseDocTree,
} from "./doc-outline";
