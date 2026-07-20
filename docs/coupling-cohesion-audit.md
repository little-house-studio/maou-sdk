# maou-sdk 低耦合 / 高内聚差距清单

> **性质**：静态代码审计（import / 包边界 / 模块职责），不改实现。  
> **范围**：`core/*`、`cli`、`webui`、`agent/*`、`*-engine`、共享 types/config；不含 `dist/`、`node_modules/`、vendor 二进制。  
> **原则**：只列「按分层意图本应更低耦合或更高内聚、但现状未做到」的可核对点；纯风格与未请求的大重写不在列。  
> **审计日期**：2026-07-20。

---

## 0. 包边界意图（对照基线）

| 包 | 意图（来自 package 描述 / DESIGN / index） | 直接 workspace 依赖 |
|---|---|---|
| `@little-house-studio/types` | 基础领域类型 + 配置，**不**依赖其它 maou 包 | 无 |
| `@little-house-studio/prompt` | 提示词编译 | types |
| `@little-house-studio/context` | 会话、压缩、消息构建 | prompt |
| `@little-house-studio/llm` | 模型协议 / 客户端 / 极简 agentLoop | 无 workspace |
| `@little-house-studio/tools` | 工具实现、执行器、安全门禁 | types + engines |
| `@little-house-studio/agent` | Agent 运行时、注册表、子 Agent、装配 | context, llm, prompt, tools, types |
| `@little-house-studio/hub` | 多设备 Hub / 插件 | agent, types |
| `@little-house-studio/coding-agent` | 编程产品薄封装 | agent, tools, context, llm, types |
| `cli` / `webui` | 产品入口（TUI / Web） | agent + coding-agent + … |

下文按 **问题种类** 分组；每条含 **位置、问题、为何违背低耦合/高内聚**。

---

## 1. 包边界错位 / 所有权错误（ownership）

### F-01 · Todo 编排落在 tools，语义与文档却在 agent

| 项 | 内容 |
|---|---|
| **位置** | `core/tools/src/task/todo-orchestrator.ts`（~866 行）；设计文档在 `core/agent/docs/TODO_ORCHESTRATOR.md`；运行时消费在 `core/agent/src/agent/runtime.ts`、`runtime-facade.ts`；`core/agent/src/index.ts` 再导出 `TODO_ORCHESTRATOR` |
| **问题** | `TodoOrchestrator` 负责 lane 分配、依赖锁、notice 队列、**真 fork 回调**（`setForkRunner` / `TodoForkRunner`）。实现放在 **tools** 包，设计与主循环在 **agent** 包。tools 不依赖 agent，只能通过回调/全局单例反向挂接。 |
| **为何** | 编排是 agent 生命周期职责，不是「可独立调用的工具逻辑」。跨包所有权导致：改 fork 策略要同时动 tools + agent；tools 包被迫导出 agent 级 API（`TodoForkRunner`），内聚在错误层。 |

### F-02 · `agent_team/*` 工具内嵌 Agent 运行时语义

| 项 | 内容 |
|---|---|
| **位置** | `core/tools/src/agent_team/agent_manage/tool.ts`、`subagent_delegate/tool.ts`、`supervisor_chat_main/tool.ts`、`supervisor_task_control/tool.ts`、`team-manager.ts`、`subagent-kind-options.ts` |
| **问题** | 工具直接依赖 `ctx.subagentExecutor`、`ctx.messageBus`、`ctx.callMainAgent`、`ctx.supervisorManager`；失败文案写「harness 需 `runtime.setSubagentExecutor()`」。`TeamManager` 进程内单例与 agent 层 `MessageBus` 双通道并存。 |
| **为何** | tools 层应只做「声明式能力 + 副作用执行」；调度/队友/监督是 agent 编排。通过 `ToolContext` 注入运行时把 tools→agent 依赖「藏」进 types 契约，包图上看起来无环，语义上 tools 已耦合 agent 内部模型。 |

### F-03 · Skill 扫描/烘焙放在 tools，注释写「从 context 下放」

