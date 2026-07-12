# Todo 编排系统（Todo Orchestrator）设计

> 状态：**P0–P2 已实现（编排 + notice 注入 + 真 fork 接线 + /todo + 调试页）**  
> 日期：2026-07-13  
> 范围：会话级 todo 计划 + 后端全自动调度 + fork 分身 + 依赖锁 + 催促 + 调试页  
> 相关代码（现状）：`core/tools/src/task/*`、`TaskManager` / `task_plan.json`、`SubagentExecutor`、`dynamic-context.ts`

---

## 1. 目标与非目标

### 1.1 目标

1. 复杂 / 长链路 / 可并行任务：由模型用 **todo 工具** 提交带 **顺序 + 并行 + 依赖** 的计划表。
2. 计划提交后由 **后端 Scheduler 全自动** 解析 DAG、管理依赖锁、在岔口 fork 主 agent 分身、回收分身；**不依赖模型自发调用 fork**（保证稳定性，省一轮 token）。
3. 每个节点完成必须调用推进工具；一次调用 **只代表一个节点**。
4. 失败是「失败类完成」：可汇报 failed，**不自动级联**下游失败。
5. 负责某线路的 agent 未做到头、且非合法等依赖、又无工具调用 → **系统催促**（新一轮 loop + 靠后 user 通知）。
6. 动态注入一律 **靠后的 user 形态 system_notice**，不改靠前 system，保护 **prompt cache**。
7. Agent 列表展示 **fork 树缩进** + 忙闲/当前工作。
8. 专用 **Todo 调试页** 可视化 DAG / Lane / 事件，便于抓工程 bug。
9. 斜杠指令 **`/todo`**：发送时自动注入「必须详细规划」的通知。

### 1.2 非目标（v1）

- 与 supervisor 强绑定（todo 编排独立；supervisor 只管验收/总任务）。
- 执行中热改 DAG（禁止 replace；只能归档 + 新建 plan）。
- 硬拦截「无计划不准写代码」（仅软约束 + `/todo`）。
- 飞书任务 / 项目级 task 等外部「任务」语义（逻辑切割，不混名）。

### 1.3 与「其它 task」的切割

| 名称 | 含义 |
|------|------|
| **todo_*** / Todo Orchestrator | 当前会话内 checklist + 自动 fork 调度 |
| `agent_message` / SubagentExecutor | 底层 fork 能力；生产路径由 Scheduler 调用，非模型主路径 |
| `supervisor_task_control` | 监督/验收 |
| 飞书 lark-task 等 | 外部系统 |

对外工具名：`todo_manage` / `todo_finish`（兼容别名 `task_manage` / `task_finish`）。  
内部持久化可继续使用 `task_plan.json` / `TaskManager` 字段名，避免破坏旧 session。

---

## 2. 已锁定决议

| ID | 议题 | 决议 |
|----|------|------|
| R1 | 提交后谁执行 | **全自动后端**；模型不自发 fork |
| R2 | 分身是什么 | 主 agent **context 分身**（同配置/工具）；仅多注入 notice |
| R3 | 并行层谁干活 | **root 占 1 个 ready 节点，其余 fork** |
| R4 | 一个 Lane 管几个节点 | **C：动态链合并**（见 §4） |
| R5 | 节点完成 | 负责该节点的 Lane **自己**调 `todo_finish` |
| R6 | 失败语义 | `status: completed \| failed`；一次一个节点；**不自动级联** |
| R7 | 建表门槛 | 完全模型判断（软）；`/todo` 强制要求详细计划 |
| R8 | 改计划 | 执行中 **禁止 replace**；归档 + 新 plan |
| R9 | 催促 | 线路未做到头 ∧ 非合法等依赖 ∧ 本轮无工具 → user notice + 续 loop |
| R10 | 终汇报 | `todo_finish` 的 **`report` 字段**（与短 `summary` 分工） |
| R11 | 注入位置 | 全部 **靠后 user `system_notice`**，禁止改靠前 system |
| R12 | 与 supervisor | 独立 |
| R13 | API 失败 | 重试至成功（实现阶段定退避与上限） |
| R14 | 任务失败 | 向上以 failed 节点 + report 体现；下游不解锁 |

---

## 3. 领域模型

