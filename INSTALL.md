# Maou 安装（不包含安装 Node）

**前提**：本机 **Node.js ≥ 20**、**pnpm**（`npm i -g pnpm`）。安装器**不装 Node**。

**原则**：

- **Core（必须）**：JS monorepo `pnpm -r build` + `cli/dist` — **失败则安装 exit 1**，不写假成功。
- **Terminal / Optional**：用户本机构建；失败则 **降级运行**，`maou doctor` 标 `△`。
- **不**发布 terminal-engine / node-pty / ratatui 等环境相关预编译。
- **dcg** 从 GitHub Release 直链下载。

## 磁盘占用（Git 下载 + 构建后目标 &lt; 1GB）

| 阶段 | 大约 | 说明 |
|------|------|------|
| **git clone** | **~15～30 MB** | 仓库跟踪文件本身约 **10MB**；`target/`/`node_modules` **已 gitignore** |
| **Core 构建后** | **~300～600 MB** | 主要是 `node_modules` + `dist` + dcg |
| **含 terminal-engine 且清理缓存后** | **~0.4～0.8 GB** | 默认 `build-native` **删掉 Rust `target`**，只留 `.node` |
| **若保留 cargo target / 编 ratatui debug** | **2～3 GB+** | 开发机常见；用 `scripts/clean-build-cache.sh` 可砍回 |

构建脚本默认：

- `CARGO_TARGET_DIR` 放在系统临时目录（不堆在仓库里）
- 只做 **release** 原生构建
- 结束时 **清理** `**/target`（开发迭代可加 `--keep-target` / `-KeepTarget`）

```bash
bash scripts/clean-build-cache.sh        # 清 target，保留 node_modules
bash scripts/clean-build-cache.sh --all  # 连 node_modules 也删（需重装）
```

---

## 支持矩阵（诚实）

| 能力 | Core 成功后 | 额外条件 | 缺失时兜底 |
|------|-------------|----------|------------|
| 启动 Ink TUI / 对话 | ✅ | — | — |
| 文件 read/write/edit | ✅ | — | — |
| grep / glob | ✅ | 有 `rg` 更快 | **Node 实现** |
| MCP | ✅ | 用户配置 server | — |
| 压缩 / 会话 | ✅ | — | — |
| use_terminal 完整 | △ | `build-native` + Rust(+Win VS) | **降级 spawn，弱交互** |
| 危险命令门 DCG | △ | `ensure-dcg` 成功 | **弱/失败关闭** — 非生产基线 |
| find_code (sqry) | △ | 自装 `sqry` | **工具不可用** |
| ratatui TUI | △ | 自建二进制 | **Win 默认 Ink** |
| 与 mac 命令语义完全一致 | ❌ | — | 优先内置工具，勿依赖 bash 脚本 |

**不能保证**：任意 Windows 用户「装完即与开发者 Mac 全功能零缺陷」。

---

## 安装

### macOS / Linux

```bash
git clone <maou-sdk-url> && cd maou-sdk
bash scripts/install.sh          # Core 失败 → exit 1
export PATH="$HOME/.maou/bin:$PATH"
maou doctor                      # 看 Core / Terminal / Optional
maou setup
maou coding
```

完整原生（可选）：

```bash
bash scripts/build-native.sh
```

### Windows（原生 PowerShell，不要 WSL）

建议先装：Node 20、pnpm、Git；完整终端再加 Rust(MSVC)+VS C++ Build Tools。

```powershell
git clone <maou-sdk-url>
cd maou-sdk
powershell -ExecutionPolicy Bypass -File scripts\install.ps1   # Core 失败 → exit 1
$env:Path = "$env:USERPROFILE\.maou\bin;" + $env:Path
maou doctor
maou setup
maou coding
```

---

## doctor 分档

```text
maou doctor
── Core（必须）     → 失败 exit 1，不能启动
── Terminal（建议） → △ 可启动，终端/安全降级
── Optional         → △ find_code 等
```

启动时：Core 不过直接退出；Terminal/dcg 缺失只警告。

---

## 脚本

| 脚本 | 行为 |
|------|------|
| `install.sh` / `install.ps1` | **Core fail-closed**；写 wrapper；dcg 尽量装 |
| `build-native.*` | Core + 本机 napi/可选 ratatui |
| `ensure-dcg.mjs` | 跨平台下载 dcg |

---

## 在 Mac 上测 Windows

见 [docs/WINDOWS-TEST-ON-MAC.md](./docs/WINDOWS-TEST-ON-MAC.md)（真机/UTM/Actions；Docker-for-Mac 不行）。