| 项 | 内容 |
|---|---|
| **位置** | `core/tools/src/skill-context.ts`（~516 行）；`core/tools/src/index.ts` 注释「从 context 下放到此」；`core/context/src/index.ts` 注释确认已迁出；agent bootstrap `skills.ts` 再包一层 `createAgentSkillManager` |
| **问题** | Skill 索引注入 system / 增量 `<skill_update>` / 多路径扫描（~/.agents、~/.maou、项目、agent）是 **上下文与产品配置** 职责，与 `use_skill` 工具执行混在同一包，且 agent 又包一层扫描选项。 |
| **为何** | 同一概念（skill 生命周期）被 tools 实现 + agent 配置 + use_skill 工具三处切开，但核心模块却挂在 tools，context 层反而看不到，边界与数据流方向不一致。 |

### F-04 · `@little-house-studio/types` 承载运行时服务契约（膨胀的「基础层」）

| 项 | 内容 |
|---|---|
| **位置** | `core/types/src/index.ts`：`ToolContext` 及 `AuxModelCallerLike`、`MessageBusLike`、`SubagentExecutorLike`、`SupervisorManagerLike`、`ForkOptions`、MCP 描述符等（单文件 ~824 行领域+契约） |
| **问题** | 注释明确写「用最小契约避免 types→agent/llm/tools 循环依赖」。结果：基础层知道子 Agent fork、监督状态机、消息总线、辅助模型调用细节。`ToolContext` 上有十余个运行时注入点（pathGuard、subagentExecutor、callMainAgent、supervisorManager、auxModelCaller、messageBus、yieldResult…）。 |
| **为何** | 低耦合通常让契约靠近实现方或独立 `contracts` 包；把 agent 运行时形状塞进 types，所有消费者（tools、agent、llm 适配）都被迫看见完整服务定位器形状，基础层内聚被打碎。 |

### F-05 · types 包同时混有配置、项目管理、Profiler、表情检测

| 项 | 内容 |
|---|---|
| **位置** | `core/types/src/config-store.ts`、`project-manager.ts`、`profiler.ts`、`expression.ts`、`maou-paths.ts` + 巨型 `index.ts` 内联类型 |
| **问题** | 包描述自称「共享领域类型 + 应用配置 + ConfigStore/项目管理/工具函数/表情检测」。领域消息类型与磁盘 ConfigStore、项目列表 CRUD、运行时 Profiler 同包。 |
| **为何** | 高内聚要求「改 A 不必拖 B」：只想依赖 `StreamEvent` 的模块也会装上 zod/jsonc 配置栈与项目路径约定；变更 ConfigStore 可能无谓触发 types 消费者重建。 |

### F-06 · agent 包 barrel 再导出 llm / tools 的权威实现

| 项 | 内容 |
|---|---|
| **位置** | `core/agent/src/index.ts`：`agentLoop` 自 `@little-house-studio/llm` re-export；`TODO_ORCHESTRATOR` / `TASK_MANAGER` 自 tools re-export；大量 bootstrap / CLI 列表 API 同文件导出 |
| **问题** | 应用层（cli、coding-agent）常只依赖 agent 即可拿到 tools/llm 符号，**真实所有权被 barrel 掩盖**。 |
| **为何** | 便利门面提高耦合：消费方看不清应依赖哪一层；agent 版本变更会牵动本属 llm/tools 的 API 表面。 |

### F-07 · CLI 命名与装配逻辑沉在 agent 核心库

| 项 | 内容 |
|---|---|
| **位置** | `core/agent/src/bootstrap/runtime-deps.ts`：`listAgentsForCli`、`resolvePresetForCli`、`listProvidersForCli`、`listModelsForCli`；`core/agent/src/cli/run-agent-cli.ts`；webui `agent-hub.ts` 直接 import 这些 `*ForCli` |
| **问题** | 函数名带 `ForCli`，但实现与导出在 **agent 库**；WebUI 也调用 `listProvidersForCli`，命名与真实消费者不符。`createStandardAgentDeps` 把 ConfigStore + SessionStore + builtins + LLMClient + 终端审核装在一处。 |
| **为何** | 库层应提供中性「listProviders / createDeps」；产品壳（cli/webui）做组装。CLI 语义泄漏使 agent 与终端产品绑定，降低可复用性。 |

### F-08 · `agent_factory` 残留类型与 hub 职责重叠