```
TodoPlan
  planId, sessionId (root), status: active|archived|completed
  nodes: TodoNode[]
  createdAt, archivedAt?

TodoNode
  id, desc
  deps: string[]
  status: pending | in_progress | completed | failed | cancelled
  summary?, report?, failReason?
  laneId?                 // 当前绑定的执行身份
  relatedBlockIds?        // 压缩归档关联（既有）

Lane
  laneId
  kind: root | fork
  parentLaneId?
  sessionId
  planId
  // 动态链：本 Lane 当前负责的节点序列（可增长/在汇合点截断）
  assignedNodeIds: string[]
  status: idle | working | waiting_deps | finishing | recycled
  currentNodeId?

TodoEvent                     // 调试页与列表的唯一真相源
  ts, type, planId, laneId?, nodeId?, payload
```

### 3.1 节点状态机

```
pending ──assign──► in_progress ──todo_finish(completed)──► completed
                         │
                         └──todo_finish(failed)──► failed

（归档/新 plan 时 in_progress 可 → cancelled，并回收 fork）
```

- `completed`：解锁依赖它的下游（若下游 deps 全为 completed）。
- `failed`：**不解锁**任何依赖它的下游。
- 一次 `todo_finish` **只转换一个** `task_id`。

---

## 4. Lane 分配策略（决议 R4 = C：动态链合并）

### 4.1 直觉

- **能顺着一条无分叉的线就同一 Lane 接着干**（省 fork / token）。
- **出现可并行的多个 ready 节点就拆分身**。
- **汇合点**（deps 来自多条线，或与其它 Lane 竞争）→ 当前链结束（终汇报 + 回收 fork），节点由调度器重新 assign。

C **不是**第三种业务形态，而是调度器在「单节点」与「线性链」之间 **自动选择**。

### 4.2 关键定义

- **Ready**：`status=pending` 且所有 `deps` 均为 `completed`。
- **Exclusive successor(u → v)**：  
  - `v.deps` 恰好等于「仅依赖 u」（或仅依赖本 Lane 已完成集合中的节点，且不含其它未完成/它线节点）；  
  - 且不存在另一个 pending 节点 `w` 与 `v` 同时 ready 且需要并行拆分；  
  - 实现上采用保守规则（§4.3），宁拆不糊。
- **Join 节点**：`deps.length >= 2` 且 deps 来自不同 Lane 完成的节点 → 不并入旧 fork，等全部 deps completed 后重新 assign。

### 4.3 分配算法（v1 可实现伪代码）

```
onPlanSubmitted(plan):
  validate DAG (no cycle, deps exist, unique ids)
  persist plan (active)
  scheduleReady()

scheduleReady():
  ready = selectReady(nodes)  // 拓扑
  if ready empty:
    if all terminal (completed|failed|cancelled): onPlanSettled()
    return

  // 已有 Lane 且其 current 已 finish：尝试把 exclusive successor 并入该 Lane
  for each lane in activeLanes where lane 刚完成节点 u:
    v = uniqueExclusiveSuccessor(u, ready)
    if v:
      assignNode(v, lane)   // 不新开 fork；注入 unlock notice
      ready.remove(v)

  if ready empty: return

  // 剩余 ready：并行层
  // R3: root 占 1 个（优先 id 序或关键路径启发，v1 用 id 字典序最小）
  sort ready by id
  first = ready[0]
  if root 空闲或 root 可接新节点:
    assignNode(first, rootLane)
  else:
    fork = createFork(parent=root)  // 仍占「一个」；实现上 root 忙则全 fork
    assignNode(first, fork)

  for each other in ready[1:]:
    fork = createFork(parent=当前调度锚点)
    assignNode(other, fork)
    // 双写 notice：父 Lane + 子 Lane 均收到 fork 事件说明

assignNode(node, lane):
  node.status = in_progress
  node.laneId = lane.laneId
  lane.assignedNodeIds.push(node.id)
  lane.currentNodeId = node.id
  lane.status = working
  emit event + append user system_notice(todo_unlock / todo_fork)

onNodeFinished(node, status, summary, report?):
  // 校验：调用方 session 必须绑定该 node.laneId
  node.status = status
  save summary/report
  if status == completed:
    maybeUnlockDependents()  // 只改 pending 可计算性，不立刻全 assign
  if lane 的链无法再 exclusive 延伸 且 无 in_progress:
    requireReportIfNeeded(lane, report)
    recycleFork(lane)  // root 不删，只 clear assignment
  scheduleReady()
```

### 4.4 例子

```
      ┌→ 2a → 4a
1 ───┤
      └→ 2b
         └→ 3 (deps: 2a, 2b)   // join
```

