/**
 * 语言服务器注册表 — 扩展名 / 特殊文件名 → ServerSpec。
 * 内置覆盖常见语言；用户可用 registerServers 覆盖/扩展。
 *
 * 注意：有配置 ≠ 本机已安装。缺失 binary 时会抛 ServerNotInstalledError 并带 installHint。
 */

import { existsSync, readdirSync } from "node:fs";
import { join, dirname, extname, basename } from "node:path";

export interface ServerSpec {
  languageId: string;
  command: string;
  args: string[];
  /** 小写扩展名（含点），如 .ts */
  extensions: string[];
  /**
   * 无扩展名或固定文件名（如 Dockerfile / Makefile）。
   * 匹配时大小写不敏感。
   */
  fileNames?: string[];
  initializationOptions?: unknown;
  /** 哪些 $/progress 标题门控诊断（如 rust-analyzer 的 cargo check） */
  progressTokens?: { indexing?: RegExp; check?: RegExp };
  /** 工作区根标记文件 */
  rootMarkers?: string[];
  /** 缺失时的安装提示 */
  installHint?: string;
}

const BUILTIN: ServerSpec[] = [
  // ── Web / TS ──
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
    languageId: "vue",
    command: "vue-language-server",
    args: ["--stdio"],
    extensions: [".vue"],
    rootMarkers: ["package.json", "vite.config.ts", "vite.config.js", "nuxt.config.ts", "nuxt.config.js"],
    installHint: "请运行: npm i -g @vue/language-server（命令 vue-language-server）",
  },
  {
    languageId: "svelte",
    command: "svelteserver",
    args: ["--stdio"],
    extensions: [".svelte"],
    rootMarkers: ["package.json", "svelte.config.js", "svelte.config.ts"],
    installHint: "请运行: npm i -g svelte-language-server",
  },
  {
    languageId: "astro",
    command: "astro-ls",
    args: ["--stdio"],
    extensions: [".astro"],
    rootMarkers: ["package.json", "astro.config.mjs", "astro.config.ts"],
    installHint: "请运行: npm i -g @astrojs/language-server",
  },

  // ── 主流系统语言 ──
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
    progressTokens: {
      indexing: /indexing|cachePriming|roots scanned/i,
      check: /cargo check|flycheck|building|checking/i,
    },
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
    extensions: [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".ipp"],
    rootMarkers: ["compile_commands.json", ".clangd", "CMakeLists.txt", "Makefile"],
    installHint: "请安装 clangd（macOS: brew install llvm / Debian: apt install clangd）",
  },
  {
    languageId: "objective-c",
    command: "clangd",
    args: ["--background-index"],
    extensions: [".m", ".mm"],
    rootMarkers: ["compile_commands.json", ".clangd", "CMakeLists.txt", "Podfile", ".xcodeproj"],
    installHint: "请安装 clangd（macOS: brew install llvm；ObjC++ 项目建议 compile_commands.json）",
  },
  {
    languageId: "zig",
    command: "zls",
    args: [],
    extensions: [".zig"],
    rootMarkers: ["build.zig"],
    installHint: "请安装 zls（https://github.com/zigtools/zls）",
  },
  {
    languageId: "cmake",
    command: "cmake-language-server",
    args: [],
    extensions: [".cmake"],
    fileNames: ["CMakeLists.txt"],
    rootMarkers: ["CMakeLists.txt", ".git"],
    installHint: "请运行: pip install cmake-language-server",
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
  {
    languageId: "groovy",
    command: "groovy-language-server",
    args: [],
    extensions: [".groovy", ".gradle"],
    rootMarkers: ["build.gradle", "settings.gradle", "pom.xml", ".git"],
    installHint: "请安装 groovy-language-server（https://github.com/GroovyLanguageServer/groovy-language-server）",
  },
  {
    languageId: "clojure",
    command: "clojure-lsp",
    args: [],
    extensions: [".clj", ".cljs", ".cljc", ".edn"],
    rootMarkers: ["deps.edn", "project.clj", "shadow-cljs.edn", ".git"],
    installHint: "请安装 clojure-lsp（brew install clojure-lsp/brew/clojure-lsp）",
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
  {
    languageId: "fsharp",
    command: "fsautocomplete",
    args: ["--adaptive-lsp-server-enabled"],
    extensions: [".fs", ".fsi", ".fsx"],
    rootMarkers: ["*.sln", "*.fsproj", ".git"],
    installHint: "请运行: dotnet tool install --global fsautocomplete",
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
    languageId: "powershell",
    command: "powershell-editor-services",
    args: [],
    extensions: [".ps1", ".psm1", ".psd1"],
    rootMarkers: [".git"],
    installHint:
      "请安装 PowerShellEditorServices，并将 powershell-editor-services 启动脚本加入 PATH（https://github.com/PowerShell/PowerShellEditorServices）",
  },
  {
    languageId: "perl",
    command: "perlnavigator",
    args: ["--stdio"],
    extensions: [".pl", ".pm", ".t"],
    rootMarkers: ["cpanfile", "Makefile.PL", ".git"],
    installHint: "请安装 PerlNavigator（https://github.com/bscan/PerlNavigator）并将 perlnavigator 加入 PATH",
  },
  {
    languageId: "r",
    command: "R",
    args: ["--slave", "-e", "languageserver::run()"],
    extensions: [".r", ".R", ".rmd", ".Rmd"],
    rootMarkers: ["DESCRIPTION", "renv.lock", ".Rproj", ".git"],
    installHint: "请在 R 中安装: install.packages(\"languageserver\")，并确保 R 在 PATH",
  },
  {
    languageId: "julia",
    command: "julia",
    args: [
      "--startup-file=no",
      "--history-file=no",
      "-e",
      "using LanguageServer; runserver()",
    ],
    extensions: [".jl"],
    rootMarkers: ["Project.toml", "Manifest.toml", ".git"],
    installHint: "请运行: julia -e 'using Pkg; Pkg.add(\"LanguageServer\")'",
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
    languageId: "erlang",
    command: "erlang_ls",
    args: [],
    extensions: [".erl", ".hrl"],
    rootMarkers: ["rebar.config", "erlang.mk", ".git"],
    installHint: "请安装 erlang_ls（https://github.com/erlang-ls/erlang_ls）",
  },
  {
    languageId: "ocaml",
    command: "ocamllsp",
    args: [],
    extensions: [".ml", ".mli"],
    rootMarkers: ["dune-project", ".git"],
    installHint: "请运行: opam install ocaml-lsp-server",
  },
  {
    languageId: "elm",
    command: "elm-language-server",
    args: [],
    extensions: [".elm"],
    rootMarkers: ["elm.json", ".git"],
    installHint: "请运行: npm i -g @elm-tooling/elm-language-server",
  },
  {
    languageId: "rescript",
    command: "rescript-language-server",
    args: ["--stdio"],
    extensions: [".res", ".resi"],
    rootMarkers: ["bsconfig.json", "rescript.json", "package.json"],
    installHint: "请运行: npm i -g @rescript/language-server",
  },
  {
    languageId: "nix",
    command: "nil",
    args: [],
    extensions: [".nix"],
    rootMarkers: ["flake.nix", "shell.nix", "default.nix", ".git"],
    installHint: "请安装 nil（https://github.com/oxalica/nil）或 nixd",
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
    languageId: "xml",
    command: "lemminx",
    args: [],
    extensions: [".xml", ".xsd", ".xsl", ".xslt"],
    rootMarkers: [".git"],
    installHint: "请安装 lemminx（https://github.com/eclipse/lemminx）",
  },
  {
    languageId: "markdown",
    command: "marksman",
    args: ["server"],
    extensions: [".md", ".markdown"],
    rootMarkers: [".marksman.toml", ".git"],
    installHint: "请安装 marksman（https://github.com/artempyanykh/marksman）",
  },
  {
    languageId: "latex",
    command: "texlab",
    args: [],
    extensions: [".tex", ".sty", ".cls", ".bib"],
    rootMarkers: [".latexmkrc", "Tectonic.toml", ".git"],
    installHint: "请安装 texlab（cargo install texlab / brew install texlab）",
  },

  // ── 基础设施 / 数据 / 合约 ──
  {
    languageId: "dockerfile",
    command: "docker-langserver",
    args: ["--stdio"],
    extensions: [".dockerfile"],
    fileNames: ["Dockerfile", "Dockerfile.dev", "Dockerfile.prod", "Containerfile"],
    rootMarkers: ["Dockerfile", "docker-compose.yml", "compose.yml", ".git"],
    installHint: "请运行: npm i -g dockerfile-language-server-nodejs",
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
    languageId: "sql",
    command: "sqls",
    args: [],
    extensions: [".sql"],
    rootMarkers: [".git"],
    installHint: "请运行: go install github.com/sqls-server/sqls@latest",
  },
  {
    languageId: "graphql",
    command: "graphql-lsp",
    args: ["server", "--method", "stream"],
    extensions: [".graphql", ".gql"],
    rootMarkers: [".graphqlrc", ".graphqlrc.yml", ".graphqlrc.yaml", "package.json", ".git"],
    installHint: "请运行: npm i -g graphql-language-service-cli",
  },
  {
    languageId: "prisma",
    command: "prisma-language-server",
    args: ["--stdio"],
    extensions: [".prisma"],
    rootMarkers: ["schema.prisma", "package.json", ".git"],
    installHint: "请运行: npm i -g @prisma/language-server",
  },
  {
    languageId: "protobuf",
    command: "bufls",
    args: ["serve"],
    extensions: [".proto"],
    rootMarkers: ["buf.yaml", "buf.gen.yaml", ".git"],
    installHint: "请安装 bufls（go install github.com/bufbuild/buf-language-server/cmd/bufls@latest）",
  },
  {
    languageId: "solidity",
    command: "nomicfoundation-solidity-language-server",
    args: ["--stdio"],
    extensions: [".sol"],
    rootMarkers: ["hardhat.config.js", "hardhat.config.ts", "foundry.toml", "truffle-config.js", ".git"],
    installHint:
      "请运行: npm i -g @nomicfoundation/solidity-language-server（命令 nomicfoundation-solidity-language-server）",
  },
  {
    languageId: "vim",
    command: "vim-language-server",
    args: ["--stdio"],
    extensions: [".vim"],
    rootMarkers: [".git"],
    installHint: "请运行: npm i -g vim-language-server",
  },
];

let userSpecs: ServerSpec[] = [];

/** 注册/覆盖用户自定义 spec（按扩展名/文件名优先于内置） */
export function registerServers(specs: ServerSpec[]): void {
  userSpecs = specs;
}

/** 列出内置语言（调试 / 文档用） */
export function listBuiltinLanguages(): Array<{
  languageId: string;
  command: string;
  extensions: string[];
  fileNames?: string[];
}> {
  return BUILTIN.map((s) => ({
    languageId: s.languageId,
    command: s.command,
    extensions: [...s.extensions],
    fileNames: s.fileNames ? [...s.fileNames] : undefined,
  }));
}

function matchesFileName(spec: ServerSpec, file: string): boolean {
  if (!spec.fileNames?.length) return false;
  const base = basename(file);
  const baseLower = base.toLowerCase();
  return spec.fileNames.some((n) => n === base || n.toLowerCase() === baseLower);
}

/** 按文件扩展名或特殊文件名解析 ServerSpec（用户配置优先） */
export function resolveSpec(file: string): ServerSpec | null {
  const ext = extname(file).toLowerCase();
  for (const spec of [...userSpecs, ...BUILTIN]) {
    if (matchesFileName(spec, file)) return spec;
    if (ext && spec.extensions.includes(ext)) return spec;
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
      // 支持简单通配：*.sln / *.csproj（仅当前目录）
      if (m.includes("*")) {
        try {
          const files = readdirSync(dir);
          const re = new RegExp("^" + m.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$", "i");
          if (files.some((f) => re.test(f))) return dir;
        } catch {
          /* ignore */
        }
      } else if (existsSync(join(dir, m))) {
        return dir;
      }
    }
    prev = dir;
    dir = dirname(dir);
  }
  return dirname(file);
}