| 项 | 内容 |
|---|---|
| **位置** | `core/agent/src/agent_factory/types.ts`（`MessageType`、`DeviceStatus`、插件向 Message 等）；hub 注释称插件从 agent_factory 迁入；hub `EventBus` vs agent `SubagentEventBus` |
| **问题** | 设备状态、消息类型枚举仍在 agent 树旁路目录；hub 依赖 agent（`core/hub/package.json` → agent），而 agent 内仍留 SDK 插件类型。 |
| **为何** | 多设备/插件与 agent 循环应分层：hub 依赖 agent 核心会抬高 hub 的耦合面；残留 `agent_factory` 目录降低包内导航内聚。 |

### F-09 · agent 内残留 `team-manager` 编译产物，权威实现在 tools

| 项 | 内容 |
|---|---|
| **位置** | `core/agent/src/agent/team-manager.js` + `.d.ts`（无 `.ts` 源）；权威：`core/tools/src/agent_team/team-manager.ts` |
| **问题** | 同源 `AgentTeamManager` 在 agent 树留下 JS 幽灵实现，与 tools 源分叉风险。 |
| **为何** | 双份实现是典型错误耦合/错误内聚：读者不知以哪份为准；修改 tools 不会自动清掉 agent 侧幽灵。 |

---

## 2. God 模块 / 低内聚巨型单元

### F-10 · `AgentRuntime` 上帝对象（~3393 行）

| 项 | 内容 |
|---|---|
| **位置** | `core/agent/src/agent/runtime.ts` |
| **问题** | 单类同时负责：会话生命周期、prompt 编译与预览监听、工具注册/MCP 同步、LLM 流式循环、压缩（ContextEngine + maybeCompress 双路径）、command 注册表、MessageQueue、Todo notice/nudge、终端清理、skill 管理、usage/token 报表、subagent delegate 工具注册、监督绑定、文件 diff 监听、路径沙箱、hooks… import 面横跨 prompt/context/llm/tools/types 及十余个本包模块。 |
| **为何** | 高内聚模块应对齐 **一个变更理由**。任何「循环策略 / 压缩 / 工具 / 子 Agent」改动都落在同一文件，是项目内最严重的内聚失败。 |

### F-11 · `Runtime` 门面叠加装配与编排（~710 行）

| 项 | 内容 |
|---|---|
| **位置** | `core/agent/src/agent/runtime-facade.ts` |
| **问题** | 在 Runtime 之上再叠：POST 日志、ModelCaller/ToolExecutor 装配、AgentFactory/团队模板、`SubagentExecutor` + default runFn、MCP manager、GitWatcher、TASK_MANAGER 持久化回调、Todo fork runner 绑定、监督 `callMainAgent`。 |
| **为何** | 门面本应薄；此处变成第二套 composition root，与 `bootstrap/runtime-deps.ts`、`coding-agent` 装配三处重叠，职责边界模糊。 |

### F-12 · `SubagentExecutor` 过大（~1381 行）

| 项 | 内容 |
|---|---|
| **位置** | `core/agent/src/agent/subagent-executor.ts` |
| **问题** | fork / 并发层 / 结果合并 / 隔离 / MCP 透传 / 进度等挤在同一实现文件。 |
| **为何** | 子 Agent 执行引擎可拆「调度、会话派生、结果协议、隔离」；单文件混合使测试与替换策略困难（低内聚）。 |

### F-13 · `AgentRegistry` 混合注册、发现与物化（~1042 行）

| 项 | 内容 |
|---|---|
| **位置** | `core/agent/src/agent/registry.ts` |
| **问题** | 同一类：CRUD agent 条目、扫 convention 目录、channels/schedules/tools 发现、prompt 根解析、DefinedAgent 加载、项目级 agent 物化写盘、`initMainAgent`。 |
| **为何** | 「注册表」与「模板物化 / 文件系统约定扫描」应是不同内聚单元；混合后注册表无法在无 FS 的测试中单独演进。 |

### F-14 · CLI `store` + `reducer` 巨型 UI 状态球

