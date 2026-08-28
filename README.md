<img width="1080" height="225" alt="Maou" src="https://github.com/user-attachments/assets/d345ef4c-9e7c-4503-a347-9f3461fdc726" />

# Maou

**编码 Agent 运行时与产品套件。** 终端与桌面共用同一套 Agent 循环、工具、会话与模型接入；带自己的 key 即可在本机跑完整的编程与运维 Agent。

[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-0f172a)](#安装)
[![License](https://img.shields.io/badge/license-MIT-blue)](#许可)

仓库：[`little-house-studio/maou-sdk`](https://github.com/little-house-studio/maou-sdk) · 包作用域 `@little-house-studio/*`

> 当前为内部 alpha。接口与安装路径仍会变动，不建议用于生产或关键仓库。自行试用请自担风险。

---

## 目录

- [能做什么](#能做什么)
- [产品形态](#产品形态)
- [架构](#架构)
- [系统要求](#系统要求)
- [安装](#安装)
- [快速开始](#快速开始)
- [桌面客户端](#桌面客户端)
- [配置](#配置)
- [命令](#命令)
- [从源码开发](#从源码开发)
- [发布与部署](#发布与部署)
- [仓库结构](#仓库结构)
- [许可](#许可)

---

## 能做什么

### 双前端，一套运行时

| 入口 | 包 | 说明 |
|------|-----|------|
| **maou** | `@little-house-studio/cli` | 终端入口。业务在 Node，画面是 Ratatui TUI |
| **maou-app** | `@little-house-studio/app` | 桌面客户端（macOS / Windows / Linux）。对话、内嵌终端、Markdown 工作台 |

两端走同一套 `AgentRuntime`、工具层、会话存储和 LLM 客户端。桌面 host 与渲染进程走本机 IPC（unix socket / named pipe），不对外开业务 TCP。

### 编程 Agent 与机器级 Ops

- **`maou coding`**：驻扎当前项目。读写文件、检索、终端、计划、待办、技能、子 Agent。项目数据落在该目录 `.maou/`。
- **`maou` / `maou ops`**：机器级 Ops。数据在 `~/.maou/ops`，不污染调用目录；可查看、创建、委派各项目的 coding 任务。
- 子 Agent 四种：`fork` / `helper` / `task` / `project`。运行时按发现到的子 Agent 动态挂委派工具。
- 技能、命令、钩子、人设卡（兼容 SillyTavern V2）按「目录即 Agent」加载：项目 `.maou/agents/<name>/` 覆盖全局 `~/.maou/agents/<name>/`。

### 多厂商模型

`@little-house-studio/llm` 一套 API 对接：

OpenAI · Anthropic · Google / Vertex · Azure · Amazon Bedrock · Mistral · Cloudflare · OpenAI Codex · GitHub Copilot · 任意 OpenAI 兼容端点

能力包括：流式与非流式、原生 tool-call、结构化 JSON（带提取/修复）、思考链解析、多模态、图片生成、成本与 token 统计、订阅 OAuth、跨厂商对话交接。角色预设为 `main` / `fast` / `vision` / `helper`。目录由 [models.dev](https://models.dev) 生成，可离线回退。

LLM 配置的唯一权威是用户级 `~/.maou/config.json`（`api.presets`），可用 `$MAOU_LLM_CONFIG` 覆盖。项目 `project_config.json` 不含 `api` 段。

### 工具与引擎

内置约 28 个工具，统一 schema + 执行器，文件路径全部经 `path-guard`，终端命令三档审批（`normal` / `auto` / `yolo`），DCG 二进制作失效关闭的最后一道闸。

重活在独立引擎里，工具层只做调度和展示：

| 引擎 | 作用 |
|------|------|
| **terminal-engine** | 真实 PTY（Rust + napi-rs）。前台/后台、环形日志、进程树结束。缺 `.node` 时降级 mini |
| **lsp-engine** | 50+ 语言服务器。诊断要等 settle，不会空报「没有错误」 |
| **opencli-engine** | 外部 `opencli` + Chrome 扩展，复用已登录浏览器 |
| **sqry-engine** | 代码搜索（`sqry` CLI） |

其它常用工具：`read_file` / `write_file` / `edit_file`、`grep` / `glob` / `find_code`、`web_fetch` / `search_internet` / `read_image`、`use_browser`、`use_skill`、计划与待办、项目与团队协作。

### 会话与上下文

- 磁盘会话：jsonl + `meta.json`，给人看的完整日志
- Harness 工作集：给模型看的压缩上下文，指纹对齐后跨轮复用
- 压缩阶段：`active → compact → summary → archive`；最近原文窗口不压
- 紧急裁剪作最后手段
- 桌面侧：会话列表 / 新建 / 切换 / 清空 / 删除 / 重命名、导出、重试、忙碌队列、token 统计

### 安全与修复

- 文件访问模式：`inherit` / `hard` / `audit` / `open`；流水线可加拒绝段（`MAOU_PIPELINE_ISOLATE=1`）
- 终端审批：一次、总是、拒绝、黑名单
- **`maou doctor`**：按安装形态修复。预编译包只下载、永不调包管理器或编译器；源码树才 `pnpm` / 构建
- **`maou update`**：同样分轨。预编译包下载、校验、原子切换（旧版本留 2 份可回滚）

---

## 产品形态

```
                    ┌─ maou          Ratatui TUI
  AgentRuntime  ────┤
  tools / llm       └─ maou-app      Electron 桌面
  context / types
         │
         ├─ coding-agent   项目内编程
         └─ ops-agent      机器级运维（默认定居 ~/.maou/ops）
```

两条**互斥**的交付轨，由包根是否存在 `RELEASE.json` 区分（见 `cli` 的 `detectRuntime()`）：

| 轨 | 给谁 | 怎么来 | 坏了怎么修 |
|----|------|--------|------------|
| **预编译包** | 使用 | GitHub Release 的 `maou-<platform>.tar.gz` / `.zip` | 只下载预置资源，禁止 pnpm / cargo / npm install |
| **源码树** | 开发 | `git clone` + `pnpm setup:dev` | 构建 |

用户包里已经带齐编译后的 JS、依赖、以及本平台的 terminal-engine / TUI / dcg / rg / sqry / ddgr。不需要 git、pnpm、Rust、Visual Studio Build Tools，机器上也不会跑编译。

`ddgr`（搜索增强）是 Python 脚本，需要 Python ≥ 3.6。macOS 和多数 Linux 自带；Windows 通常没有。缺了只影响搜索质量，`search_internet` 会走 HTTP 回退，Agent 照常跑。

---

## 架构

下层不依赖上层。

| 层 | 包 | 职责 |
|----|-----|------|
| 类型与配置 | `@little-house-studio/types` | 领域类型、`ConfigStore`、项目管理、路径与 token |
| 提示词 | `@little-house-studio/prompt` | 模板编译、人设 / 角色卡、动态上下文 |
| 模型 | `@little-house-studio/llm` | 多厂商客户端、流式、tool-call、OAuth |
| 上下文 | `@little-house-studio/context` | 会话落盘、组消息、压缩、结构化记忆 |
| 运行时 | `@little-house-studio/agent` | `AgentRuntime`、注册表、子 Agent、命令、事件、技能 |
| 工具 | `@little-house-studio/tools` | Tool 基类、注册、执行、内置工具、安全闸 |
| 引擎 | `terminal-engine` / `lsp-engine` / `opencli-engine` / `sqry-engine` | 无界面逻辑包；返回纯数据，不依赖 agent |
| 产品 | `coding-agent` / `ops-agent` | 薄壳：白名单、提示词、工作区约定 |
| 入口 | `cli` / `app` | TUI 与桌面；共享 headless 内核 |

桌面壳本身也分层：座位树（`slots/`）只声明洞；host 往座位投稿；左右栏页签用 `registerAsideTab` 一次挂上图标和面板；对话列拆成消息树 / 滚动台 / 提问刻度条，互不进对方实现。

---

## 系统要求

| | 使用预编译包 | 改源码 |
|--|----------------|--------|
| **Node** | ≥ 20（没有则安装器可装一份私有 Node 到 `~/.maou/runtime`，不动系统 node） | ≥ 20 |
| **包管理** | 不需要 | **pnpm@10**（不要用 pnpm 11：Node 20 上 `node:sqlite` 起不来） |
| **编译器** | 不需要 | Linux 需要 make / g++。Rust **可选**：`rustc ≥ 1.88` 才本机编原生件，否则下预编译 |
| **平台** | `darwin-arm64` `darwin-x64` `linux-x64` `linux-arm64` `win32-x64` `win32-arm64` | 同左 |

某次 Release 缺某个平台时，安装器会直接说明，不会装出一个坏包。

---

## 安装

### 预编译包（推荐）

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/little-house-studio/maou-sdk/main/scripts/install-user.sh | bash
```

**Windows**（原生 PowerShell，不要走 WSL）

```powershell
irm https://raw.githubusercontent.com/little-house-studio/maou-sdk/main/scripts/install-user.ps1 | iex
```

装完若找不到 `maou`：新开一个终端，或：

```bash
export PATH="$HOME/.maou/bin:$PATH"
```

<details>
<summary>安装器做了什么，以及可调项</summary>

1. 探测平台，从 GitHub Release 下载对应包并校验 sha256
2. 解压到 `~/.maou/versions/<版本>/`，`~/.maou/current` 指向它
3. 写入 `~/.maou/bin/maou` 启动器并加入 PATH
4. 没有 Node ≥ 20 时，装一份私有 Node（约 50 MB）到 `~/.maou/runtime`

`curl | bash` 没有 tty，缺 Node 时直接装、不问。先下载再 `bash install-user.sh` 会弹出 `[Y/n]`。

| 环境变量 | 作用 |
|----------|------|
| `MAOU_CHANNEL=dev` | 装滚动开发版（默认 `stable`；没有 stable 时回退 dev） |
| `MAOU_VERSION=v0.1.0` | 指定 Release tag |
| `MAOU_HOME` | 安装根目录，默认 `~/.maou` |
| `MAOU_NO_PATH=1` | 不改 shell / 用户 PATH |
| `MAOU_INSTALL_NODE=0` | 缺 Node 时不自动装，直接退出 |
| `GITHUB_TOKEN` | 私有仓库或 API 限额不够时 |

</details>

### 更新与卸载

```bash
maou update                 # 查 Release → 下载 → 原子切换
maou update --check         # 只看有没有新版本
maou update --channel dev   # 切到滚动开发通道
```

更新后请**手动退出**正在跑的 TUI 再开（不会自动杀进程）。

卸载：删除 `~/.maou`（Windows：`%USERPROFILE%\.maou`），再从 shell 配置里去掉那行 PATH。

---

## 快速开始

```bash
maou doctor      # 检查组件（预编译包里应当全是 ✓）
maou setup       # 交互配置 API（需要 TTY）
maou coding      # 在当前目录启动编程 Agent
```

`maou setup` 没配好、或没有 `~/.maou/config.json`，不是安装失败，只是还不能对话。`typescript-language-server` 在 doctor 里显示 △ 也不挡 CLI。

常用入口：

```bash
maou --version    # 版本 + 当前是预编译包还是源码树
maou coding       # 编程 Agent（当前目录）
maou ops          # 机器级 Ops
maou doctor       # 诊断；可自动修
maou doctor --check
maou update
```

---

## 桌面客户端

`maou-app` 与 CLI 共用 coding-agent 和 terminal-engine：对话是流式 `StreamEvent`，底栏终端是 Agent `use_terminal` 的真实会话（不是另开一个壳），并带项目内 Markdown 树 / 大纲 / 编辑。

开发（只开 Electron，界面热更新走 Vite）：

```bash
pnpm --filter @little-house-studio/app dev
```

按当前系统设计本机包：

```bash
pnpm --filter @little-house-studio/app pack          # 当前系统
pnpm --filter @little-house-studio/app pack:mac
pnpm --filter @little-house-studio/app pack:win
pnpm --filter @little-house-studio/app pack:linux
```

产物在 `app/release/`。图标由 `app/scripts/build-icon.mjs` 生成，打包配置见 `app/electron-builder.yml`。

桌面目前**不**打进 CLI 的预编译包；要用窗口就从源码 `dev` 或按上表 pack。设计说明见 [`app/DESIGN.md`](app/DESIGN.md)。

---

## 配置

| 路径 | 内容 |
|------|------|
| `~/.maou/config.json` | 用户级配置。`api.presets` 是 LLM 的唯一权威 |
| `$MAOU_LLM_CONFIG` | 覆盖 LLM 配置路径 |
| `~/.maou/llm-config.json` | 额外的自定义厂商 / 预设（可选） |
| `<项目>/.maou/` | 该项目的会话与 Agent 实例，不含 `api` |
| `~/.maou/ops` | Ops Agent 的数据与会话 |
| `~/.maou/agents/<name>/` | 全局 Agent 模板；可被项目目录覆盖 |
| `~/.maou/current` | 预编译包当前版本指针 |

模型角色用 `main` / `fast` / `vision` / `helper` 选取，不要用旧的 `defaultPreset` / `helperPreset`。

审批模式（终端命令）在桌面与 slash 命令里可切 `normal` / `auto` / `yolo`。

---

## 命令

```bash
maou --version
maou doctor              # 诊断 + 按安装形态修复
maou doctor --check      # 只诊断
maou setup               # 写 API 配置
maou coding              # 编程 Agent
maou ops                 # Ops Agent
maou update              # 更新预编译包
maou update --check
maou update --channel dev
```

源码树里另外常用：

```bash
pnpm setup:dev           # install → build → 补外部工具 → 链接 maou → PATH → doctor
pnpm -r build
pnpm -r test
pnpm -r typecheck
pnpm bundle              # 打当前平台的免构建包到 .release/（验发布链路）
```

只编原生件：

```bash
pnpm --filter @little-house-studio/terminal-engine run build:force
cd cli && npm run build:tui-ratatui
```

---

## 从源码开发

```bash
git clone https://github.com/little-house-studio/maou-sdk.git
cd maou-sdk
git checkout main

# 钉 pnpm@10。不要 `npm i -g pnpm`（会装到 11）
export COREPACK_HOME="$HOME/.local/share/corepack"
mkdir -p "$COREPACK_HOME" ~/.local/bin
export PATH="$HOME/.local/bin:$PATH"
corepack enable --install-directory ~/.local/bin
corepack prepare pnpm@10.15.1 --activate

pnpm setup:dev
```

`pnpm setup:dev` 三系统同一套 Node 脚本。装完后 `maou` 指向**这份源码树**，改代码后 `pnpm -r build` 立刻生效。脚本会把 `~/.maou/bin` 写进 shell rc；**当前这个终端**还要自己 `export PATH=...` 或新开窗口。

Rust 可选。没有 cargo、或 rustc 低于 1.88，会自动下预编译的 `terminal-engine` 和 Ratatui TUI，不会拿旧工具链硬编。

---

## 发布与部署

用户侧永远不需要编译。维护者 push，CI 编，用户 `maou update` 拿走。

```
打 tag vX.Y.Z  或  push develop
        ↓
GitHub Actions「Release bundles」
        ↓  六平台并行
   cargo 编 terminal-engine + maou-tui-ratatui
   pnpm install && pnpm -r build
   scripts/build-release-bundle.mjs
        ↓
Release 资产
   maou-darwin-arm64.tar.gz
   maou-darwin-x64.tar.gz
   maou-linux-x64.tar.gz
   maou-linux-arm64.tar.gz
   maou-win32-x64.zip
   maou-win32-arm64.zip
   manifest.json          ← maou update 用来对版本
   SHA256SUMS.txt
        ↓
用户 maou update → 校验 sha256 → 切换版本目录
```

| 通道 | 触发 | Release | 谁拿到 |
|------|------|---------|--------|
| **stable** | push tag `v*` | 该 tag | 默认安装；`maou update` |
| **dev** | push `develop` | 滚动 `bundle-dev` | `MAOU_CHANNEL=dev` |

本地验打包：

```bash
pnpm bundle              # 当前平台，dev 通道 → .release/
pnpm bundle:stable       # stable 通道
```

版本号以 **`cli/package.json` 的 `version`** 为准，必须是合法 semver（自更新靠版本比较）。完整流程、交叉打包和 doctor 分轨见 [`docs/RELEASE.md`](docs/RELEASE.md)。

桌面客户端单独走 `electron-builder`（`app/electron-builder.yml`），产物在 `app/release/`，与上面的 CLI bundle 不是同一条流水线。

---

## 仓库结构

```
maou-sdk/
  core/types              共享类型与配置
  core/prompt             提示词编译与人设
  core/llm                多厂商 LLM
  core/context            会话与压缩
  core/agent              AgentRuntime、技能、子 Agent
  core/agent/*-engine     terminal / lsp / opencli / sqry
  core/tools              工具壳 + 安全闸
  core/hub                多设备通讯（协议尚未对齐，未作为交付能力）
  agent-products/         coding-agent · ops-agent
  cli/                    maou（Ratatui）
  app/                    maou-app（Electron）
  scripts/                安装器、setup:dev、打 bundle、拉取原生件
  docs/RELEASE.md         发布手册
```

pnpm workspace 只收这些层。产品 Agent 是薄壳，不是运行时本身。

---

## 许可

MIT。各包与 CLI 按 MIT 分发。
