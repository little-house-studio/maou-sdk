/**
 * 语言服务器注册表 — 扩展名 → ServerSpec。
 * 内置 TS/JS/Python/Rust，用户配置可覆盖/扩展（加新语言 = 加一条 spec）。
 */

import { existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";

export interface ServerSpec {
  languageId: string;
  command: string;
  args: string[];
  extensions: string[];
  initializationOptions?: unknown;
  /** 哪些 $/progress 标题门控诊断（如 rust-analyzer 的 cargo check） */
  progressTokens?: { indexing?: RegExp; check?: RegExp };
  /** 工作区根标记文件 */
  rootMarkers?: string[];
  /** 缺失时的安装提示 */
  installHint?: string;
}

const BUILTIN: ServerSpec[] = [
  {
    languageId: "typescript",
    command: "typescript-language-server",
    args: ["--stdio"],
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
    installHint: "请运行: npm i -g typescript-language-server typescript",
  },
  {
    languageId: "javascript",
    command: "typescript-language-server",
    args: ["--stdio"],
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    rootMarkers: ["package.json", "jsconfig.json"],
    installHint: "请运行: npm i -g typescript-language-server typescript",
  },
  {
    languageId: "python",
    command: "pyright-langserver",
    args: ["--stdio"],
    extensions: [".py", ".pyi"],
    rootMarkers: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"],
    installHint: "请运行: npm i -g pyright （或 pip install pyright）",
  },
  {
    languageId: "rust",
    command: "rust-analyzer",
    args: [],
    extensions: [".rs"],
    rootMarkers: ["Cargo.toml"],
    progressTokens: { indexing: /indexing|cachePriming|roots scanned/i, check: /cargo check|flycheck|building|checking/i },
    installHint: "请运行: rustup component add rust-analyzer",
  },
  {
    languageId: "go",
    command: "gopls",
    args: [],
    extensions: [".go"],
    rootMarkers: ["go.mod"],
    installHint: "请运行: go install golang.org/x/tools/gopls@latest",
  },
];

let userSpecs: ServerSpec[] = [];

/** 注册/覆盖用户自定义 spec（按扩展名优先于内置） */
export function registerServers(specs: ServerSpec[]): void {
  userSpecs = specs;
}

/** 按文件扩展名解析 ServerSpec（用户配置优先） */
export function resolveSpec(file: string): ServerSpec | null {
  const ext = extname(file).toLowerCase();
  for (const spec of [...userSpecs, ...BUILTIN]) {
    if (spec.extensions.includes(ext)) return spec;
  }
  return null;
}

/** 向上查找工作区根（按 rootMarkers），找不到则返回文件所在目录 */
export function findWorkspaceRoot(file: string, spec: ServerSpec): string {
  const markers = spec.rootMarkers ?? [];
  let dir = dirname(file);
  let prev = "";
  while (dir !== prev) {
    for (const m of markers) {
      if (existsSync(join(dir, m))) return dir;
    }
    prev = dir;
    dir = dirname(dir);
  }
  return dirname(file);
}