| 项 | 内容 |
|---|---|
| **位置** | `cli/src/state/store.ts`（~1229 行）、`cli/src/state/reducer.ts`（~839 行） |
| **问题** | 单 store 聚合：会话指针持久化、输入历史、滚动/选区/hover、补全、goal 监督、命令路由、PerfHud、gallery 无关 UI、终端审批相关状态、agent 切换缓存… |
| **为何** | UI 状态应按领域切片（session / input / scroll / overlays）。上帝 store 使任意 UI 改动可能触碰会话恢复逻辑（高耦合、低内聚）。 |

### F-15 · `run-agent-ratatui.ts` 混合桥接与产品策略（~1045 行）

| 项 | 内容 |
|---|---|
| **位置** | `cli/src/tui-bridge/run-agent-ratatui.ts` |
| **问题** | 同一文件：spawn Ratatui、CliSession、全量 state 推送、主题、终端审批 install、gallery 选图、SUPERVISOR_MANAGER 同步、escape 取消、keybinding、overlay 补全。 |
| **为何** | TUI 桥接应只做「状态快照 ↔ 原生 UI」；产品策略（gallery、监督、审批）应分模块，否则桥接层与业务强耦合。 |

### F-16 · `search_internet/backends.ts` 单文件后端全家桶（~1722 行）

| 项 | 内容 |
|---|---|
| **位置** | `core/tools/src/internet/search_internet/backends.ts`（同目录另有 rank/normalize/query_core 等） |
| **问题** | 多搜索后端实现堆在单文件，与已拆出的 rank/normalize 形成「半拆分」。 |
| **为何** | 每后端应独立模块以便替换/测试；单文件后端目录违反工具子域高内聚。 |

### F-17 · `LLMClient` 与协议栈偏胖

