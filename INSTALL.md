# 安装

两条路，选一条。**不要混着来。**

| | 普通用户 | 开发者 |
|---|---|---|
| 装什么 | Release 上的预编译包 | git clone 的源码树 |
| 前提 | Node ≥ 20（没有可自动装私有版） | Node ≥ 20 + **pnpm@10**（Linux：make/g++/python3-setuptools；Rust 可选，rustc ≥ 1.88） |
| 要编译吗 | **不用**，一行都不编 | 要 |
| 命令 | `install-user.sh` / `install-user.ps1` | `pnpm setup:dev` |
| 更新 | `maou update`（下载新包） | `maou update`（git pull + 构建） |

`maou` 自己知道它是哪一种（包里有没有 `RELEASE.json`），`doctor` / `update`
的行为会随之切换 —— 预编译包里**永远不会**去调 pnpm / cargo。

---

## 一、普通用户（免构建）

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/little-house-studio/maou-sdk/develop/scripts/install-user.sh | bash
```

### Windows（原生 PowerShell，不要 WSL）

```powershell
irm https://raw.githubusercontent.com/little-house-studio/maou-sdk/develop/scripts/install-user.ps1 | iex
```

### 然后

```bash
maou doctor      # 组件自检
maou setup       # 配置 API
maou coding      # 启动编程 Agent
```

找不到 `maou`：开新终端窗口，或 `export PATH="$HOME/.maou/bin:$PATH"`
（Windows：新开 PowerShell）。

### 装完的目录

```
~/.maou/
├── bin/maou                       启动器（读 current，换版本不用重装）
├── current -> versions/<版本>/     当前版本
├── versions/
│   └── maou-0.1.0-darwin-arm64/   自包含运行时（dist + node_modules + vendor/bin）
├── runtime/node/                  仅当安装器帮你装了私有 Node
└── config.json                    maou setup 写的 API 配置
```

磁盘占用约 **90 MB**（解压后），下载约 39 MB。

### 环境变量

| 变量 | 作用 |
|------|------|
| `MAOU_CHANNEL=dev` | 装滚动开发版（默认 stable，无 stable 时自动回退 dev） |
| `MAOU_VERSION=v0.1.0` | 装指定 Release |
| `MAOU_REPO=owner/repo` | 换源仓库 |
| `MAOU_HOME` | 换安装目录 |
| `MAOU_NO_PATH=1` | 不改 PATH |
| `MAOU_INSTALL_NODE=0` | 缺 Node 时报错而不是自动装 |
| `GITHUB_TOKEN` | 私有仓库 / API 限额 |

### 更新与回滚

```bash
maou update                 # 下载新包 → 校验 sha256 → 切换 current
maou update --check         # 只看有没有新版本
maou update --force         # 版本相同也重装（修复损坏安装）
maou update --channel dev   # 切通道
```

旧版本保留最近 2 个，回滚就是把 `current` 指回去：

```bash
ls ~/.maou/versions
ln -sfn ~/.maou/versions/maou-0.1.0-darwin-arm64 ~/.maou/current
```

Windows 若没有开发者模式建不了 junction，安装器会写 `~/.maou/current.path`
文本指针，启动器两种都认；回滚改这个文件里的路径即可。

### 卸载

删掉 `~/.maou`（Windows：`%USERPROFILE%\.maou`），再从 shell 配置 / 用户 PATH
里去掉那一行。

---

## 二、开发者（源码树）

```bash
git clone https://github.com/little-house-studio/maou-sdk.git
cd maou-sdk
git checkout develop

# 钉 pnpm@10。不要 `npm i -g pnpm`（会装到 11，Node 20 上 `node:sqlite` 起不来）
export COREPACK_HOME="$HOME/.local/share/corepack"
mkdir -p "$COREPACK_HOME" ~/.local/bin
export PATH="$HOME/.local/bin:$PATH"
corepack enable --install-directory ~/.local/bin
corepack prepare pnpm@10.15.1 --activate

