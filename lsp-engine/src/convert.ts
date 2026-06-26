/**
 * LSP ↔ 引擎结果的转换工具
 */

import { pathToFileURL, fileURLToPath } from "node:url";
import type {
  Diagnostic,
  Location,
  LocationLink,
  Hover,
  WorkspaceEdit,
  DocumentSymbol,
  SymbolInformation,
} from "vscode-languageserver-protocol";
import type { Diag, DiagSeverity, Loc, HoverInfo, SymbolLite, RenamePreview } from "./types.js";

export function pathToUri(p: string): string {
  return pathToFileURL(p).toString();
}

export function uriToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri.replace(/^file:\/\//, "");
  }
}

const SEVERITY: Record<number, DiagSeverity> = { 1: "error", 2: "warning", 3: "info", 4: "hint" };

export function toDiag(d: Diagnostic): Diag {
  const msg = d.message as unknown;
  return {
    severity: SEVERITY[d.severity ?? 1] ?? "error",
    message: typeof msg === "string" ? msg : (msg as { value: string }).value,
    line: d.range.start.line,
    character: d.range.start.character,
    endLine: d.range.end.line,
    endCharacter: d.range.end.character,
    code: typeof d.code === "object" ? undefined : d.code,
    source: d.source,
  };
}

export function toLoc(loc: Location | LocationLink): Loc {
  if ("targetUri" in loc) {
    return {
      file: uriToPath(loc.targetUri),
      line: loc.targetRange.start.line,
      character: loc.targetRange.start.character,
      endLine: loc.targetRange.end.line,
      endCharacter: loc.targetRange.end.character,
    };
  }
  return {
    file: uriToPath(loc.uri),
    line: loc.range.start.line,
    character: loc.range.start.character,
    endLine: loc.range.end.line,
    endCharacter: loc.range.end.character,
  };
}

export function toLocArray(result: Location | Location[] | LocationLink[] | null): Loc[] {
  if (!result) return [];
  const arr = Array.isArray(result) ? result : [result];
  return arr.map((l) => toLoc(l));
}

export function toHover(h: Hover | null): HoverInfo | null {
  if (!h || !h.contents) return null;
  let contents = "";
  const c = h.contents;
  if (typeof c === "string") {
    contents = c;
  } else if (Array.isArray(c)) {
    contents = c.map((x) => (typeof x === "string" ? x : x.value)).join("\n\n");
  } else if ("value" in c) {
    contents = c.value;
  }
  const range = h.range
    ? { file: "", line: h.range.start.line, character: h.range.start.character, endLine: h.range.end.line, endCharacter: h.range.end.character }
    : undefined;
  return { contents: contents.trim(), range };
}

export function toRenamePreview(edit: WorkspaceEdit | null): RenamePreview {
  const changes: RenamePreview["changes"] = [];
  let totalEdits = 0;

  if (edit?.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      const fileEdits = edits.map((e) => ({
        line: e.range.start.line,
        character: e.range.start.character,
        endLine: e.range.end.line,
        endCharacter: e.range.end.character,
        newText: e.newText,
      }));
      totalEdits += fileEdits.length;
      changes.push({ file: uriToPath(uri), edits: fileEdits });
    }
  }
  if (edit?.documentChanges) {
    for (const dc of edit.documentChanges) {
      if ("textDocument" in dc && "edits" in dc) {
        const fileEdits = dc.edits
          .filter((e): e is Extract<typeof e, { newText: string }> => "newText" in e)
          .map((e) => ({
            line: e.range.start.line,
            character: e.range.start.character,
            endLine: e.range.end.line,
            endCharacter: e.range.end.character,
            newText: e.newText,
          }));
        totalEdits += fileEdits.length;
        changes.push({ file: uriToPath(dc.textDocument.uri), edits: fileEdits });
      }
    }
  }

  return { changes, totalFiles: changes.length, totalEdits };
}

const SYMBOL_KIND: Record<number, string> = {
  1: "file", 2: "module", 3: "namespace", 4: "package", 5: "class", 6: "method",
  7: "property", 8: "field", 9: "constructor", 10: "enum", 11: "interface",
  12: "function", 13: "variable", 14: "constant", 15: "string", 16: "number",
  17: "boolean", 18: "array", 19: "object", 20: "key", 21: "null",
  22: "enum-member", 23: "struct", 24: "event", 25: "operator", 26: "type-parameter",
};

export function toSymbols(result: DocumentSymbol[] | SymbolInformation[] | null, fallbackFile: string): SymbolLite[] {
  if (!result) return [];
  const out: SymbolLite[] = [];
  const walk = (sym: DocumentSymbol, container?: string) => {
    const range = sym.selectionRange ?? sym.range;
    out.push({
      name: sym.name,
      kind: SYMBOL_KIND[sym.kind] ?? String(sym.kind),
      file: fallbackFile,
      line: range.start.line,
      character: range.start.character,
      containerName: container,
    });
    if (sym.children) for (const child of sym.children) walk(child, sym.name);
  };
  for (const s of result) {
    if ("location" in s) {
      out.push({
        name: s.name,
        kind: SYMBOL_KIND[s.kind] ?? String(s.kind),
        file: uriToPath(s.location.uri),
        line: s.location.range.start.line,
        character: s.location.range.start.character,
        containerName: s.containerName,
      });
    } else {
      walk(s as DocumentSymbol);
    }
  }
  return out;
}
