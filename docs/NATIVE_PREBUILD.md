# 裸原生件预编译（terminal-engine + maou-tui）

> **普通用户不需要这一页。**
> 用户装的是 Release 上的**免构建整包**（`maou-<platform>.tar.gz|.zip`），原生件已经在包里。
> 装法见 [`INSTALL.md`](../INSTALL.md)，发布流程见 [`RELEASE.md`](./RELEASE.md)。
>
> 这一页讲的是 Release **`native-prebuilds`** 里的**裸** `.node` / TUI 二进制，
> 只服务于 **git clone 的源码树开发者**：没装 Rust 时靠它跳过编译。

## 源码树开发者怎么用

```bash
pnpm setup:dev        # 内部会按需调用下面两个脚本
```

或单独调用：

- `node scripts/ensure-terminal-engine.mjs`
- `node scripts/ensure-maou-tui.mjs`

从 GitHub Release **`native-prebuilds`**（或 `MAOU_NATIVE_TAG`）拉取当前平台资产。

有 Rust 的话可以直接本机编，不必依赖这个 Release：

```bash
pnpm --filter @little-house-studio/terminal-engine run build:force
cd cli && npm run build:tui-ratatui
```

### 环境变量

| 变量 | 含义 |
|------|------|
| `MAOU_NATIVE_TAG` | Release 标签，默认 `native-prebuilds` |
| `MAOU_NATIVE_REPO` | `owner/repo`，默认 `little-house-studio/maou-sdk` |
| `MAOU_NATIVE_SKIP=1` | 跳过下载 |
| `MAOU_BUILD_NATIVE=1` | 下载失败时允许本机 `cargo` 构建引擎 |
| `MAOU_NATIVE_FORCE_BUILD=1` | 强制本机构建、不下载 |
| `GITHUB_TOKEN` | 私有仓库或提高 API 限额时可选 |

## 维护者：如何刷新裸原生件

**多数时候你不需要单独跑它** —— `release.yml`（Release bundles）每次发布都会
顺带刷新 `native-prebuilds`。以下只用于「只改了 Rust，不想走完整 bundle 流程」。

### 方式 A：手动跑 Actions

1. GitHub → **Actions** → **Native prebuilds (manual)**
2. **Run workflow**
3. 等 matrix 完成；会更新 Release **`native-prebuilds`**

**不需要**你本人坐在 Windows 电脑上编译；`windows-latest` runner 会编 Windows 版。

### 方式 B：打 tag

```bash
git tag native-v0.1.0
git push origin native-v0.1.0
```

> ⚠ `release.yml` 和本 workflow 都会写 `native-prebuilds`。别让它们同时跑，
> 否则后完成的那个会覆盖前一个。本 workflow 已经取消了 `push develop` / `v*`
> 自动触发，就是为了避免这种竞争。

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

1. 在 Actions 里跑一次 **Release bundles**（它同时产出用户包和裸原生件）
2. 确认 Release `native-prebuilds` 下有各平台 `.node`
3. 确认发布 Release 下有 `maou-<platform>.tar.gz|.zip` 和 `manifest.json`

在此之前，`ensure-*` 会警告并跳过；有 Rust 的开发者可本机构建
（`pnpm setup:dev` 会自动走这条路）。
