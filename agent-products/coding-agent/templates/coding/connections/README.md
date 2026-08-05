# Coding Agent — MCP connections

## 行业标准配置（推荐）

与 Claude Desktop / Cursor / Claude Code 相同形状的 **`mcpServers` JSON**：

| 优先级（后写覆盖） | 路径 |
|--------------------|------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor 用户 | `~/.cursor/mcp.json` |
| Claude Code 用户 | `~/.claude.json` 内的 `mcpServers` |
| **Maou 用户** | **`~/.maou/mcp.json`** |
| 项目 | `<project>/.mcp.json`、`<project>/.cursor/mcp.json`、`<project>/.maou/mcp.json` |
| Agent 级 | `~/.maou/agents/<name>/mcp.json`、`connections/*.json` |

示例（`~/.maou/mcp.json`）：

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/mcp-sandbox"]
    }
  }
}
```

用户只需像装 Cursor/Claude 一样写 `command`/`args`/`env`/`url`，**无需自创协议字段**。

## 旧式单文件 connections/

| 位置 | 路径 |
|------|------|
| 全局 | `~/.maou/agents/coding/connections/*.json` |
| 项目级 | `<project>/.maou/agents/coding/connections/*.json`（同名覆盖） |

## 运行时行为（合规）

1. **tools/list** → 注册 `mcp__<server>__<tool>` → 进入 LLM **tool schema**（主通道）  
2. **system prompt** 注入 `<mcp_servers>` catalog（辅通道，数据来自 list，非自造 tool）  
3. 模型 tool_call → **tools/call**；`isError` 与协议错误区分  

```text
mcp__<连接名>__<MCP工具名>
```

## 快速试跑（内置 echo fixture）

SDK 自带 stdio 冒烟 server：

```text
maou-sdk/core/agent/scripts/mcp-echo-fixture.mjs
```

在 `~/.maou/agents/coding/connections/echo.json` 写入（把路径换成你机器上的绝对路径）：

```json
{
  "type": "mcp",
  "description": "Demo echo MCP for coding smoke",
  "command": "node",
  "args": ["/ABS/PATH/TO/maou-sdk/core/agent/scripts/mcp-echo-fixture.mjs"],
  "transport": "stdio",
  "enabled": true
}
```

或一键冒烟（不依赖真实 LLM）：

```bash
cd maou-sdk/core/agent && pnpm build
node scripts/mcp-coding-smoke.mjs
```

成功时会调用 `mcp__echo__echo` / `mcp__echo__ping` 并打印 JSON 摘要。

## 字段说明

| 字段 | 说明 |
|------|------|
| `type` | 必须 `"mcp"` |
| `command` / `args` | stdio 子进程（本地 server） |
| `url` | 远程 SSE / Streamable HTTP |
| `transport` | `stdio` \| `sse` \| `streamable-http` \| `auto` |
| `enabled` | `false` 则跳过 |
| `env` / `cwd` | 可选，stdio 环境 |

`command` / `args` 支持 `${ENV_VAR}` 展开。

## 热加载（配置文件）

- **不会**自动安装/启用未写在配置里的 MCP。
- 编辑 `mcp.json` 或 `connections/*.json`（含 `enabled: false`）后，**下一条用户消息**进入 agent `run` 时会按配置指纹热重载：
  - 新增/启用 → 连接新 server
  - 删除/禁用 → 断开
  - 未改动的 server → **保持进程**，不强制重启
- 无需退出整个 CLI；同一会话内改配置后发一句新消息即可。
- 若本轮 `run` 已开始后才改文件，需再发一条消息才会加载。
