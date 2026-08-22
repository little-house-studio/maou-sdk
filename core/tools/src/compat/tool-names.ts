/**
 * Pi / DSH 工具名 ↔ Maou 主名。
 * 主名不改（模型 schema 仍用 reader / write_file / …）；
 * 别名与 canonicalize 给执行解析和钩子拦截用。
 */

/** Pi 内置名 → Maou 主名 */
export const PI_TO_MAOU_TOOL: Readonly<Record<string, string>> = {
  read: "reader",
  write: "write_file",
  edit: "edit_file",
  bash: "use_terminal",
  find: "glob",
  ls: "glob",
  grep: "grep",
};

/** Maou 主名 → Pi 内置名（一对多时取最常用的那个） */
export const MAOU_TO_PI_TOOL: Readonly<Record<string, string>> = {
  reader: "read",
  write_file: "write",
  edit_file: "edit",
  use_terminal: "bash",
  glob: "find",
  grep: "grep",
};

const ALIAS_TO_CANONICAL: Record<string, string> = {
  ...PI_TO_MAOU_TOOL,
  reader: "reader",
  write_file: "write_file",
  edit_file: "edit_file",
  use_terminal: "use_terminal",
  glob: "glob",
  grep: "grep",
  "find-files": "glob",
  "ls-glob": "glob",
  "search-text": "grep",
  rg: "grep",
  terminal_manage: "use_terminal",
};

/** 任意别名 / Pi 名 / 主名 → Maou 主名；认不出则原样返回 */
export function toMaouToolName(name: string): string {
  const key = String(name ?? "").trim();
  if (!key) return key;
  return ALIAS_TO_CANONICAL[key] ?? ALIAS_TO_CANONICAL[key.toLowerCase()] ?? key;
}

/** Maou 主名 / 别名 → Pi 惯用名；认不出则原样返回 */
export function toPiToolName(name: string): string {
  const maou = toMaouToolName(name);
  return MAOU_TO_PI_TOOL[maou] ?? name;
}

export function isSameTool(a: string, b: string): boolean {
  return toMaouToolName(a) === toMaouToolName(b);
}
