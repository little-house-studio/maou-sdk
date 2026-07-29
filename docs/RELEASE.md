# 发布流程（维护者）

目标：**用户永远不需要编译**。你 push，CI 编，用户 `maou update` 就拿到。

---

## 一图流

```
你 push tag v0.1.1
   ↓
GitHub Actions「Release bundles」
   ↓  6 个平台并行
   ├─ cargo 编 terminal-engine (.node) + maou-tui-ratatui
   ├─ pnpm install && pnpm -r build
   └─ scripts/build-release-bundle.mjs → maou-<platform>.tar.gz|.zip
   ↓
Release v0.1.1
   ├─ maou-darwin-arm64.tar.gz   ← 用户下载这个
   ├─ maou-darwin-x64.tar.gz
   ├─ maou-linux-x64.tar.gz
   ├─ maou-linux-arm64.tar.gz
   ├─ maou-win32-x64.zip
   ├─ maou-win32-arm64.zip
   ├─ manifest.json              ← maou update 读它比对版本
   └─ SHA256SUMS.txt
   ↓
用户 `maou update` → 下载 → 校验 sha256 → 切换版本目录
```

---

## 两条通道

| 通道 | 触发 | Release tag | 谁会拿到 |
|------|------|-------------|----------|
| **stable** | push tag `v*` | 该 tag | 默认安装的用户；`maou update` |
| **dev** | push `develop` | `bundle-dev`（滚动 prerelease） | `MAOU_CHANNEL=dev` 安装的用户 |

用户可以随时切：`maou update --channel dev` / `--channel stable`。

---

## 发正式版

```bash
# 1. 定版本（三处保持一致：cli/package.json 是权威）
#    必须是合法 semver —— 自更新靠版本比较
vim cli/package.json      # "version": "0.1.1"

# 2. 提交并打 tag
git commit -am "release: v0.1.1"
git tag v0.1.1
git push origin develop --tags
```

CI 自动跑完，Release `v0.1.1` 就带齐 6 个平台的包。

## 发滚动开发版

push 到 `develop` 就会刷新 `bundle-dev`。不想每次 push 都发的话，把
`.github/workflows/release.yml` 里 `push.branches` 那行去掉，改用手动触发。

## 手动触发

GitHub → **Actions** → **Release bundles** → **Run workflow**
- `channel`: `dev` 或 `stable`
- `tag`: 留空则按通道取默认（stable 必须填或从 tag 触发）

---

## 本地打包（调试流水线用）

```bash
pnpm bundle                      # 当前平台，dev 通道 → .release/
pnpm bundle:stable               # stable 通道
node scripts/build-release-bundle.mjs --skip-build --keep-stage   # 复用 dist，保留解压目录
```

交叉打包（原生件必须外部注入）：

```bash
# 例：在 Apple Silicon 上给 Intel Mac 打包
cargo build --release --target x86_64-apple-darwin --manifest-path terminal-engine/Cargo.toml
cargo build --release --target x86_64-apple-darwin --manifest-path cli/tui-ratatui/Cargo.toml

node scripts/build-release-bundle.mjs \
  --target darwin-x64 \
  --engine terminal-engine/target/x86_64-apple-darwin/release/libterminal_engine.dylib \
  --tui    cli/tui-ratatui/target/x86_64-apple-darwin/release/maou-tui-ratatui
```

`dcg` / `rg` / `sqry` 会按 `--target` 自动下载对应平台的版本（不需要额外参数）。
`ddgr` 是跨平台 Python 脚本，无平台差异；Windows 目标会额外生成 `ddgr.cmd` shim。

本地试跑打出来的包：

```bash
mkdir -p /tmp/t && tar -xzf .release/maou-darwin-arm64.tar.gz -C /tmp/t
/tmp/t/maou-*/bin/maou --version
/tmp/t/maou-*/bin/maou doctor --check
```

---

## 包里有什么

```
maou-0.1.1-darwin-arm64/
├── RELEASE.json      版本 / 通道 / commit / 平台 —— CLI 据此判定「免构建形态」
├── package.json
├── dist/             已编译的 CLI
├── node_modules/     全部生产依赖（hoisted，无需任何安装）
├── scripts/          ensure-*.mjs（doctor 修复时**只下载**，不编译）
├── vendor/bin/       dcg · rg · sqry · maou-tui-ratatui（本平台原生）+ ddgr（Python 脚本）
└── bin/maou[.cmd|.ps1]
```

约 39 MB（tar.gz）。用户端只要 Node ≥ 20。

`RELEASE.json` 是形态开关：CLI 检测到它就进入 **bundle 模式** —— 所有
`pnpm install` / `pnpm build` / `cargo build` 修复路径全部关闭，缺组件一律走下载。

---

## 平台矩阵

| 平台 | Runner | 方式 | 必需 |
|------|--------|------|------|
| darwin-arm64 | `macos-14` | 原生 | ✅ |
| darwin-x64 | `macos-14` | 交叉（x86_64-apple-darwin） | ✅ |
| linux-x64 | `ubuntu-22.04` | 原生 | ✅ |
| linux-arm64 | `ubuntu-22.04-arm` | 原生 | ⚠ optional |
| win32-x64 | `windows-latest` | 原生 | ✅ |
| win32-arm64 | `windows-11-arm` | 原生 | ⚠ optional |

两个 ARM runner 标记 `optional: true` + `fail-fast: false`：如果你的账户/仓库
拿不到 ARM runner，**其余平台照常发布**，不会整条流水线红掉。之后拿到了再重跑。

若某平台缺席，该平台用户的安装器会明确报「该平台尚未构建」，不会装出一个坏的包。

---

## 更新如何到达用户

用户侧 `maou update` 做的事：

1. 读本地 `RELEASE.json` → 拿 repo / 通道 / 平台 / commit
2. 查对应 Release 的 `manifest.json`，取本平台条目
3. 版本或 commit 有变 → 下载 `maou-<platform>.tar.gz`
4. 校验 sha256（对不上直接拒绝安装）
5. 解压到 `~/.maou/versions/<新版本>/`，把 `~/.maou/current` 指过去
6. 保留最近 2 个旧版本目录，可手动回滚

`~/.maou/bin/maou` 启动器读的是 `current`，所以换版本不用改 PATH、不用重装。

**不会**自动杀掉正在跑的 TUI —— 用户需要手动退出再开。

### 回滚

```bash
ls ~/.maou/versions
ln -sfn ~/.maou/versions/maou-0.1.0-darwin-arm64 ~/.maou/current   # macOS / Linux
```

Windows：删掉 `%USERPROFILE%\.maou\current` 后重建 junction，或改
`%USERPROFILE%\.maou\current.path` 里的路径。

---

## 只想重刷裸原生件

改了 Rust、不想走整条 bundle 流程：

GitHub → Actions → **Native prebuilds (manual)** → Run workflow

它只更新 Release `native-prebuilds`（源码树开发者的 `ensure-*` 从这里拉）。
注意这个 Release 也被 `release.yml` 写，别让两者同时跑。

---

## 检查清单

发版前：

- [ ] `pnpm -r build` 本机通过
- [ ] `pnpm -r test` 通过
- [ ] `cli/package.json` 的 `version` 是合法 semver 且已递增
- [ ] `pnpm bundle` 本地能打出包，且 `bin/maou --version` / `doctor --check` 正常

发版后：

- [ ] Release 页面 6 个平台资产齐全（或已知缺哪个）
- [ ] `manifest.json` 里的 `version` 与 tag 一致
- [ ] 找一台干净机器跑一次安装脚本