1. root 做 1。  
2. 1 completed → ready {2a,2b}：root 占 2a，fork-B 做 2b。  
3. 2a completed → 若 4a 仅依赖 2a → **并入 root 链**继续 4a（C）。  
4. 2b completed → fork-B 无 exclusive 下游 → 交 report → 回收 fork-B。  
5. 2a、2b 均 completed → 3 ready → 新 assign（root 若仍在做 4a 则 fork-C 做 3，或等 root 空闲按 R3）。

---

## 5. 工具契约

### 5.1 `todo_manage`

| action | 行为 |
|--------|------|
| `create` | 无 active plan 时新建；提交成功 → **Scheduler.onPlanSubmitted** |
| `replace` | **仅**当无 in_progress 且无活跃 fork；否则硬拒绝（R8） |
| `delete` | 清空/归档；有活跃执行时拒绝或强制 archive+cancel（v1：有 in_progress 则拒绝） |
| `list` | 只读当前 plan 与进度 |

`create` 成功后的 fork/assign **全部后端做**，工具返回值附带「已调度摘要」（ready 层、lane 分配），便于模型感知。

### 5.2 `todo_finish`

```ts
{
  task_id: string;           // 当前节点
  status: "completed" | "failed";
  summary: string;           // 短说明（≤200 或放宽）
  report?: string;           // 链终点或交接需要时的完整汇报（R10）
  reason?: string;           // failed 时原因（可与 summary 合并校验）
}
```

硬规则：

1. 一次只推进一个 `task_id`。  
2. 调用者必须是该节点当前 `laneId` 对应 session。  
3. `failed` 不解锁下游。  
4. **不**自动把后续节点标 failed；工具说明仅写：「只代表你当前负责的这一个节点」。  
5. Lane 链结束时：若缺 `report`，Scheduler 可再注入 notice 要求补交，或将长 `summary` 降级为 report（实现时二选一，**推荐缺 report 则 nudge 补一次**）。

### 5.3 模型侧 fork 工具

- 生产路径：**Scheduler → SubagentExecutor.fork**。  
- `agent_message fork_layer`：保留兼容/调试；文档标明非 todo 主路径。

---

## 6. 系统通知与 Prompt Cache（R11）

### 6.1 原则

- **System 前缀保持静态**（ROLE / 工具说明等）。  
- 一切运行时动态信息：以 **`role: user`** 消息追加在 **对话末尾**，标签：

```xml
<system_notice kind="..." plan_id="..." lane_id="..." node_id="...">
...
</system_notice>
```

### 6.2 kind 枚举

| kind | 时机 |
|------|------|
| `todo_plan_required` | `/todo` 指令 |
| `todo_plan_submitted` | create 成功后告知 root：调度已开始 |
| `todo_fork` | 创建分身时：**父 + 子** 各一条（发生了什么 / 将发生什么 / 你的职责链） |
| `todo_unlock` | 节点 assign 给 Lane 时 |
| `todo_inject_report` | 下游启动时注入上游 `report`/`summary`（**仅解锁启动时**，不提前灌） |
| `todo_nudge` | 催促继续 |
| `todo_lane_end` | 链结束：请交 report / 即将回收 |
| `todo_plan_archived` | 旧 plan 归档 |

### 6.3 与旧 `formatTaskPlan` / `<todo_plan>` 注入

- **废弃**每轮改写靠前 system 或 before_user 大块动态 plan（打 cache）。  
- 改为：状态变更时追加 **一条** `system_notice`（可带精简 checklist 快照）。  
- 调试页仍可从 `TodoEvent` + 持久化 plan 读全量，不依赖模型上下文里的完整表。

---

## 7. 催促（R9）

对每个 **活跃 Lane**（root 或 fork），在该 session 一轮工具处理结束时：

```
合法等待 waiting_deps:
  无 in_progress 绑定 ∧ 下一节点存在但 deps 未满足

应催促:
  Lane 仍有未完成责任（链未结束 / 仍有 in_progress）
  ∧ 非 waiting_deps
  ∧ 本轮该 session 零工具调用

动作:
  append user system_notice kind=todo_nudge
  继续同一 session 的下一轮 loop（不新开用户消息语义上的「新任务」）
```

上限（建议实现参数，可配置）：

- 连续 nudge 次数默认 5；超限 → 标 lane `stuck`，事件上报，root 侧可见；不死循环烧 token。

---

## 8. `/todo` 指令

### 8.1 行为

用户消息含 `/todo`（行首或独立 token）时：

1. 剥离或保留原指令文本（实现：保留用户正文，去掉命令词可选）。  
2. 在 **本轮提交给模型的消息末尾** 追加 `todo_plan_required` notice。  
3. 不修改 system。

