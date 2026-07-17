# maou-sdk

Maou Agent 官方 SDK / Coding Agent monorepo（`@little-house-studio/*`）。

---

## 内部测试中 · 不建议生产使用

> **本仓库目前处于内部测试（alpha）阶段。**  
> **不建议**外部用户下载、安装或用于生产 / 重要项目。  
> 接口、安装方式、行为随时可能变更；文档与能力矩阵可能不完整。  
> 若你仍自行尝试，请自担风险，并优先阅读 [INSTALL.md](./INSTALL.md)。

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

**共同前提（须自行安装）：**

- **Node.js ≥ 20**（安装脚本**不**替你装 Node）
- **pnpm**（`npm i -g pnpm`）
- **Git**
- （完整终端，可选）**Rust**；Windows 另需 **VS Build Tools（C++）**

### macOS

```bash
git clone https://github.com/little-house-studio/maou-sdk.git
cd maou-sdk
bash scripts/install.sh
export PATH="$HOME/.maou/bin:$PATH"
maou doctor
maou setup
maou coding
```

### Linux

```bash
git clone https://github.com/little-house-studio/maou-sdk.git
cd maou-sdk
bash scripts/install.sh
export PATH="$HOME/.maou/bin:$PATH"
maou doctor
maou setup
maou coding
```

### Windows（原生 PowerShell，**不要 WSL**）

```powershell
git clone https://github.com/little-house-studio/maou-sdk.git
cd maou-sdk
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
$env:Path = "$env:USERPROFILE\.maou\bin;" + $env:Path
maou doctor
maou setup
maou coding
```

Windows 默认 TUI 为 **Ink**。更细的依赖、磁盘占用、能力降级说明见 **[INSTALL.md](./INSTALL.md)**。

---

## 常用命令

```bash
maou doctor              # 诊断 + 自动修复依赖
maou doctor --check      # 只诊断
maou update              # git pull + 本机构建（仅 clone 安装）
maou update --check      # 只看远程是否有更新
maou setup               # 配置 API
maou coding              # 启动 Coding Agent
```

更新后请**手动退出**正在运行的 TUI，再执行 `maou coding`（不会自动杀进程）。

---

## 开发者（本仓）

```bash
pnpm install
pnpm -r build
# 可选原生
bash scripts/build-native.sh          # macOS / Linux
# 或
powershell -File scripts/build-native.ps1 -SkipRatatui   # Windows
```

---

## License

MIT
