/**
 * @little-house-studio/lsp-engine — headless LSP 客户端引擎
 *
 * 公共 API：自由函数 + 类型化结构体。位置 0-based（LSP 原生）。
 * 诊断（是否无错）、语义跳转/引用、类型/悬停、重命名/补全，多语言可扩展。
 */

import { readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import {
  DefinitionRequest,
  TypeDefinitionRequest,
  ReferencesRequest,
  HoverRequest,
  RenameRequest,
  CompletionRequest,
  DocumentSymbolRequest,
  WorkspaceSymbolRequest,
  type CompletionList,
  type CompletionItem,
} from "vscode-languageserver-protocol";
import { getServerForFile, shutdownAll, cleanupWorkspace } from "./pool.js";
import { resolveSpec } from "./registry.js";
import { waitSettle, waitSettleFile } from "./diagnostics.js";
import {
  pathToUri,
  toDiag,
  toLocArray,
  toHover,
  toRenamePreview,
  toSymbols,
} from "./convert.js";
import type {
  Diag,
  FileDiags,
  Loc,
  HoverInfo,
  CompletionItemLite,
  SymbolLite,
  RenamePreview,
  WorkspaceDiagsResult,
} from "./types.js";

export { registerServers, listBuiltinLanguages } from "./registry.js";
export type { ServerSpec } from "./registry.js";
export { shutdownAll, cleanupWorkspace } from "./pool.js";
export type {
  Diag,
  FileDiags,
  Loc,
  HoverInfo,
  CompletionItemLite,
  SymbolLite,
  RenamePreview,
  SettleInfo,
  WorkspaceDiagsResult,
} from "./types.js";
export {
  ServerNotInstalledError,
  NoServerForFileError,
  ServerCrashError,
} from "./types.js";

/** 该文件类型是否有可用的语言服务器配置 */
export function isServerAvailable(file: string): boolean {
  return resolveSpec(file) !== null;
}

// ─── 诊断 ────────────────────────────────────────────────────────────────

/** 单文件诊断 */
export async function diagnostics(file: string, opts?: { settleMs?: number; hardTimeoutMs?: number }): Promise<FileDiags> {
  const server = await getServerForFile(file);
  const started = Date.now();
  const { uri, changed } = await server.syncDocEx(file);
  // gateOnCheck 跟随该语言是否配置了 check 令牌（如 rust-analyzer flycheck）
  const gateOnCheck = !!resolveSpec(file)?.progressTokens?.check;
  const settle = await waitSettleFile(server, uri, started, {
    quietMs: opts?.settleMs ?? 600,
    hardMs: opts?.hardTimeoutMs ?? 12000,
    gateOnCheck,
    expectFresh: changed,
  });
  const raw = server.diagnostics.get(uri) ?? [];
  return { file, diagnostics: raw.map(toDiag), settle };
}

/** 全工作区诊断 —— 是否无错。带 SettleInfo 如实呈现收敛状态。 */
export async function diagnosticsWorkspace(
  dir: string,
  opts?: { globs?: string[]; settleMs?: number; hardTimeoutMs?: number; maxFiles?: number },
): Promise<WorkspaceDiagsResult> {
  // 用第一个文件确定语言服务器
  const exts = serverExtensions(dir, opts?.globs);
  const files = enumerateFiles(dir, exts, opts?.maxFiles ?? 1000);
  if (files.length === 0) {
    return { files: [], errorCount: 0, warningCount: 0, settle: { settled: true, reason: "quiet-timeout", waitedMs: 0 } };
  }

  const server = await getServerForFile(files[0]);
  const started = Date.now();
  // 批量 didOpen 触发分析
  for (const f of files) {
    try { await server.syncDoc(f); } catch { /* 跳过无法读取的文件 */ }
  }

  const settle = await waitSettle(server, started, {
    quietMs: opts?.settleMs ?? 1500,
    hardMs: opts?.hardTimeoutMs ?? 30000,
    gateOnCheck: true,
  });

  // 聚合
  const result: FileDiags[] = [];
  let errorCount = 0;
  let warningCount = 0;
  for (const [uri, raw] of server.diagnostics) {
    if (raw.length === 0) continue;
    const diags = raw.map(toDiag);
    for (const d of diags) {
      if (d.severity === "error") errorCount++;
      else if (d.severity === "warning") warningCount++;
    }
    result.push({ file: uriToPathSafe(uri), diagnostics: diags });
  }

  return { files: result, errorCount, warningCount, settle };
}

// ─── 位置查询 ────────────────────────────────────────────────────────────

export async function definition(file: string, line: number, character: number): Promise<Loc[]> {
  const server = await getServerForFile(file);
  const uri = await server.syncDoc(file);
  const r = await server.connection().sendRequest(DefinitionRequest.type, { textDocument: { uri }, position: { line, character } });
  return toLocArray(r as never);
}

export async function typeDefinition(file: string, line: number, character: number): Promise<Loc[]> {
  const server = await getServerForFile(file);
  const uri = await server.syncDoc(file);
  const r = await server.connection().sendRequest(TypeDefinitionRequest.type, { textDocument: { uri }, position: { line, character } });
  return toLocArray(r as never);
}

export async function references(file: string, line: number, character: number, opts?: { includeDeclaration?: boolean }): Promise<Loc[]> {
  const server = await getServerForFile(file);
  const uri = await server.syncDoc(file);
  const r = await server.connection().sendRequest(ReferencesRequest.type, {
    textDocument: { uri }, position: { line, character },
    context: { includeDeclaration: opts?.includeDeclaration ?? true },
  });
  return toLocArray(r as never);
}

export async function hover(file: string, line: number, character: number): Promise<HoverInfo | null> {
  const server = await getServerForFile(file);
  const uri = await server.syncDoc(file);
  const r = await server.connection().sendRequest(HoverRequest.type, { textDocument: { uri }, position: { line, character } });
  return toHover(r as never);
}

/** rename —— 只返回预览，绝不写盘 */
export async function rename(file: string, line: number, character: number, newName: string): Promise<RenamePreview> {
  const server = await getServerForFile(file);
  const uri = await server.syncDoc(file);
  const r = await server.connection().sendRequest(RenameRequest.type, { textDocument: { uri }, position: { line, character }, newName });
  return toRenamePreview(r as never);
}

export async function completion(file: string, line: number, character: number, opts?: { limit?: number }): Promise<CompletionItemLite[]> {
  const server = await getServerForFile(file);
  const uri = await server.syncDoc(file);
  const r = await server.connection().sendRequest(CompletionRequest.type, { textDocument: { uri }, position: { line, character } });
  const items: CompletionItem[] = Array.isArray(r) ? r : ((r as CompletionList)?.items ?? []);
  const limit = opts?.limit ?? 50;
  return items.slice(0, limit).map((it) => ({
    label: it.label,
    kind: it.kind !== undefined ? String(it.kind) : undefined,
    detail: it.detail,
    insertText: it.insertText,
  }));
}

export async function documentSymbols(file: string): Promise<SymbolLite[]> {
  const server = await getServerForFile(file);
  const uri = await server.syncDoc(file);
  const r = await server.connection().sendRequest(DocumentSymbolRequest.type, { textDocument: { uri } });
  return toSymbols(r as never, file);
}

export async function workspaceSymbols(query: string, root: string): Promise<SymbolLite[]> {
  // 用 root 下任意源文件确定服务器
  const exts = serverExtensions(root);
  const files = enumerateFiles(root, exts, 1);
  if (files.length === 0) return [];
  const server = await getServerForFile(files[0]);
  const r = await server.connection().sendRequest(WorkspaceSymbolRequest.type, { query });
  return toSymbols(r as never, "");
}

// ─── 内部 ────────────────────────────────────────────────────────────────

function serverExtensions(dir: string, globs?: string[]): string[] {
  if (globs && globs.length > 0) {
    return globs.map((g) => extname(g)).filter(Boolean);
  }
  // 探测目录里第一个有 server 的扩展名集合
  const sample = enumerateFiles(dir, null, 50);
  const exts = new Set<string>();
  for (const f of sample) {
    if (resolveSpec(f)) exts.add(extname(f).toLowerCase());
  }
  return [...exts];
}

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".sqry", "target", "__pycache__", ".venv", "venv"]);

function enumerateFiles(dir: string, exts: string[] | null, max: number): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (out.length >= max) return;
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      if (out.length >= max) return;
      if (SKIP_DIRS.has(e)) continue;
      const full = join(d, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        walk(full);
      } else {
        const ext = extname(e).toLowerCase();
        if (exts === null ? resolveSpec(full) !== null : exts.includes(ext)) {
          out.push(full);
        }
      }
    }
  };
  walk(dir);
  return out;
}

function uriToPathSafe(uri: string): string {
  try {
    return new URL(uri).pathname;
  } catch {
    return uri;
  }
}