pnpm setup:dev
```

Windows 没有 corepack 写 `/usr/bin` 的问题，可用 `npm i -g pnpm@10.15.1`，
或同样 `corepack prepare pnpm@10.15.1 --activate`。

`pnpm setup:dev` 一条命令覆盖三系统，依次做：

1. 校验 Node ≥ 20 / **pnpm@10**（缺 pnpm 会 `corepack enable --install-directory ~/.local/bin`，不写 `/usr/bin`）
2. `pnpm install`（中途失败可再跑一次；半截 `node_modules` 就 `rm -rf node_modules && pnpm install`）
3. `pnpm -r build`
4. 补 `dcg` / `rg` / `sqry` / `ddgr` 到 `scripts/vendor/bin`
5. 备好 Ratatui TUI（**rustc ≥ 1.88** 才本机编，否则下载预编译）
6. 写 `~/.maou/bin/maou`，指向**本源码树**的 `cli/dist/index.js`，并写入 shell rc
7. `maou doctor --check`

**Rust 不是必需的。** `rustc ≥ 1.88` 才本机编 `terminal-engine` / TUI；没有
cargo、或 rustc 更旧，走预编译。旧 cargo 不会再拖垮整次安装。
`terminal-engine` 的构建脚本也不再需要全局 `napi` CLI —— 有就用，
没有自动回退 `cargo build` 并生成 `.node`。

`maou setup` 需要交互式终端写 API key；非 TTY 会跳过，**不是安装失败**。
`typescript-language-server` 可选，doctor 里一个 △ 不影响起 CLI。

### 日常

```bash
pnpm -r build      # 改完代码重新构建
pnpm -r test
pnpm -r typecheck
pnpm bundle        # 打一个免构建包到 .release/，验证发布链路
maou doctor        # 诊断 + 自动修复
maou update        # git pull + 重新构建
```

### 单独编原生组件

```bash
pnpm --filter @little-house-studio/terminal-engine run build:force
cd cli && npm run build:tui-ratatui
```

### 磁盘

| 阶段 | 大约 |
|------|------|
| git clone | 15–30 MB |
| `pnpm setup:dev` 后 | 0.4–0.8 GB |
| 保留 cargo `target/` | 2–3 GB+ |

```bash
bash scripts/clean-build-cache.sh        # 清 target，留 node_modules
bash scripts/clean-build-cache.sh --all  # 连 node_modules 一起删
```

---

## 能力矩阵（诚实版）

| 能力 | 预编译包 | 源码树 | 缺失时兜底 |
|------|----------|--------|------------|
| 启动 TUI / 对话 | ✅ 内置 | ✅ 构建后 | — |
| 文件 read/write/edit | ✅ | ✅ | — |
| grep / glob | ✅ 内置 `rg` | ✅ | Node 实现（更慢） |
| `find_code`（sqry） | ✅ 内置 | ✅ | 工具不可用 |
| 危险命令门（dcg） | ✅ 内置 | ✅ | **关闭 —— 非生产基线** |
| `use_terminal` 完整 | ✅ 内置引擎 | ✅ / 需 Rust 或预编译 | 降级 spawn，弱交互 |
| MCP / 压缩 / 会话 | ✅ | ✅ | — |
| LSP（TS/JS） | △ 需 `npm i -g typescript-language-server`（doctor 自动） | 同左 | 语义诊断不可用 |
| `search_internet` 质量 | ✅ 内置 `ddgr`，**但需机器上有 Python ≥ 3.6** | 同左 | HTTP fallback |

**不保证**：任意 Windows 机器「装完即与开发者 Mac 全功能零缺陷」。

---

## 排查

```bash
maou --version           # 先确认是哪种安装形态
maou doctor              # 诊断 + 自动修复
maou doctor --check      # 只诊断
```

| 症状 | 处理 |
|------|------|
| 找不到 `maou` | 开新终端；或 `export PATH="$HOME/.maou/bin:$PATH"`。`setup:dev` 会写 shell rc |
| `pnpm` 11 + Node 20 报 `node:sqlite` | 改用 `corepack prepare pnpm@10.15.1 --activate`，不要装 pnpm 11 |
| `corepack enable` EACCES `/usr/bin` | `corepack enable --install-directory ~/.local/bin`，并设 `COREPACK_HOME` |
| 终端降级 mini / 人壳不可用 | 缺 Rust `.node`。`node scripts/ensure-terminal-engine.mjs` 或 `maou doctor`；显式 `MAOU_TERMINAL=mini` 则不要求 |
| Debian `apt` 拉 `xz-utils` 报 400 | 镜像对带 `+` 的版本号会 400，换镜像或手动下 deb 再 `apt-get install -f` |
| `pnpm install` 中途失败 | `rm -rf node_modules && pnpm install`，再 `pnpm setup:dev` |
| `doctor` 报组件缺失（预编译包） | `maou doctor` 会重新下载；确认能访问 GitHub |
| `doctor` 报 Core 不完整（预编译包） | 包解压损坏 → `maou update --force` 或重跑安装脚本 |
| `doctor` ts-ls △ | 可选 LSP，不影响起 CLI。需要再 `npm i -g typescript-language-server typescript` |
| `maou setup` 非 TTY 跳过 | 预期。进交互终端再跑，或手写 `~/.maou/config.json` |
| 下载失败 / 限流 | 设 `GITHUB_TOKEN`，或用代理 |
| 该平台无资产 | 该次发布缺这个平台，见 `docs/RELEASE.md` 平台矩阵 |
| TUI 起不来（源码树） | rustc ≥ 1.88 后 `cd cli && npm run build:tui-ratatui`；更旧的 rustc 请走预编译 |

---

## 相关文档

- [`docs/RELEASE.md`](docs/RELEASE.md) — 维护者发布流程
- [`docs/NATIVE_PREBUILD.md`](docs/NATIVE_PREBUILD.md) — 裸原生件（源码树开发者用）
