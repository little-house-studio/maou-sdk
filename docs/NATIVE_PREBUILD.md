# 原生预编译（terminal-engine + maou-tui）

用户**默认不需要**安装 Rust / Visual Studio C++ Build Tools。  
维护者在 CI 上编译，安装脚本自动下载。

## 用户怎么用

```bash
git clone https://github.com/little-house-studio/maou-sdk.git
cd maou-sdk
# 只需 Node ≥20 + pnpm
npm i -g pnpm
bash scripts/install.sh          # Windows: scripts\install.ps1
maou doctor
```

`install` / `pnpm postinstall` 会调用：

- `node scripts/ensure-terminal-engine.mjs`
- `node scripts/ensure-maou-tui.mjs`

从 GitHub Release **`native-prebuilds`**（或 `MAOU_NATIVE_TAG`）拉取当前平台资产。

### 环境变量

| 变量 | 含义 |
|------|------|
| `MAOU_NATIVE_TAG` | Release 标签，默认 `native-prebuilds` |
| `MAOU_NATIVE_REPO` | `owner/repo`，默认 `little-house-studio/maou-sdk` |
| `MAOU_NATIVE_SKIP=1` | 跳过下载 |
| `MAOU_BUILD_NATIVE=1` | 下载失败时允许本机 `cargo` 构建引擎 |
| `MAOU_NATIVE_FORCE_BUILD=1` | 强制本机构建、不下载 |
| `GITHUB_TOKEN` | 私有仓库或提高 API 限额时可选 |

## 维护者：如何发布预编译

### 方式 A：手动跑 Actions（推荐）

1. 打开 GitHub → **Actions** → **Native prebuilds**
2. **Run workflow**（选 `develop` 或 `main`）
3. 等待 matrix 完成；会更新 Release **`native-prebuilds`**
4. 用户再装即可拉到最新产物

**不需要**你本人坐在 Windows 电脑上编译；`windows-latest` runner 会编 Windows 版。

### 方式 B：打 tag

```bash
git tag native-v0.1.0
git push origin native-v0.1.0
```

会创建/更新同名 Release 并附上各平台文件。

### 方式 C：push 到 `develop`

当前 workflow 在 push `develop` 时也会刷新 `native-prebuilds`（滚动预发布）。

## 本机构建（开发者改引擎时）

```bash
# 需 Rust；Windows 另需 VS C++ Build Tools
MAOU_BUILD_NATIVE=1 node scripts/ensure-terminal-engine.mjs --build
# 或完整：
bash scripts/build-native.sh
```

## 资产命名

| 文件 | 平台 |
|------|------|
| `terminal_engine.darwin-arm64.node` | Apple Silicon |
| `terminal_engine.darwin-x64.node` | Intel Mac |
| `terminal_engine.linux-x64-gnu.node` | Linux x64 |
| `terminal_engine.win32-x64-msvc.node` | Windows x64 |
| `maou-tui-ratatui-darwin-arm64` 等 | Ratatui TUI |

与 `terminal-engine/load.mjs` 的探测逻辑一致。

## 首次仓库还没有 Release 时

1. 先合并本 workflow 到 `develop` 并 push  
2. 在 Actions 里手动跑一次 **Native prebuilds**  
3. 确认 Release `native-prebuilds` 下有各平台 `.node`  
4. 再让用户安装  

在此之前，`ensure-*` 会警告并跳过；有 Rust 的开发者可本机构建。
