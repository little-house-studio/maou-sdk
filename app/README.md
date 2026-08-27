# @little-house-studio/app

Maou 桌面客户端：对话 + Agent 真实终端 + Markdown。三端：macOS / Windows / Linux。没有浏览器入口。

设计见 [DESIGN.md](./DESIGN.md)。

## 开发

```bash
# monorepo 根
pnpm install
pnpm --filter @little-house-studio/app dev
```

`dev` 只开 Electron 窗口。界面热更新走 Vite（仅 Electron UA），业务走进程内 host + IPC，不监听业务 TCP 端口。

## 打包

```bash
pnpm --filter @little-house-studio/app pack        # 当前系统
pnpm --filter @little-house-studio/app pack:mac
pnpm --filter @little-house-studio/app pack:win
pnpm --filter @little-house-studio/app pack:linux
```

产物在 `app/release/`。

## 与 CLI

| CLI | App |
|-----|-----|
| `maou coding`（Ratatui） | 打包客户端 / `pnpm dev` |
| 同一 coding-agent + terminal-engine | 同一套 runtime |
