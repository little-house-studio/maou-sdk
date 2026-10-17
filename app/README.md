# @little-house-studio/app

Maou 桌面客户端：对话 + Agent 真实终端 + Markdown。三端：macOS / Windows / Linux。没有浏览器入口。

设计见 [DESIGN.md](./DESIGN.md)。

## 形态

- **壳**：Tauri 2（`src-tauri/`，Rust + 系统 WebView）。开窗、菜单、选文件夹 / 在文件夹中显示，并把页面的 `/api/*`、`/ws/*` 转到 hub。
- **hub**：Node 子进程（`dist/desktop/hub-main.js`，AgentHub）。只听 unix socket / named pipe，不监听业务 TCP 端口。
- **页面**：Vite + React（`src/client/`），经 `window.maouApp`（`tauri-bridge.ts`）与壳通信。

hub 跑在本机 Node 上（>= 20）。从 Finder / 开始菜单启动时壳会问登录 shell 要 PATH 找 `node`；找不到就设 `MAOU_NODE=/path/to/node`。

## 开发

需要 Rust 工具链（`rustup`）和各平台的 Tauri 依赖（Linux 要 webkit2gtk，见 Tauri 文档）。

```bash
# monorepo 根
pnpm install
pnpm --filter @little-house-studio/app dev
```

`dev` = `tauri dev`：先构建 hub、起 Vite（界面热更新），再编译运行壳。`pnpm -r build` 只构建 TS / Vite / hub，不编 Rust。

## 打包

```bash
pnpm --filter @little-house-studio/app pack        # 当前系统全部格式
pnpm --filter @little-house-studio/app pack:mac    # .app + .dmg
pnpm --filter @little-house-studio/app pack:win    # NSIS
pnpm --filter @little-house-studio/app pack:linux  # AppImage + deb
```

打包先 `stage:hub`（`pnpm deploy` 出自包含的 hub 目录 → `.tauri-stage/hub`），再作为资源打进安装包（`src-tauri/tauri.pack.conf.json`）。原生件只有本机平台的，必须在目标平台上打包。产物在 `src-tauri/target/release/bundle/`。

图标：`resources/icon.png`（`scripts/build-icon.mjs` 生成）→ `pnpm tauri icon resources/icon.png -o src-tauri/icons`。

## 与 CLI

| CLI | App |
|-----|-----|
| `maou coding`（Ratatui） | 打包客户端 / `pnpm dev` |
| 同一 coding-agent + terminal-engine | 同一套 runtime |
