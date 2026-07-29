<img width="1080" height="225" alt="image" src="https://github.com/user-attachments/assets/d345ef4c-9e7c-4503-a347-9f3461fdc726" />

# maou-sdk

Maou Agent 官方 SDK / Coding Agent monorepo（`@little-house-studio/*`）。

---

## 内部测试中 · 不建议生产使用

> **本仓库目前处于内部测试（alpha）阶段。**  
> **不建议**外部用户下载、安装或用于生产 / 重要项目。  
> 接口、安装方式、行为随时可能变更；文档与能力矩阵可能不完整。  
> 若你仍自行尝试，请自担风险。

---

## 这是什么

| 组件 | 说明 |
|------|------|
| `@little-house-studio/cli`（`maou`） | 终端入口（Ratatui） |
| `@little-house-studio/webui`（`maou-web`） | Web 入口：对话 + 内置终端 |
| `@little-house-studio/coding-agent` | 编程 Agent 产品 |
| `@little-house-studio/agent` / `context` / `tools` / `llm` / `types` … | 运行时与工具层 |

---

## 装哪一种？

| 你是 | 装法 | 需要什么 | 要编译吗 |
|------|------|----------|----------|
| **想用 maou** | 一行安装命令（下面 ↓） | 只要 Node ≥ 20 | **不用** |
| **想改 maou** | `git clone` + `pnpm setup:dev` | Node ≥ 20 + pnpm（+ Rust 可选） | 要 |

用户装的是 GitHub Release 上按平台预编译好的自包含包：JS 已编译、依赖已装齐、
终端引擎 / TUI / dcg / rg / sqry / ddgr 全部内置。**不需要 git、pnpm、Rust、
Visual Studio Build Tools，也不会在你机器上跑任何编译。**

> 唯一一个「装了不一定能用」的是 `ddgr`（搜索增强）—— 它是 Python 脚本，
> 需要机器上有 Python ≥ 3.6。macOS / 多数 Linux 自带；Windows 通常没有。
> 缺了只影响搜索结果质量，`search_internet` 会走 HTTP fallback，不影响 Agent 运行。

---

## 安装（普通用户 · 免构建）

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/little-house-studio/maou-sdk/develop/scripts/install-user.sh | bash
```

### Windows（原生 PowerShell，**不要 WSL**）

```powershell
irm https://raw.githubusercontent.com/little-house-studio/maou-sdk/develop/scripts/install-user.ps1 | iex
```

然后：

```bash
maou doctor      # 检查组件（都应是 ✓）
maou setup       # 配置 API
maou coding      # 在当前目录启动编程 Agent
```

装完找不到 `maou`？开一个**新**终端窗口，或 `export PATH="$HOME/.maou/bin:$PATH"`。

<details>
<summary>安装器做了什么 / 可调项</summary>

- 探测平台 → 从 Release 下载 `maou-<platform>.tar.gz|.zip` → 校验 sha256
- 解压到 `~/.maou/versions/<版本>/`，`~/.maou/current` 指向它
- 写 `~/.maou/bin/maou` 启动器并加进 PATH
- **没有 Node ≥ 20 时**：装一份私有 Node（约 50 MB）到 `~/.maou/runtime`，**不动系统 node**
  - 上面的 `curl | bash` 是管道、没有 tty，所以**直接装、不询问**（否则安装必然失败，问也没意义）
  - 先下载脚本再在终端里跑（`bash install-user.sh`）会弹 `[Y/n]` 让你选
  - 不想要就 `MAOU_INSTALL_NODE=0`，此时缺 Node 直接报错退出

| 环境变量 | 作用 |
|----------|------|
| `MAOU_CHANNEL=dev` | 装滚动开发版（默认 `stable`，没有 stable 时自动回退 dev） |
| `MAOU_VERSION=v0.1.0` | 装指定版本 |
| `MAOU_HOME` | 换安装目录（默认 `~/.maou`） |
| `MAOU_NO_PATH=1` | 不改 shell / 用户 PATH |
| `MAOU_INSTALL_NODE=0` | 缺 Node 时不自动装，直接报错 |
| `GITHUB_TOKEN` | 私有仓库或 API 限额不够时 |

</details>

支持平台：`darwin-arm64` `darwin-x64` `linux-x64` `linux-arm64` `win32-x64` `win32-arm64`。
某平台在该次发布里缺席时，安装器会明确告诉你，而不是装出一个坏的包。

### 更新 / 卸载

```bash
maou update            # 查 Release → 下载新包 → 原子切换（旧版本保留 2 个可回滚）
maou update --check    # 只看有没有新版本
maou update --channel dev   # 切通道
```

卸载：删掉 `~/.maou` 即可（Windows：`%USERPROFILE%\.maou`），再从 shell 配置里去掉那行 PATH。

---

## 安装（开发者 · 源码树）

```bash
git clone https://github.com/little-house-studio/maou-sdk.git
cd maou-sdk
git checkout develop

npm i -g pnpm          # 若还没有
pnpm setup:dev         # 一条命令：install → build → 补外部工具 → 链接 maou → doctor
```

`pnpm setup:dev` 三系统通用（内部是 Node 脚本，不分 bash / PowerShell）。装完
`maou` 指向**这个源码树**，改完代码 `pnpm -r build` 立刻生效。

**Rust 是可选的**：有 `cargo` 就本机编 `terminal-engine` 和 Ratatui TUI；
没有就自动下载预编译版本，照样能跑。

```bash
pnpm -r build          # 改完代码重新构建
pnpm -r test           # 跑测试
pnpm bundle            # 打一个免构建预编译包到 .release/（验证发布链路）
maou doctor            # 诊断 + 自动修复
```

<details>
<summary>只想编原生组件</summary>

```bash
pnpm --filter @little-house-studio/terminal-engine run build:force   # 有 napi 用 napi，没有回退 cargo
cd cli && npm run build:tui-ratatui                                  # Ratatui TUI
```

</details>

---

## 常用命令

```bash
maou --version           # 版本 + 安装形态（预编译包 / 源码树）
maou doctor              # 诊断 + 自动修复
maou doctor --check      # 只诊断
maou setup               # 配置 API
maou coding              # 启动编程 Agent（当前目录）
maou ops                 # 机器级 Ops Agent
maou update              # 更新
```

`maou doctor` 会按安装形态选择修复手段：

- **预编译包**：缺什么**下载**什么，永远不碰编译器
- **源码树**：`pnpm install` / `pnpm -r build` / 编原生件

更新后请**手动退出**正在运行的 TUI 再重开（不会自动杀进程）。

---

## 维护者

发布流程（打 tag → CI 六平台并行编译 → Release → 用户 `maou update` 拿到）见
[`docs/RELEASE.md`](docs/RELEASE.md)。

---

## License

MIT
