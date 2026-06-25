# @little-house-studio/coding-agent

Maou SDK 编程 Agent —— **绑定项目目录后驻扎的编码服务**。

基于通用运行时门面 [`@little-house-studio/agent-runtime`](../runtime)，叠加编程场景特化：

- **编程工具白名单**（`CODING_TOOL_WHITELIST`：读写/检索/终端）
- **编程角色提示词**（`src/prompt/`，默认复用共享 `ROLE/`）
- **CLI 调试接口**（`./cli`，薄接口，富 TUI 在 `@little-house-studio/cli` 层复用）

## 用法

```ts
import { createCodingAgent, runCodingAgentCli } from "@little-house-studio/coding-agent";

const agent = createCodingAgent({
  projectRoot: process.cwd(),     // 绑定并驻扎到此项目
  configStore, sessionStore, toolRegistry, llmClient,  // 应用层注入
});

// 调试：用一条消息驱动，逐事件回调（cli 层渲染）
await runCodingAgentCli("帮我重构 auth 模块", {
  agent,
  preset,
  onEvent: (ev) => { /* cli 层渲染 */ },
});
```

## 定位

这是一个**服务**：界面内容少，CLI 部分只是特化 + 必要接口。
后续会有更多不同 agent，各自只暴露薄接口，由 cli 层统一渲染、接口复用。

## 迁移说明

从 maou-agent 复制而来（`harness/runtime.ts` → 上提至 `agent-runtime` 共享包）。
通用 AgentRuntime 门面归 `agent-runtime`，本包只保留编程特化部分。
`harness/server.ts`（Express Web 服务，半迁移残骸 + 非编程专属）未搬。
