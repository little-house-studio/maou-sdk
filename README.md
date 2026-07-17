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
| `@little-house-studio/cli`（`maou`） | 终端入口 |
| `@little-house-studio/coding-agent` | 编程 Agent 产品 |
| `@little-house-studio/agent` / `context` / `tools` / `llm` / `types` … | 运行时与工具层 |

**交付方式（当前）**：`git clone` 源码 + 本机构建（**不是** npm 一句话安装）。  
原生终端等能力需本机编译；**我们不发布环境相关预编译包**。

---

## 安装（三系统）

**共同前提**：按下方平台步骤复制运行即可，所有依赖都会自动安装。

### macOS

**第一步：安装依赖（打开终端，复制运行）**

```bash
xcode-select --install
brew install node@20 rust git
npm install -g pnpm
```

**第二步：复制运行**

```bash
git clone https://github.com/little-house-studio/maou-sdk.git
cd maou-sdk
bash scripts/install.sh
maou doctor
maou setup
maou coding
```

### Linux（Ubuntu/Debian）

**第一步：安装依赖（打开终端，复制运行）**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential
npm install -g pnpm
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

**第二步：复制运行**

```bash
git clone https://github.com/little-house-studio/maou-sdk.git
cd maou-sdk
bash scripts/install.sh
maou doctor
maou setup
maou coding
```

### Windows（原生 PowerShell，**不要 WSL**）

**第一步：安装依赖（打开 PowerShell，复制运行）**

```powershell
powershell -Command "Invoke-WebRequest -Uri https://nodejs.org/dist/v20.17.0/node-v20.17.0-x64.msi -OutFile node.msi; Start-Process msiexec -ArgumentList '/i node.msi /qn' -Wait; Remove-Item node.msi"
powershell -Command "Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile rustup-init.exe; Start-Process rustup-init.exe -ArgumentList '-y' -Wait; Remove-Item rustup-init.exe"
powershell -Command "Invoke-WebRequest -Uri https://github.com/git-for-windows/git/releases/download/v2.45.2.windows.1/Git-2.45.2-64-bit.exe -OutFile git.exe; Start-Process git.exe -ArgumentList '/VERYSILENT /NORESTART' -Wait; Remove-Item git.exe"
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
npm install -g pnpm
```

> **提示**：如果上面命令失败，手动下载安装：
> - Node.js ≥20：https://nodejs.org/
> - Rust：https://www.rust-lang.org/tools/install
> - Git：https://git-scm.com/download/win
> - VS Build Tools（C++ 工作负载）：https://visualstudio.microsoft.com/visual-cpp-build-tools/
> - 安装完打开 PowerShell 运行 `npm install -g pnpm`

**第二步：重启 PowerShell（让 Rust 和 Node 的 PATH 生效），复制运行**

```powershell
git clone https://github.com/little-house-studio/maou-sdk.git
cd maou-sdk
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
maou doctor
maou setup
maou coding
```

**默认 TUI 为 Ratatui（Rust 编译），完整功能需要 Rust + VS Build Tools。**

---

## 常用命令

```bash
maou doctor              # 诊断 + 自动修复依赖（含 node-pty/sqry/ts-ls 检测）
maou doctor --check      # 只诊断
maou update              # git pull + 本机构建（仅 clone 安装）
maou update --check      # 只看远程是否有更新
maou setup               # 配置 API
maou coding              # 启动 Coding Agent
```

`maou doctor` 会自动补齐：
- **Core**：pnpm build
- **Terminal**：build-native / dcg / node-pty 加载检测
- **Optional**：`sqry`（预编译）、`typescript-language-server`；`ddgr` 仅提示

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
