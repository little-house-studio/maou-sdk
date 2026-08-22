/**
 * lsp-engine 公共类型 + 错误
 * 引擎边界用 0-based 位置（LSP 原生）；工具层收 1-based 后转换。
 */

export type DiagSeverity = "error" | "warning" | "info" | "hint";

export interface Diag {
  severity: DiagSeverity;
  message: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  code?: string | number;
  source?: string;
}

export interface FileDiags {
  file: string;
  diagnostics: Diag[];
  /** 收敛状态。settled:false 时 diagnostics 可能不完整，不可据此宣称"无错误"。 */
  settle?: SettleInfo;
}

export interface Loc {
  file: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
}

export interface HoverInfo {
  contents: string;
  range?: Loc;
}

export interface CompletionItemLite {
  label: string;
  kind?: string;
  detail?: string;
  insertText?: string;
}

export interface SymbolLite {
  name: string;
  kind: string;
  file: string;
  line: number;
  character: number;
  containerName?: string;
}

export interface RenameEdit {
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  newText: string;
}

export interface RenamePreview {
  changes: Array<{ file: string; edits: RenameEdit[] }>;
  totalFiles: number;
  totalEdits: number;
}

/** 诊断收敛信息——保证不谎报"无错误" */
export interface SettleInfo {
  settled: boolean;
  reason: "progress-end" | "quiet-timeout" | "hard-timeout";
  waitedMs: number;
}

export interface WorkspaceDiagsResult {
  files: FileDiags[];
  errorCount: number;
  warningCount: number;
  settle: SettleInfo;
}

// ─── 错误 ────────────────────────────────────────────────────────────────

export class ServerNotInstalledError extends Error {
  constructor(public languageId: string, public command: string, public hint: string) {
    super(`语言服务器未安装（${languageId}）。${hint}`);
    this.name = "ServerNotInstalledError";
  }
}

export class NoServerForFileError extends Error {
  constructor(public file: string) {
    super(`没有为该文件类型配置语言服务器: ${file}`);
    this.name = "NoServerForFileError";
  }
}

export class ServerCrashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerCrashError";
  }
}
