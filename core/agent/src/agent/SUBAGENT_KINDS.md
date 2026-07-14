# Subagent 类型系统

## 四类

| kind | 简介 | loop | 持久化默认 | 进 Executor | 进管理列表 | 运行通道 |
|------|------|------|------------|-------------|------------|----------|
| **fork** | 母上下文完整复制的分支 | ✅ | ✅ | ✅ | ✅ | executor |
| **helper** | 单轮小任务 | ❌ | ❌ | 仅 persist=true | 仅 persist=true | aux / executor |
| **task** | 专业子任务 | ✅ | ✅ | ✅ | ✅ | executor |
| **project** | 路径驻扎小型 coding | ✅ | ✅ | ✅ | ✅ | executor |

**kill 的 agent 永不出现在管理列表。**

## 多态策略（减少重复）

```
BaseSubagentPolicy
  ├─ ForkSubagentPolicy     inheritFullContext + executor
  ├─ HelperSubagentPolicy   stripTools；!persist → AuxModelCaller
  ├─ TaskSubagentPolicy     预设白名单；可选 hard path
  └─ ProjectSubagentPolicy  pathGuard audit + coding 白名单
```

共享：
- `resolveSubagentRunPlan` / `materializeIfNeeded`
- `createDefaultSubagentRunFn`（facade 与 harness 共用，防漂移）
- `PathGuard` / `resolveToolPath`（工具层硬约束）

## 存储路径

| scope | 路径 |
|-------|------|
| nested（默认） | `agents/<parent>/subagents/<name>/` |
| nested + ephemeral | `agents/<parent>/subagents/.tmp/<name>/` |
| peer | `agents/<name>/` |
| shared | `agents/.shared/<name>/` |

## 上下文

- **fork**：`inherit_full_context=true` → `sessionStore.forkSession(parent, title, subId)` 完整复制
- **task/project/helper**：默认不整包继承

## 工具与路径

- **helper 单轮**：强制 `tools=[]`，不继承 MCP，`agentMode=false`
- **task**：预设 `explore | web_search | report | file_search | coding_scoped`
- **project**：coding 白名单 + `PathGuard`（primary free / auditRoots needsAudit / 外禁）
- **fork**：默认继承母工具

## 超轮次

`roundLimit > 0` → `softRequestBudget`；超限 wrap-up，超 1.5x abort。

## 入口

| 入口 | 默认 kind | 说明 |
|------|-----------|------|
| `agent_message` fork | **fork** | 暴露 kind/path/tool_preset/persist… |
| `subagent_<name>` | 读 agent.json | 文件即子 Agent（`loadSubagentKindOptions`） |
| `agent_manage` dispatch | 读 agent.json / **task** | 队友后台 fork，同源 kind 加载 |
| todo 真 fork | **fork** | inheritFullContext |
| helper !persist | aux | 自动 AuxModelCaller |
| **终端审核 auto** | **helper** | `installTerminalReviewer` → Aux 单轮 JSON，tag=`helper:terminal_auto_review` |

### 内置 helper：终端审核模式 auto

CLI 审核模式 `auto`（`sandboxMode=auto` / `terminal_mode=auto`）时：

1. 白名单 → 直接放行  
2. 黑名单 → 拒绝  
3. 非名单 → **helper 辅助 agent** 审核（`TERMINAL_AUTO_REVIEW_HELPER`）  
   - 单轮、无 tool  
   - `AuxModelCaller.callJson`  
   - 优先 helper/fast 小模型  
   - **不**进 SubagentExecutor / 管理列表  
   - 通过 → 入白名单；拒绝 → 入黑名单（可二次同命令确认）

```ts
import {
  installTerminalReviewer,
  TERMINAL_AUTO_REVIEW_HELPER,
} from "@little-house-studio/agent";
// coding / harness 启动时已安装；语义 = helper
```

### 内置子 agent 模板（`templates/subagents/`）

| 模板 | subagent_kind | tool_preset | permission |
|------|---------------|-------------|------------|
| explore | task | explore | readonly |
| reviewer | task | explore | readonly（+ llm_judge） |
| tester | task | coding_scoped | scoped_write |

`team-factory` 物化时会 `ensureSubagentKindFields`，旧目录缺字段也会补齐。

## API

```ts
import {
  defineSubagent,
  materializeSubagent,
  listManagedSubagents,
  killSubagent,
  resolveSubagentRunPlan,
  getSubagentPolicy,
  createDefaultSubagentRunFn,
} from "@little-house-studio/agent";

// 声明 + 物化
const def = defineSubagent({
  kind: "project",
  name: "feat-x",
  path: "/work/app",
  auditPaths: ["/work/shared"],
  parentAgentName: "coding",
  systemPrompt: "...",
});
materializeSubagent(def, { maouRoot });

// 运行
await executor.fork("t1", "实现功能", {
  kind: "project",
  path: "/work/app",
  auditPaths: ["/work/shared"],
});

// 非持久 helper → Aux（自动）
await executor.fork("h1", "一句话总结", { kind: "helper" });
```
