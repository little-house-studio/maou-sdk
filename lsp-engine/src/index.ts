/**
 * @little-house-studio/lsp-engine — headless LSP 客户端引擎
 *
 * 公共 API：自由函数 + 类型化结构体。位置 0-based（LSP 原生）。
 * 诊断（是否无错）、语义跳转/引用、类型/悬停、重命名/补全，多语言可扩展。
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
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
  const seed = pickWorkspaceSeedFile(dir, opts?.globs);
  if (!seed) {
    return {
      files: [],
      errorCount: 0,
      warningCount: 0,
      settle: { settled: true, reason: "quiet-timeout", waitedMs: 0 },
    };
  }

  // 用 seed 的语言扩展扫全工程，避免混进 markdown 服务器
  const seedExt = extname(seed).toLowerCase();
  const sameFamily = familyExts(seedExt);
  const files = enumerateFiles(dir, sameFamily, opts?.maxFiles ?? 1000);
  if (files.length === 0) {
    return {
      files: [],
      errorCount: 0,
      warningCount: 0,
      settle: { settled: true, reason: "quiet-timeout", waitedMs: 0 },
    };
  }

  const server = await getServerForFile(seed);
  const started = Date.now();
  // 批量 didOpen 触发分析
  for (const f of files) {
    try {
      await server.syncDoc(f);
    } catch {
      /* 跳过无法读取的文件 */
    }
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
  // 用项目主源码语言服务器，避免 README.md / .maou 把 seed 绑到 marksman/json
  const seed = pickWorkspaceSeedFile(root);
  if (!seed) return [];
  try {
    const server = await getServerForFile(seed);
    // 先同步 seed，帮助 tsserver 绑定到含 tsconfig 的工程
    try { await server.syncDoc(seed); } catch { /* ignore */ }
    const r = await server.connection().sendRequest(WorkspaceSymbolRequest.type, { query });
    return toSymbols(r as never, "");
  } catch (e) {
    // tsserver "No Project" 等：返回空而非抛死
    return [];
  }
}

/** 与 seed 扩展同族的扩展列表（TS 服务器同时管 .ts/.tsx/.js…） */
function familyExts(ext: string): string[] {
  const e = ext.toLowerCase();
  if ([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].includes(e)) {
    return [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
  }
  if ([".py", ".pyi"].includes(e)) return [".py", ".pyi"];
  if ([".c", ".h", ".cpp", ".hpp", ".cc", ".cxx"].includes(e)) {
    return [".c", ".h", ".cpp", ".hpp", ".cc", ".cxx"];
  }
  return [e];
}

// ─── 内部 ────────────────────────────────────────────────────────────────

/** 全工程操作时优先的源码扩展名（避免先踩到 markdown 文件 → marksman） */
const PREFERRED_SOURCE_EXTS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".py",
  ".pyi",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".rb",
  ".php",
  ".swift",
];

const DOC_EXTS = new Set([".md", ".markdown", ".txt", ".rst", ".adoc"]);

function serverExtensions(dir: string, globs?: string[]): string[] {
  if (globs && globs.length > 0) {
    return globs.map((g) => extname(g)).filter(Boolean);
  }
  // 按优先扩展探测是否存在（不要依赖「前 80 个文件」——会先踩 .maou md/json）
  const exts: string[] = [];
  for (const ext of PREFERRED_SOURCE_EXTS) {
    const hit = enumerateFiles(dir, [ext], 1);
    if (hit.length > 0) exts.push(ext);
  }
  if (exts.length > 0) return exts;
  const sample = enumerateFiles(dir, null, 80);
  const set = new Set<string>();
  for (const f of sample) {
    const e = extname(f).toLowerCase();
    if (DOC_EXTS.has(e) || e === ".json" || e === ".jsonc") continue;
    if (resolveSpec(f)) set.add(e);
  }
  return [...set];
}

/**
 * 为「无 file」的全工程操作挑选代表性源文件，用于绑定语言服务器。
 * 不能先枚举前 N 个文件（会先踩到 .maou 下的 md/json → 只发现 markdown/json）。
 * 策略：按优先扩展名分别扫，找到第一个有 server 的源文件即返回。
 */
function pickWorkspaceSeedFile(dir: string, globs?: string[]): string | null {
  if (globs && globs.length > 0) {
    const exts = globs.map((g) => extname(g)).filter(Boolean);
    const files = enumerateFiles(dir, exts.length ? exts : null, 1);
    return files[0] ?? null;
  }
  // 优先：靠近 tsconfig/package.json 的 TS/JS 源文件（monorepo 根常见无 tsconfig）
  const tsFamily = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
  const tsHits = enumerateFiles(dir, tsFamily, 30);
  if (tsHits.length > 0) {
    const ranked = [...tsHits].sort((a, b) => scoreTsSeed(dir, b) - scoreTsSeed(dir, a));
    for (const f of ranked) {
      if (resolveSpec(f)) return f;
    }
  }
  for (const ext of PREFERRED_SOURCE_EXTS) {
    const files = enumerateFiles(dir, [ext], 1);
    if (files.length > 0 && resolveSpec(files[0]!)) return files[0]!;
  }
  const sample = enumerateFiles(dir, null, 100);
  for (const f of sample) {
    const ext = extname(f).toLowerCase();
    if (DOC_EXTS.has(ext) || ext === ".json" || ext === ".jsonc") continue;
    if (resolveSpec(f)) return f;
  }
  for (const f of sample) {
    if (resolveSpec(f)) return f;
  }
  return null;
}

/** 越高越优先：祖先目录有 tsconfig/jsconfig/package.json */
function scoreTsSeed(root: string, file: string): number {
  let score = 0;
  let d = dirname(file);
  const rootN = root.replace(/\\/g, "/");
  for (let i = 0; i < 8; i++) {
    const dn = d.replace(/\\/g, "/");
    if (existsSync(join(d, "tsconfig.json"))) score += 50 - i;
    if (existsSync(join(d, "jsconfig.json"))) score += 40 - i;
    if (existsSync(join(d, "package.json"))) score += 20 - i;
    if (dn === rootN || dn.length <= rootN.length) break;
    const parent = dirname(d);
    if (parent === d) break;
    d = parent;
  }
  score -= file.split("/").length * 0.01;
  return score;
}

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".sqry",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  "coverage",
  ".next",
  "out",
  ".turbo",
  ".cache",
  ".maou", // runtime / PREVIEW.md / sessions — 绝不能当语言 seed
  "vendor",
  "Pods",
]);

function enumerateFiles(dir: string, exts: string[] | null, max: number): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (out.length >= max) return;
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    entries.sort();
    for (const e of entries) {
      if (out.length >= max) return;
      if (SKIP_DIRS.has(e)) continue;
      const full = join(d, e);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
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
