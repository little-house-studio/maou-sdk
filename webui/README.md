# @little-house-studio/webui

Maou **WebUI**（SDK 层）：对话 + **Agent 真实终端** + **Markdown 编辑器**。

设计说明见 [DESIGN.md](./DESIGN.md)。

### 终端面板做什么

- 右侧列出 Agent 通过 `use_terminal` 创建的会话（来自 `terminal-engine`，不是旁路本地 shell）
- 点击列表项或聊天里带 `terminal_id` 的工具行 → xterm 附着真实输出
- 键盘输入经 `write` 写回进程（WebUI 默认 `MAOU_PTY_FORCE=1` 真 PTY；管道模式不可交互）
- 可停止会话

### Markdown 编辑器做什么

- 顶栏 **Markdown** 视图：扫描项目内 `.md` / `.mdx` / `.markdown`
- **独立大模块** `src/client/markdown/`（`MarkdownWorkbench`），后端 `src/server/markdown/`
- 文件树 · 需求大纲工作台 / 源码编辑（二选一，默认大纲）
- 面向 PRD：进度仪表盘、筛选、钻取、`- [ ]` 验收；设计见 `markdown/DESIGN.md`
- 示例：`webui/docs/sample-prd.md`

## 开发

```bash
# 在 monorepo 根
pnpm install
pnpm --filter @little-house-studio/webui build

# 生产模式启动（需先 build）
pnpm --filter @little-house-studio/webui start
# 打开 http://127.0.0.1:8787
```

开发（双进程）：

```bash
cd webui
pnpm run build:server   # 至少一次
pnpm run dev            # Vite :5173 + API 代理到 :8787
# 另开：pnpm run dev:server
```

或：

```bash
pnpm --filter @little-house-studio/webui exec tsx src/server/cli.ts
```

## API

| | |
|--|--|
| `POST /api/chat` | NDJSON StreamEvent |
| `POST /api/chat/abort` | 中断 |
| `GET /api/meta` | session / model / cwd / agentName |
| `GET /api/fs/md-tree` | 项目内 Markdown 文件树 |
| `GET /api/fs/file?path=` | 读 `.md` |
| `PUT /api/fs/file` | 写 `.md` |
| `POST /api/fs/file` | 新建 `.md` |
| `GET /api/terminals` | Agent 终端列表（`?agent=` / `?all=1`） |
| `GET /api/terminals/:id/logs` | 日志快照 |
| `POST /api/terminals/:id/write` | 写入 stdin |
| `POST /api/terminals/:id/stop` | 停止 |
| `WS /ws/agent-terminal?id=&agent=` | 附着实时输出 + 输入 |

默认 **仅绑定 127.0.0.1**（本机工具，非公网）。

## 与 CLI

| CLI | WebUI |
|-----|-------|
| `maou coding`（Ratatui） | `maou-web` / `node dist/server/cli.js` |
| 同一 coding-agent + terminal-engine | 同一 coding-agent + terminal-engine |
