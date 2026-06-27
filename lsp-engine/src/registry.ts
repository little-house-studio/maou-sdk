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
    rootMarkers: ["go.mod", "go.work"],
    installHint: "请运行: go install golang.org/x/tools/gopls@latest",
  },

  // ── 系统 / 编译型 ──
  {
    languageId: "c",
    command: "clangd",
    args: ["--background-index"],
    extensions: [".c", ".h"],
    rootMarkers: ["compile_commands.json", ".clangd", "CMakeLists.txt", "Makefile"],
    installHint: "请安装 clangd（macOS: brew install llvm / Debian: apt install clangd）",
  },
  {
    languageId: "cpp",
    command: "clangd",
    args: ["--background-index"],
    extensions: [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".ipp", ".m", ".mm"],
    rootMarkers: ["compile_commands.json", ".clangd", "CMakeLists.txt", "Makefile"],
    installHint: "请安装 clangd（macOS: brew install llvm / Debian: apt install clangd）",
  },
  {
    languageId: "zig",
    command: "zls",
    args: [],
    extensions: [".zig"],
    rootMarkers: ["build.zig"],
    installHint: "请安装 zls（https://github.com/zigtools/zls）",
  },

  // ── JVM ──
  {
    languageId: "java",
    command: "jdtls",
    args: [],
    extensions: [".java"],
    rootMarkers: ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", ".project"],
    installHint: "请安装 eclipse.jdt.ls（jdtls 启动脚本需在 PATH）",
  },
  {
    languageId: "kotlin",
    command: "kotlin-language-server",
    args: [],
    extensions: [".kt", ".kts"],
    rootMarkers: ["build.gradle.kts", "settings.gradle", "settings.gradle.kts", "pom.xml"],
    installHint: "请安装 kotlin-language-server（https://github.com/fwcd/kotlin-language-server）",
  },
  {
    languageId: "scala",
    command: "metals",
    args: [],
    extensions: [".scala", ".sbt", ".sc"],
    rootMarkers: ["build.sbt", "build.sc", ".bloop", ".metals"],
    installHint: "请运行: coursier install metals",
  },

  // ── .NET ──
  {
    languageId: "csharp",
    command: "csharp-ls",
    args: [],
    extensions: [".cs"],
    rootMarkers: ["*.sln", "*.csproj", ".git"],
    installHint: "请运行: dotnet tool install --global csharp-ls",
  },

  // ── 动态 / 脚本 ──
  {
    languageId: "php",
    command: "intelephense",
    args: ["--stdio"],
    extensions: [".php", ".phtml"],
    rootMarkers: ["composer.json", ".git"],
    installHint: "请运行: npm i -g intelephense",
  },
  {
    languageId: "ruby",
    command: "ruby-lsp",
    args: [],
    extensions: [".rb", ".rake", ".gemspec", ".ru"],
    rootMarkers: ["Gemfile", ".ruby-lsp", ".git"],
    installHint: "请运行: gem install ruby-lsp（或 solargraph）",
  },
  {
    languageId: "lua",
    command: "lua-language-server",
    args: [],
    extensions: [".lua"],
    rootMarkers: [".luarc.json", ".luarc.jsonc", ".git"],
    installHint: "请安装 lua-language-server（macOS: brew install lua-language-server）",
  },
  {
    languageId: "bash",
    command: "bash-language-server",
    args: ["start"],
    extensions: [".sh", ".bash", ".zsh", ".ksh"],
    rootMarkers: [".git"],
    installHint: "请运行: npm i -g bash-language-server",
  },
  {
    languageId: "dart",
    command: "dart",
    args: ["language-server", "--protocol=lsp"],
    extensions: [".dart"],
    rootMarkers: ["pubspec.yaml"],
    installHint: "随 Dart/Flutter SDK 提供（dart language-server）",
  },

  // ── Apple ──
  {
    languageId: "swift",
    command: "sourcekit-lsp",
    args: [],
    extensions: [".swift"],
    rootMarkers: ["Package.swift", ".git"],
    installHint: "随 Xcode / Swift 工具链提供（sourcekit-lsp）",
  },

  // ── 函数式 ──
  {
    languageId: "haskell",
    command: "haskell-language-server-wrapper",
    args: ["--lsp"],
    extensions: [".hs", ".lhs"],
    rootMarkers: ["stack.yaml", "cabal.project", "hie.yaml", ".git"],
    installHint: "请安装 haskell-language-server（ghcup install hls）",
  },
  {
    languageId: "elixir",
    command: "elixir-ls",
    args: [],
    extensions: [".ex", ".exs"],
    rootMarkers: ["mix.exs", ".git"],
    installHint: "请安装 elixir-ls（https://github.com/elixir-lsp/elixir-ls）",
  },
  {
    languageId: "ocaml",
    command: "ocamllsp",
    args: [],
    extensions: [".ml", ".mli"],
    rootMarkers: ["dune-project", ".git"],
    installHint: "请运行: opam install ocaml-lsp-server",
  },

  // ── 标记 / 配置 / 数据 ──
  {
    languageId: "html",
    command: "vscode-html-language-server",
    args: ["--stdio"],
    extensions: [".html", ".htm", ".xhtml"],
    rootMarkers: ["package.json", ".git"],
    installHint: "请运行: npm i -g vscode-langservers-extracted",
  },
  {
    languageId: "css",
    command: "vscode-css-language-server",
    args: ["--stdio"],
    extensions: [".css", ".scss", ".less"],
    rootMarkers: ["package.json", ".git"],
    installHint: "请运行: npm i -g vscode-langservers-extracted",
  },
  {
    languageId: "json",
    command: "vscode-json-language-server",
    args: ["--stdio"],
    extensions: [".json", ".jsonc"],
    rootMarkers: ["package.json", ".git"],
    installHint: "请运行: npm i -g vscode-langservers-extracted",
  },
  {
    languageId: "yaml",
    command: "yaml-language-server",
    args: ["--stdio"],
    extensions: [".yaml", ".yml"],
    rootMarkers: [".git"],
    installHint: "请运行: npm i -g yaml-language-server",
  },
  {
    languageId: "toml",
    command: "taplo",
    args: ["lsp", "stdio"],
    extensions: [".toml"],
    rootMarkers: [".git"],
    installHint: "请运行: cargo install taplo-cli --features lsp",
  },
  {
    languageId: "terraform",
    command: "terraform-ls",
    args: ["serve"],
    extensions: [".tf", ".tfvars"],
    rootMarkers: [".terraform", ".git"],
    installHint: "请安装 terraform-ls（brew install hashicorp/tap/terraform-ls）",
  },
  {
    languageId: "markdown",
    command: "marksman",
    args: ["server"],
    extensions: [".md", ".markdown"],
    rootMarkers: [".marksman.toml", ".git"],
    installHint: "请安装 marksman（https://github.com/artempyanykh/marksman）",
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
