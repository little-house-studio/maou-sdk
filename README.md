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

**交付方式（当前）**：`git clone` 源码 + 本机装依赖后 `install` 脚本构建 JS，并**自动下载**终端引擎 / TUI 预编译包（**普通用户无需 Rust / VS Build Tools**）。

> 预编译资产由 GitHub Actions 发布到 Release **`native-prebuilds`**。  
> 维护者操作与故障排查见 [`docs/NATIVE_PREBUILD.md`](docs/NATIVE_PREBUILD.md)。

---

## 安装（三系统）

**普通用户只需：Git + Node.js ≥ 20 + pnpm。**  
`install` 会 `pnpm build` JS，并下载 `terminal-engine` / `maou-tui` 预编译（需能访问 GitHub）。

### macOS

**第一步：安装依赖**

```bash
# 若无 Xcode CLT，按提示安装即可（非必须为 Rust）
xcode-select --install   # 可选；部分 npm 原生依赖可能用到
brew install node@20 git
npm install -g pnpm
```

**第二步：安装 maou**

```bash
git clone https://github.com/little-house-studio/maou-sdk.git
cd maou-sdk
# 建议使用开发分支
git checkout develop
bash scripts/install.sh
# 会把 maou 链到 PATH；找不到则新开终端或 hash -r
maou doctor
maou setup
maou coding
```

### Linux（Ubuntu/Debian）

**第一步：安装依赖**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
npm install -g pnpm
```

**第二步：安装 maou**

```bash
git clone https://github.com/little-house-studio/maou-sdk.git
cd maou-sdk
git checkout develop
bash scripts/install.sh
maou doctor
maou setup
maou coding
```

### Windows（原生 PowerShell，**不要 WSL**）

**第一步：安装依赖（无需 Rust / VS Build Tools）**

```powershell
# Node ≥20：https://nodejs.org/  或 winget install OpenJS.NodeJS.LTS
# Git：https://git-scm.com/download/win  或 winget install Git.Git
npm install -g pnpm
```

**第二步：安装 maou**

```powershell
git clone https://github.com/little-house-studio/maou-sdk.git
cd maou-sdk
git checkout develop
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
# 生成 %USERPROFILE%\.maou\bin\maou.cmd 并写入用户 PATH
maou doctor
maou setup
maou coding
```

若装完当前窗口仍找不到 `maou`：开一个**新的** PowerShell 再试。

### 开发者：本机编译原生组件（可选）

改 `terminal-engine` / Ratatui 源码时才需要：

```bash
# 需 Rust；Windows 另需 VS C++ Build Tools
MAOU_BUILD_NATIVE=1 bash scripts/install.sh
# 或
bash scripts/build-native.sh --from-source
```

维护者发布预编译：GitHub → Actions → **Native prebuilds** → Run workflow（详见 `docs/NATIVE_PREBUILD.md`）。

---

## 常用命令

```bash
maou doctor              # 诊断 + 自动修复依赖（engine / dcg / rg / sqry / ts-ls）
maou doctor --check      # 只诊断
maou update              # git pull + 本机构建（仅 clone 安装）
maou update --check      # 只看远程是否有更新
maou setup               # 配置 API
maou coding              # 启动 Coding Agent
```

`maou doctor` / `install.sh` 会自动补齐：
- **Core**：pnpm build
- **Terminal / Coding**：build-native（terminal-engine + Ratatui）、dcg、rg、**sqry**（`find_code` 必选）；`use_terminal` 默认全平台管道，不依赖 node-pty
- **Optional**：`typescript-language-server`；`ddgr` 仅提示

更新后请**手动退出**正在运行的 TUI，再执行 `maou coding`（不会自动杀进程）。

---

## 开发者（本仓）

```bash
pnpm install
pnpm -r build
# 必须编译原生组件
bash scripts/build-native.sh              # macOS / Linux
powershell -File scripts/build-native.ps1  # Windows
```

---

## License

MIT
