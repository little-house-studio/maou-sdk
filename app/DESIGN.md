# WebUI 层设计（@little-house-studio/webui）

## 目标

在 **SDK 内**提供与 CLI 并列的 Web 入口：

- 对话（流式 StreamEvent）
- **内置终端**（xterm.js + Agent use_terminal 真实会话）
- **Markdown 编辑器**（.md 文件树、CodeMirror；文档大纲 = 自研解析/钻取 UI）
- 不复刻 maou-agent 旧像素 Web 的重 UI；先做干净、可嵌入的开发者界面

## 与 CLI 的关系

| | CLI | WebUI |
|--|-----|-------|
| 视图 | Ratatui 原生 TUI | 浏览器 |
| 业务 | headless/store 可选 | 直接 Runtime + 轻量 session |
| 终端 | 工具层 use_terminal | 右侧列表 + xterm 附着真实会话（查看/交互） |
| 入口 | `maou coding` | `maou web` / `npx … webui` |

**共用**：`@little-house-studio/agent` / `coding-agent` / `types` StreamEvent。  
**不共用**：CLI 的 Zustand/Ratatui 协议（避免 Web 绑死 TUI 快照）。

## 架构

```
Browser
  ├─ Chat | Markdown | Split 视图切换
  ├─ ChatPanel  ──HTTP POST /api/chat (NDJSON StreamEvent)
  │              点击 use_terminal 工具行 → 打开右侧会话
  ├─ Terminal   ──列表 engine.list + 附着 engine.logs/write
  │                WS /ws/agent-terminal?id=&agent=
  └─ MarkdownWorkbench  client/markdown/（独立大模块）
       ├─ file-tree / doc-outline / editor
       └─ server/markdown  GET|PUT|POST /api/fs/*

Node createWebUiServer()
  ├─ AgentHub            coding-agent Runtime
  ├─ agent-terminals     @little-house-studio/terminal-engine
  ├─ fs-api              projectRoot 内 Markdown 读写
  └─ static              Vite client
```

**不是**旁路再开一个 shell，而是 **Agent `use_terminal` 真实会话**：
list / logs 轮询 / write 键盘输入 / stop。

## API（MVP）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 静态 SPA |
| GET | `/api/health` | 健康检查 |
| POST | `/api/chat` | NDJSON StreamEvent |
| POST | `/api/chat/abort` | 中断 |
| GET | `/api/terminals` | agent 终端列表 |
| GET | `/api/terminals/:id/logs` | 日志快照 |
| POST | `/api/terminals/:id/write` | 键盘输入 |
| POST | `/api/terminals/:id/stop` | 停止 |
| WS | `/ws/agent-terminal?id=&agent=` | 附着实时输出 + input |
| GET | `/api/fs/md-tree` | 项目内 Markdown 树 |
| GET | `/api/fs/file?path=` | 读 .md |
| PUT | `/api/fs/file` | 写 .md |
| POST | `/api/fs/file` | 新建 .md |

## 安全（MVP 约束）

- **默认只监听 127.0.0.1**（本机工具，非公网）
- 无多用户鉴权；后续再加 token
- 终端即本机 shell，与 CLI yolo 同样危险，文档标明

## 分期

1. **MVP（已实现）**：聊天流 + 内嵌终端 + 本机绑定  
2. **工作流对齐 CLI（已实现）**：项目会话 list/new/switch/clear/delete/rename、模型切换、审批 normal/auto/yolo + 待批卡片、slash 本地 + Runtime 透传（`/compact` `/usage` `/context` `/init` `/goal`）、last-session 恢复、export/retry/busy 队列、会话 stats  
3. **Codex-desktop 布局（已实现）**：左 threads、中对话、右 Terminal/Files；Work/Docs/Lab 工作区  
4. 挂接 terminal-engine 事件总线（可选增强，非阻塞）  
5. 预编译二进制 / 一键安装时一并带上 web 静态资源（发布期）  

### 非目标（不与 CLI 1:1 复刻）

- Ratatui 协议 / Zustand TUI 快照、启动画廊、音效、PerfHUD、主题编辑器  
- `doctor` / `update` 系统命令壳、完整 Agent 多产品管理面板、监督模式专用 chrome  

### 工作流 API（在 MVP 之上）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/sessions` | 列出会话（SessionStore） |
| POST | `/api/sessions` | 新会话 |
| POST | `/api/sessions/switch` | 切换会话 + 返回历史消息 |
| POST | `/api/sessions/clear` | 清空会话消息 |
| POST | `/api/sessions/delete` | 删除会话 |
| POST | `/api/sessions/rename` | 重命名会话标题 |
| GET | `/api/sessions/active/export` | 导出当前会话 transcript（text/plain） |
| GET | `/api/sessions/active/messages` | 当前会话历史 |
| （启动） | `GET /api/meta` | 恢复 `last-session.json` + 可选 `messages` 历史 |
| GET/POST | `/api/approval` | 读/设审批模式 |
| GET | `/api/approvals/pending` | 待批终端命令 |
| POST | `/api/approvals/:id` | once/always/deny/blacklist |
| GET | `/api/models` | providers + models |
| POST | `/api/model` | 切换 provider/model |
| POST | `/api/command` | slash 等价（new/stop/model/approval/help/usage/analyze…） |
| GET | `/api/sessions/active/stats` | 当前会话 token/消息统计 |

## 包布局

```
webui/
  package.json          @little-house-studio/webui
  DESIGN.md
  README.md
  src/server/           Express + ws
  src/client/           Vite + React + xterm
  dist/                 server + client 构建产物
```