### 8.2 Notice 文案要点

- 必须先用 `todo_manage` 提交带 deps 的详细计划。  
- 提交后由系统自动调度与 fork，**不要**手搓并行 fork 工具。  
- 每完成一节点调用 `todo_finish`（一次一个节点）。

### 8.3 挂载点

- CLI 命令注册（`command-registry` / slash）  
- HTTP `/api/run` 入口同样识别（Feishu/Web 一致）

---

## 9. 改计划（R8）

| 场景 | 行为 |
|------|------|
| 无执行中节点、无活跃 fork | 允许 `replace` / `delete` |
| 有 in_progress 或活跃 fork | **硬拒绝** replace；提示：归档后新建 |
| 用户要推倒重来 | `archive` 当前 plan（cancel 未完成、回收 fork）→ `create` 新 plan |
| Prompt | 说明执行中不要改表；结构变更走新 plan |

v2 可考虑「只改 pending 的 desc」；**不在 v1 范围**。

---

## 10. API 失败 vs 任务失败（R13 / R14）

| 类型 | 处理 |
|------|------|
| LLM/HTTP API 失败 | 重试至成功；**不**推进节点状态 |
| 节点工作失败 | `todo_finish({ status: "failed", ... })`；下游不解锁；report 向上可见 |
| 级联 | 不自动；模型若判断后续无意义，可自行对后续节点逐个 failed（无额外引导词） |

---

## 11. 事件表（TodoEvent.type）

| type | 说明 |
|------|------|
| `plan_submitted` | 新 plan |
| `plan_archived` | 归档 |
| `plan_completed` | 全部终态 |
| `node_assigned` | 节点→Lane |
| `node_finished` | completed/failed |
| `deps_unlocked` | 某节点变为 ready |
| `fork_created` | 分身创建 |
| `fork_recycled` | 分身删除 |
| `report_stored` | 存 report |
| `report_injected` | 注入下游 |
| `nudge` | 催促 |
| `stuck` | 超限 |
| `manage_rejected` | 非法 replace 等 |
| `api_retry` | API 重试 |

所有事件：

- 写入 session 旁路日志（如 `todo_events.jsonl`）  
- 经 EventBus / SSE 推送调试页与 agent 列表

---

## 12. Agent 列表展示

```
● main (root)                 working  · 2a「改前端」
  ├─ fork:2b                  working  · 2b「改后端」
  └─ fork:3                   waiting  · 等待 deps: 2a,2b
```

字段：`agentId/laneId`, `parentLaneId`, `kind`, `status`, `currentNodeId`, `currentDesc`, `planId`。  
fork recycle 后：移除或灰显「已回收」。

数据来源：Lane 注册表 + TodoEvent，不靠模型自报。

---

## 13. Todo 调试前端页

### 13.1 目的

编排状态机复杂；**可视化是验收与排障一等公民**，与 Scheduler 同里程碑交付。

### 13.2 布局

| 区域 | 内容 |
|------|------|
| 左：DAG | 节点色（pending/in_progress/completed/failed）、边=deps、当前锁 |
| 中：Lane 树 | 缩进、绑定节点、sessionId |
| 右：时间线 | TodoEvent 流；点选看 payload / notice 原文 |

### 13.3 能力

- 按 `sessionId` / `planId` 订阅 SSE  
- 回放历史 `todo_events.jsonl`  
- Debug only：模拟 finish/fail（开关保护）  

### 13.4 接口草图（maou-agent :8099）

```
GET  /api/todo/plans?session=
GET  /api/todo/plan/:planId
GET  /api/todo/lanes?session=
GET  /api/todo/events?session=&after=
SSE  /api/todo/stream?session=
POST /api/todo/debug/finish   // 仅 debug
POST /api/todo/debug/fail
```

前端：`maou-ui` 路由 `/todo-debug` 或独立页 `todo-lab.html`。

---

## 14. 与现状差距

| 能力 | 现状 | 目标 |
|------|------|------|
| todo_manage / todo_finish 命名与 list | 部分已有 | 对齐本契约（status/report） |
| TaskManager 依赖锁 | 有 | 扩展 failed / lane 绑定 |
| 提交后自动 fork | 无 | Scheduler 全自动 |
| 动态链合并 C | 无 | §4 |
| root 占 1 + 其余 fork | 无 | R3 |
| 双写 fork notice | 无 | R11 |
| report 字段与回收 | 无 | R10 |
| 靠后 user notice | 仍有 dynamic-context plan 注入 | 改为 notice，弃 system 动态 plan |
| 催促 | 部分 endsLoop/空响应 | §7 |
| 禁 replace | create/replace 过宽 | R8 |
| /todo | 无 | §8 |
| Agent fork 树 UI | 无 | §12 |
| 调试页 | 无 | §13 |