| 项 | 内容 |
|---|---|
| **位置** | `core/llm/src/client.ts`（~1138 行）；另有 `caller.ts`、`chat-session.ts`、adapters/* |
| **问题** | 客户端层同时靠近传输、重试、多协议适配入口；与 `agent-loop.ts` 的极简循环、`agent` 包完整 Runtime 形成「三套循环入口」生态（见 F-18）。 |
| **为何** | llm 包内部仍可接受较大客户端，但与 agent 循环职责交叉时，包级内聚边界变糊。 |

### F-18 · 三套「Agent 循环」并存

| 项 | 内容 |
|---|---|
| **位置** | `core/llm/src/agent-loop.ts`（`agentLoop`）；`core/agent/src/agent/agent-loop.ts`（`IAgentLoop` / `DefaultAgentLoop`）；真正产品路径 `AgentRuntime.run` |
| **问题** | index 文档把 llm 的 `agentLoop` 标为「权威极简实现」，agent 又提供可扩展 loop 接口，产品却走 Runtime 巨型循环。三套 API 并存。 |
| **为何** | 同一概念多实现提高认知耦合：贡献者不知改哪条路径；测试与文档易漂移。 |

---

## 3. 服务定位器 / 层泄漏（layer leaks）

### F-19 · `ToolContext` 作为跨层服务定位器

| 项 | 内容 |
|---|---|
| **位置** | `core/types/src/index.ts` `ToolContext`；填充：`AgentRuntime` processToolCalls；消费：`agent_team/*`、`yield`、监督工具、`llm_judge` 等 |
| **问题** | 工具执行上下文本应是「路径/会话/沙箱」；现附加 subagent 执行器、主 Agent 调用、监督器、辅助模型、MessageBus、yield 回调、skill 选项等。tools 包通过可选字段探测能力，缺省走 stub。 |
| **为何** | 经典服务定位器反模式：隐式依赖难测、难替换；tools 与 agent 之间没有清晰端口模块，只有一个越来越胖的 bag。 |

### F-20 · 运行时与工具互相依赖「全局单例」

| 项 | 内容 |
|---|---|
| **位置** | `TODO_ORCHESTRATOR`、`TASK_MANAGER`、`MESSAGE_QUEUE`、`SUPERVISOR_MANAGER`、`AgentTeamManager`、`SUBAGENT_EVENT_BUS` 等进程级单例；cli `run-agent-ratatui.ts` 直接 `SUPERVISOR_MANAGER.getBySupervisor` |
| **问题** | 跨包共享可变单例；CLI 绕过 Runtime 读 agent 内部监督状态。 |
| **为何** | 低耦合偏好显式注入与会话作用域；全局单例把测试隔离与多租户/多会话边界绑死。 |

### F-21 · webui / cli 装配路径重复且深入 agent 内部 API

| 项 | 内容 |
|---|---|
| **位置** | `webui/src/server/agent-hub.ts`、`copilot-hub.ts`：`createStandardAgentDeps` + `createCodingAgent` + `*ForCli`；cli `headless/cli-session.ts`：`runAgentCli` |
| **问题** | 两个产品入口各自拼 deps，复制预设引导逻辑；都依赖 agent 的 bootstrap 细节而非单一「Application」端口。 |
| **为何** | 产品壳应依赖窄接口（`AgentHandle`）；重复装配 = 变更时双处修改（耦合复制）。 |

### F-22 · hub → agent 依赖方向偏重

| 项 | 内容 |
|---|---|
| **位置** | `core/hub/package.json` depends on `@little-house-studio/agent`；`core/hub/src/client.ts` import agent 的 `Message` / `AgentEvent` 类型 |
| **问题** | 多设备 Hub 本可作为独立通信层；因类型取自 agent，hub 无法在无 agent 运行时单独发布/使用。 |
| **为何** | 通信层应对齐 types（或 hub 自有 wire 类型）；依赖完整 agent 包是层倒置风险。 |

---

## 4. 重复关注点 / 双轨实现（duplicated ownership）

### F-23 · 消息模型多套并行

| 项 | 内容 |
|---|---|
| **位置** | `core/types` `Message`；`core/context/src/types/message.ts` `MaouMessage` / `LLMMessage` + 转换函数；`core/context` `SessionMessage`；`core/llm/src/stream.ts` `Message` 联合类型；`core/agent/src/agent_factory/types.ts` `Message` |
| **问题** | 会话落盘、压缩、LLM 调用、流式协议、旧 SDK 插件各有消息形状，靠 `maouMessagesToLLM` 等转换粘合。 |
| **为何** | 领域核心概念重复定义 = 低内聚（「消息」无单一真相）+ 跨层转换耦合。 |

### F-24 · Token 估算双实现

| 项 | 内容 |
|---|---|
| **位置** | `core/llm/src/token-count.ts`（`estimateTokens` / `estimateContextTokens`）；`core/context/src/token-estimate.ts`（`estimateTokens` / `estimateTokensFromText` / `estimateFullPromptTokens`）；cli `headless/state-snapshot.ts` 从 **llm** 估 token，agent Runtime 从 **context** 估 |
| **问题** | 两套启发式并存，CLI 与 Runtime 可能对同一上下文给出不同数字。 |
| **为何** | 同一职责应有单一模块；双实现导致策略漂移与产品展示不一致。 |

### F-25 · 终端安全路径「正式 + 兼容 re-export」

| 项 | 内容 |
|---|---|
| **位置** | 权威：`core/tools/src/security/**`；兼容桩：`core/tools/src/terminal/terminal-policy.ts`、`terminal-security.ts`、`maou-hard-deny.ts`、`dcg-guard.ts` 等 re-export / 薄封装 |
| **问题** | 迁移方向正确但仍留双入口；调用方可能从 `terminal/*` 或 `security/*` 导入。 |
| **为何** | 双入口延长耦合寿命，阻碍 security 子域成为唯一内聚边界。 |

### F-26 · 压缩双路径（ContextEngine vs maybeCompress）

| 项 | 内容 |
|---|---|
| **位置** | `core/context/src/context-engine.ts`、`compressor.ts`、`auto-compress.ts`；`AgentRuntime` 在注入 stores 时走 ContextEngine，否则回退 `maybeCompress` |
| **问题** | Runtime 内显式双路径注释；会话存储还有 `HarnessSessionStore` / `TaskSessionStore` / `SessionStore` 三套。 |
| **为何** | 压缩策略与会话持久化职责交叉多模块，缺少单一编排者时内聚下降、行为难预测。 |

### F-27 · 两套「定义工具」体系

| 项 | 内容 |
|---|---|
| **位置** | `core/llm/src/tools`（TypeBox `defineTool`，面向 ChatSession）；`core/tools` `Tool` 抽象类 + Zod/schema.json（面向 AgentRuntime） |
| **问题** | llm 层类型安全工具 SDK 与 tools 层生产工具体系并行，schema/执行模型不统一。 |
| **为何** | 新工具作者面对两套 API；跨层复用困难（概念重复、实现分裂）。 |

### F-28 · reader 依赖 browser 工具 util

| 项 | 内容 |
|---|---|
| **位置** | `core/tools/src/reader/god_tool/reader/tool.ts` → `../../../browser/god_tool/use_browser/_util.js`（`errToString`） |
| **问题** | 读文件工具依赖浏览器工具目录下的通用字符串工具。 |
| **为何** | 横向耦合：browser 与 reader 应共享 `tools/src/lib` 之类中性模块，而非子域互引。 |

---

## 5. 包内 / 产品壳内聚问题

### F-29 · `core/tools` 包面过大（工具 + 编排 + skill + 安全 + 引擎生命周期）

| 项 | 内容 |
|---|---|
| **位置** | `core/tools/src/index.ts` 导出：builtins、terminal/LSP 引擎生命周期、security 全套、SkillContextManager、DynamicToolLoader、输出压缩、Todo 编排、文件编辑历史、subagent delegate、diff collector… |
| **问题** | 名为 tools，实际是「agent 外围能力大杂烩」。engines 生命周期函数也从 tools 再导出。 |
| **为何** | 包级内聚弱：只想用 grep 工具的人也间接面对编排与安全 API 表面；与 F-01/F-02/F-03 叠加。 |

### F-30 · `core/context` 会话存储职责切分不清

| 项 | 内容 |
|---|---|
| **位置** | `session-store.ts`（~1181 行）、`session-manager.ts`、`harness-session-store.ts`、`task-session-store.ts`、`session-event.ts`、`checkpoint-store.ts` |
| **问题** | 多 Store 类并存，Runtime/Facade 需同时理解 harness/task/普通 session 与 event 追加模型。 |
| **为何** | 「会话持久化」单一领域被拆成多入口且由上层拼装，内聚边界依赖约定而非模块强制。 |

### F-31 · coding-agent 薄、但能力仍回流 agent

| 项 | 内容 |
|---|---|
| **位置** | `agent/coding-agent/src/index.ts`（创建 handle + 再导出 agent API）；实质逻辑在 `core/agent` bootstrap/runtime |
| **问题** | 产品包很薄，coding 特有策略（如 fileDiffWatch、doc-extract hook）有的在 coding-agent，有的在 agent 默认选项。 |
| **为何** | 产品边界不清晰时，通用 agent 库持续吸收产品特例（库膨胀、产品包空心）。 |

### F-32 · webui 内嵌大型 Markdown 工作台（~5k 行子树）

| 项 | 内容 |
|---|---|
| **位置** | `webui/src/client/markdown/**`（parser/canvas/doc-outline/copilot/editor…）；同包还有 `ChatPanel`、`TerminalPanel`、`AgentHub` |
| **问题** | 一个 npm 包同时是：Agent 聊天壳、终端复用、完整 Markdown IDE。Markdown 子系统与 agent 流式对话弱相关。 |
| **为何** | 产品包低内聚：Markdown 演进与 agent hub 变更相互牵制；更适合独立 package 或明确 subpath。 |

### F-33 · webui 服务端多 Hub 并列

| 项 | 内容 |
|---|---|
| **位置** | `webui/src/server/agent-hub.ts`、`copilot-hub.ts`、`terminal-hub.ts`、`agent-terminals.ts`、`create-server.ts` |
| **问题** | Agent 会话、Copilot、终端、agent 附属终端多套 hub；装配与生命周期分散。 |
| **为何** | 服务端可接受多 hub，但缺少统一 application 层时，WebSocket/路由与 agent 生命周期耦合点重复（与 F-21 相关）。 |

### F-34 · cli 对 workspace 依赖面极宽

| 项 | 内容 |
|---|---|
| **位置** | `cli/package.json`：agent、coding-agent、context、llm、tools、types |
| **问题** | TUI 入口直接依赖 llm/context/tools，而非仅 agent handle（例如 `state-snapshot` 用 llm token 估算，`setup` 用 llm `APIPreset`）。 |
| **为何** | 应用层可依赖多包，但跨过 agent 门面直连底层会固化内部形状，增加重构成本（可接受的产品耦合，仍属边界泄漏）。 |

---

## 6. Engines 与相对健康区域（对照）

以下区域经抽查，**未发现与主审计同级的结构性错位**（可作正向对照，不是「零问题」保证）：

| 区域 | 观察 |
|---|---|
| `lsp-engine`、`sqry-engine`、`opencli-engine` | 薄协议/二进制包装，依赖面小，与 tools 单向消费关系清晰 |
| `terminal-engine` | Rust/NAPI 边界清楚；上层经 tools 的 use_terminal 接入 |
| `core/prompt` | 依赖仅 types，职责相对单一 |
| `core/llm` adapters 分文件 | 协议适配分文件内聚较好（与 F-17/F-18 的循环所有权问题分开看） |
| security 迁入 `tools/src/security` | 方向正确（见 F-25 残留双入口） |

若未来拆包，优先动 **agent Runtime / tools 编排 / types 契约**，engines 可保持现状。

---

## 7. 按包汇总（导航索引）

| 包 / 区域 | 主要发现 ID |
|---|---|
| `core/types` | F-04, F-05, F-19 |
| `core/tools` | F-01, F-02, F-03, F-09, F-16, F-25, F-28, F-29 |
| `core/agent` | F-06, F-07, F-08, F-09, F-10, F-11, F-12, F-13, F-18, F-20, F-31 |
| `core/context` | F-23, F-24, F-26, F-30 |
| `core/llm` | F-17, F-18, F-24, F-27 |
| `core/hub` | F-08, F-22 |
| `core/prompt` | （无明显结构性差距） |
| `agent/coding-agent` | F-31 |
| `cli` | F-14, F-15, F-20, F-21, F-34 |
| `webui` | F-21, F-32, F-33 |
| `*-engine` | 第 6 节对照 |

---

## 8. 问题种类统计（本清单）

| 种类 | 数量（约） | 代表 |
|---|---|---|
| 包边界 / 所有权错误 | 9 | F-01–F-09 |
| God 模块 / 低内聚巨型单元 | 9 | F-10–F-18 |
| 服务定位器 / 层泄漏 | 4 | F-19–F-22 |
| 重复关注点 / 双轨 | 6 | F-23–F-28 |
| 产品壳 / 包面内聚 | 6 | F-29–F-34 |
| **合计** | **34** | |

> 编号连续便于引用；同一根因可能跨多条（如 ToolContext 膨胀与 agent_team 编排错层）。

---

## 9. 建议阅读顺序（仅导航，非改造计划）

1. **F-10 + F-19 + F-01/F-02**：Runtime 上帝对象 ↔ ToolContext 服务定位器 ↔ tools 内编排——系统耦合主轴。  
2. **F-04/F-05**：types 包职责边界。  
3. **F-18/F-23/F-24**：双轨循环 / 消息 / token。  
4. **F-14/F-15、F-32**：cli / webui 产品壳内聚。  
5. engines 与 prompt 作「健康对照」。

---

*本文件为审计交付物；不包含重构实施步骤或 PR 拆分（见仓库 goal 非目标）。*

---

## 附录：2026-07-20 已落地的结构修复（功能意图不变）

| 项 | 状态 | 落地路径 |
|---|---|---|
| F-09 幽灵 TeamManager | ✅ | 删除 `core/agent/src/agent/team-manager.*` |
| F-24 Token 单源 | ✅ | `core/types/src/token-estimate.ts`；llm/context 复用 |
| F-19 ToolContext 收口 | ✅ | `ToolRuntimePorts` + `resolveToolRuntimePorts`；Runtime 双写 |
| F-01 Todo 编排归位 | ✅ | `core/agent/src/agent/todo/*` + tools `todo-orchestrator-host.ts` |
| F-10 Runtime 拆分（首批） | ✅ | `runtime-tool-context.ts`、`runtime-todo.ts` |
| F-28 reader/file 等依赖 browser util | ✅ | 公共函数迁 `core/tools/src/util/common.ts`；browser `_util` re-export 兼容 |