---

## 15. 实现分期（文档之后开工顺序）

### P0 — 契约与 Scheduler 骨架 ✅

1. ✅ 扩展节点状态 `failed|cancelled` + `todo_finish` 的 `status/report/reason`  
2. ✅ `TodoOrchestrator`（`core/tools/src/task/todo-orchestrator.ts`）：create 调度、ready、assign、事件、notice 队列  
3. ✅ 执行中禁 replace；R3 root 占 1 + fork；R4-C exclusive 链合并  
4. ✅ 单测：`todo-orchestrator.test.ts`  
5. ⚠ P0 fork 为**逻辑分身**（session 仍同 root）；真 SubagentExecutor 接线在 P1

### P1 — 自动 fork 与 notice ✅

1. ✅ `setForkRunner` ↔ SubagentExecutor（runtime-facade）  
2. ✅ R3/R4；fork 双 notice；report 解锁时注入  
3. ✅ `evaluateNudge` + runtime `afterTodoTools` / 空响应续 loop  
4. ✅ `compileDynamicContext` 不再注入靠前 `<todo_plan>`；改 system_notice  

### P2 — `/todo` + 调试页 ✅

1. ✅ `preprocessTodoSlash` + runtime 消息末尾 `todo_plan_required`  
2. ⚠ Agent 全局列表缩进：调试页 Lane 树已覆盖；主 UI Agent 列表可后续接事件  
3. ✅ `/todo-debug` + `GET/SSE /api/todo/*`  

### P3 — 硬化（部分）

1. ⚠ API 重试：沿用既有 ModelCaller  
2. ✅ stuck 上限 5 次 nudge  
3. ✅ archive / auto-archive before create  
4. ✅ 别名 task_* 保留

---

## 16. 测试用例清单（验收）

1. 串行 1→2→3：仅 root，无 fork；finish 三次完成。  
2. 并行 1→{2a,2b}→3：1 后 root+fork；双 finish 后 3 assign；上游 report 仅在 3 启动时注入。  
3. 链合并：2a→4a 仅 deps 2a → 同一 Lane 连续，无新 fork。  
4. failed：2a failed → 3 永不 ready；2b 可继续。  
5. 模型对下游再 failed：逐个调用，系统不代劳。  
6. 执行中 replace → 拒绝。  
7. 空转催促：in_progress 无工具 → nudge user notice。  
8. 合法等待：等 deps 时不 nudge。  
9. `/todo` 消息末尾出现 `todo_plan_required`，system 哈希不变。  
10. 调试页事件与真实 finish/fork 顺序一致。

---

## 17. 开放实现细节（开工时定默认，不阻文档）

| 项 | 建议默认 |
|----|----------|
| root 忙时 R3「占 1」 | 全部 ready 均 fork，root 不抢 |
| report 缺失 | lane 结束时 nudge 补 `todo_finish` 仅补 report，或专用内部状态 |
| 并发 fork 上限 | 可配置，默认 8 |
| API 重试 | 指数退避，最多 5 次后 stuck+事件 |
| exclusive successor 判定 | 保守：仅 `v.deps = [u]` 且无其它节点同时以 u 为唯一依赖而需并行时并入 |

---

## 18. 文档修订记录

| 日期 | 变更 |
|------|------|
| 2026-07-13 | 初版：锁定 R1–R14；Q2=C；/todo；cache 友好 notice；调试页 |

---

## 19. 实现完成说明

已落地：

| 入口 | 说明 |
|------|------|
| `TODO_ORCHESTRATOR` | `core/tools/src/task/todo-orchestrator.ts` |
| 工具 | `todo_manage` / `todo_finish`（别名 task_*） |
| Runtime | `/todo` 预处理、notice flush、nudge、endsLoop+未完成强制继续 |
| 真 fork | `runtime-facade` `setForkRunner` + SubagentExecutor |
| 调试 | `http://localhost:8099/todo-debug` · API `/api/todo/*` |

单测：`core/tools` 下 `src/task/*.test.ts`（20 cases）。

主 UI Agent 列表的 fork 缩进仍可后续接 TodoEvent；调试页 Lane 树已可用。
