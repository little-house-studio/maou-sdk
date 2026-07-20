# Harness 优化落地计划

> 来源：Bilibili「Harness 优化」系列 1–7 转写对照（`.cache/harness-series/txt/`）  
> 结论：maou **基础设施约 60–70% 已具备**，缺的是可复用的流水线纪律与诊断闭环。  
> 状态：**P0–P5 已实现**（默认 opt-in / 不破坏日常 coding）  
> 日期：2026-07-20

---

## 1. 目标（人话）

让 maou 从「能干活」变成「能稳定、省钱、可验收地从头干到尾」：

| 你在乎的 | 做到之后 |
|---|---|
| 质量 | 少作弊、少跑偏、结果可对照基线说「过没过」 |
| 速度 | 少废话轮次、少重试、缓存多用 |
| 钱 | 长任务别几百万 token 打水漂 |
| 省心 | 复杂活可 headless 过夜跑，醒来看数字和结果 |
| 可进化 | 知道哪里慢/哪里蠢，才能一次次变好 |

**非目标（本计划不做）：**

- 重写 agent loop / 换一套框架  
- 为某一个具体 OCR/融资抽取业务写完整 skill 产品  
- 改 maou-agent 飞书/宠物等插件（除非诊断要 HTTP 暴露，且作为可选后续）  
- 强行变成 Claude Code 兼容客户端

---

## 2. 现状摘要

| 视频点 | 已有 | 缺口 |
|---|---|---|
| 目标与验收 | `/goal` + supervisor plan/verify | 无分阶段、无硬指标脚本 |
| 上下文不泄露 | worktree 隔离、project 注入 | 运行态与管理态未硬隔离；可偷看历史 output |
| prompt cache | ledger + CLI 命中率 + 记忆稳定排序 | 无逐步诊断表；provider pin / 前缀纪律未产品化 |
| 减轮次 / 流程 | subagent / team | 无 plan-JSON 批量派工骨架；无浪费轮次标注 |
| 拦意外行为 | `pre_tool_use`、DCG、白名单 | 无「读文档禁写码」开箱包；hook 模板空 |
| 模型写代码规范 | `/init` RULE 可写 | 无 What/How/Dispatch 默认约定 |

---

## 3. 工作包与分层

主战场：**maou-sdk**（`core/*`、`cli`、`agent/coding-agent`）。  
**maou-agent harness** 默认不动。

### P0 — Session 诊断（对齐 ep04/05）

**好处：** 能看见白干的步骤和 cache 断点，优化不再靠猜。

| 项 | 内容 |
|---|---|
| **改哪些层** | `core/agent`（ledger / token / session 事件）+ `cli`（命令与展示） |
| **交付物** | 1）按轮/按 tool 汇总表：purpose、tool、input/output、cache_read、是否疑似浪费；2）CLI 命令或 slash，例如 `maou session analyze [sessionId]` 或 `/analyze`；3）cache_read=0 的断点高亮 |
| **验收** | 跑完一次 ≥10 轮的会话后，一键导出表；能指出至少一处 cache 断点或重复 tool 模式 |
| **不做什么** | 自动「智能改 skill」（只诊断，不自动重写） |

**建议实现顺序：**

1. 统一从现有 usage 事件 + tool 事件拼 timeline（不新建平行账本）  
2. CLI 只读渲染 + 可选写 `.maou/sessions/<id>/analyze.md`  
3. 简单启发式：连续相同 tool+相似 args、读了未使用、cache_read 从有变 0

---

### P1 — 文档任务 Hook 包（对齐 ep06）

**好处：** 读难文档时别写代码死循环，省时间省 token。

| 项 | 内容 |
|---|---|
| **改哪些层** | `agent/coding-agent` 模板 hook + 可选 `core/tools` 硬策略；运行时 `PERMISSION.jsonc` |
| **交付物** | 1）开箱策略：场景 `doc_extract` 下拦截 `write_file` / `edit` / 随意 `run_terminal` 写脚本；2）拦截时返回固定中文反馈（「本任务禁止写代码，请直接读文档」）；3）hook/策略放在**运行 skill 工作区外**（agent 全局或 `~/.maou` / agent 模板，不进业务 output 目录）；4）README：何时启用、如何关 |
| **验收** | 在 fixture 会话中模型尝试 write → 被拦 ≥1 次并改读文件；业务目录内无 hook 源码可被 read 到（或明确文档说明隔离方式） |
| **不做什么** | 通用「意图 NLP 分类器」；先做工具名/路径规则 |

**建议实现顺序：**

1. coding-agent 增加 hook 示例：`pre_tool_use` 按 agent 模式或 env 开关  
2. 同步提供「收紧 tool_whitelist」方案（比 hook 更硬，可二选一或叠加）  
3. 文档写清：管理用 hook ≠ skill 运行根

---

### P2 — Skill 运行隔离约定（对齐 ep03）

**好处：** 别偷看标准答案和历史结果，质量才可信。

| 项 | 内容 |
|---|---|
| **改哪些层** | `core/agent`（projectRoot / isolation）+ `core/tools` path policy + `core/context` 注入策略说明 + coding-agent / skills 约定 |
| **交付物** | 1）约定目录：`runtime/`（只读输入+当次 output）与 `management/`（改 skill、rules、历史金标）分离；2）可选：禁止读指定 glob（如 `**/gold/**`、`**/previous_runs/**`）；3）文档：与 `.maou/project/*` **有意注入**的关系——注入是产品选择，skill 流水线任务应可「最小上下文」模式跑；4）worktree/subagent 推荐用于改代码，流水线抽取推荐用干净 cwd |
| **验收** | fixture：runtime 旁有 gold output 时，默认策略下 agent 读 gold 被拒或工具不可见；同一 skill 两次跑结果不依赖 gold |
| **不做什么** | 自动搬迁用户已有仓库结构；先约定 + 策略开关 |

**建议实现顺序：**

1. 写清目录约定与「最小上下文」开关设计（可先文档 + flag）  
2. path deny 接入 security gate（只读策略）  
3. coding-agent `/init` 或 skill 模板提示「流水线任务勿把管理 md 放进 runtime」

---

### P3 — 分阶段 Goal + 硬指标 verify（对齐 ep02）

**好处：** 先小后大，有及格线；敢过夜跑。

| 项 | 内容 |
|---|---|
| **改哪些层** | `core/agent` supervisor-manager / command + `core/tools` supervisor_* + `cli` 展示 |
| **交付物** | 1）plan 结构化字段（可兼容现有 MD）：阶段列表、每阶段成功标准、回退规则；2）verify 支持「跑用户提供的检查脚本/命令」返回 pass/fail（硬指标），LLM 验收作补充；3）阶段门禁：阶段 N 未 pass 不进 N+1；4）CLI/TUI 显示当前阶段与最近 fail 原因 |
| **验收** | fixture goal：阶段1 小样本脚本 fail → 不进阶段2；修通后 pass → 进入阶段2；全程有 plan 绑定 |
| **不做什么** | 内置某种 OCR 库或融资业务逻辑；指标脚本由用户/skill 提供 |

**建议实现顺序：**

1. 扩展 plan 约定（MD frontmatter 或 JSON 附件）  
2. `supervisor_task_control` verify 增加 `check_command` / 外部结果通道  
3. 阶段状态写入 SupervisorBinding（可先进程内，再考虑持久化）

---

### P4 — 流程减轮次骨架（对齐 ep05）

**好处：** 同样活从几十轮压到几步，明显更快更省。

| 项 | 内容 |
|---|---|
| **改哪些层** | coding-agent skill 模板 + 可选 `core/tools`（plan 生成/派工辅助）+ subagent API 文档 |
| **交付物** | 1）skill 模板：顺序/分支/循环写清楚；「精确事用代码、模糊事用模型」；2）示例：代码生成 plan.json → 批量 subagent 处理 docs → 代码合并排序；3）与 P0 诊断联动：优化前后轮次对比说明 |
| **验收** | 示例 skill 在固定输入上 tool 轮次有文档化基线，模板跑通；作者按模板能写出第二份 skill |
| **不做什么** | 通用 workflow 引擎 DSL（保持 markdown + 脚本） |

---

### P5 — What / How / Dispatch 规范（对齐 ep07）

**好处：** 模型写的 hook/规则代码以后还改得动。

| 项 | 内容 |
|---|---|
| **改哪些层** | `agent/coding-agent` 模板（`/init` RULE、hook README、可选 prompt 片段） |
| **交付物** | 1）RULE 默认段落：命名 `What_How` / case 拆分、单测边界；2）hook 示例按该命名；3）一页说明给「让模型维护安全代码」的作者 |
| **验收** | 新 `/init` 项目 RULE 含该节；示例 hook 文件名/函数名符合约定 |
| **不做什么** | 编译期强制 lint（可后续） |

---

### 横切（随 P0–P3 捎带，不单独排大期）

| 项 | 层 | 说明 |
|---|---|---|
| cache 前缀纪律文档 | prompt / context | 静前动后；换用户名别放 prefix 最前 |
| provider 建议 | llm / 配置文档 | 长任务锁同一 provider；不强制改协议 |
| 过拟合提醒 | coding-agent 文档 | 指导优先于绝对禁令列表（ep01） |

---

## 4. 推荐实施顺序与依赖

```text
P0  Session 诊断          ──独立，立刻有体感
P1  文档任务 Hook 包      ──独立，立刻少浪费
P2  运行隔离约定          ──与 P1 互补；path policy 可复用 security
P3  分阶段 Goal + 硬指标  ──可依赖 P0 看验收过程
P4  流程骨架模板          ──用 P0 对比优化前后
P5  What/How 规范         ──最轻，可与 P1 同 PR
```

**建议第一期（1–2 个迭代）：P0 + P1 + P5**  
体感最大、改动面可控、不依赖大改 supervisor。

**第二期：P2 + P3**  
质量可信 + 过夜目标。

**第三期：P4**  
把方法论沉淀成可复制 skill 模板，并用 P0 证明轮次下降。

---

## 5. 每期完成定义（DoD）

通用：

- [ ] 有最小测试或 fixture（CLI 快照 / unit）  
- [ ] 有一段「人话」README：解决什么痛、怎么开、怎么关  
- [ ] 不引入默认破坏现有 coding 日常开发体验（开关默认关或仅 skill 场景开）  
- [ ] SDK 相关改动：`pnpm -r build` 通过；相关 vitest 通过  
- [ ] 不在本计划中把密钥、业务数据写进仓库

---

## 6. 风险与原则

| 风险 | 应对 |
|---|---|
| 隔离/禁写过猛，影响正常 coding | 场景开关；默认 coding 行为不变 |
| 硬指标脚本被模型乱改 | 脚本放 management 侧或只读挂载；校验用独立命令 |
| 诊断误报「浪费」 | 启发式仅提示，不自动删步骤 |
| 与「每轮注入 project 上下文」冲突 | 产品双模式：日常 coding 保持注入；流水线 skill 用最小上下文 |
| 范围膨胀成 workflow 平台 | 坚持：诊断 + 策略 + 约定 + 小扩展，不做新编排语言 |

**SDK 耦合原则（沿用仓库约定）：**

- 不在 harness 重实现 loop  
- 扩展走 Runtime / hooks / tools / templates  
- 改 SDK 后 rebuild 再验 maou-agent

---

## 7. 文档与素材索引

| 资源 | 路径 |
|---|---|
| 系列转写 01–07 | `maou-sdk/.cache/harness-series/txt/` |
| 音频缓存 | `maou-sdk/.cache/harness-series/audio/` |
| 现有 goal 监督 | `core/agent/src/agent/supervisor-manager.ts` |
| supervisor 工具 | `core/tools/src/agent_team/supervisor_*` |
| hooks | `core/agent/src/agent/hooks.ts` |
| cache 账本 | `core/agent/src/agent/prompt-cache-ledger.ts` |
| coding hook 模板 | `agent/coding-agent/templates/coding/hook/` |
| `/init` 项目说明 | `agent/coding-agent/templates/coding/command/init.md` |

---

## 8. 里程碑勾选（实施时改状态）

| 包 | 状态 | 负责人 | 备注 |
|---|---|---|---|
| P0 Session 诊断 | **已完成** | | `maou session analyze` + `/analyze`；`cli/src/lib/session-analyze.ts` |
| P1 文档 Hook 包 | **已完成** | | `MAOU_DOC_EXTRACT=1`；`coding-agent/src/hooks/doc-extract.ts`；拦截原因回传 |
| P2 运行隔离 | **已完成** | | path deny 段 + `MAOU_PIPELINE_ISOLATE`；`MAOU_MINIMAL_CONTEXT`；docs/harness-pipeline-isolation.md |
| P3 分阶段 Goal | **已完成** | | plan `json:plan` stages；`check_command` hard-check；supervisor 门禁 |
| P4 流程骨架 | **已完成** | | `templates/coding/skills/pipeline-batch/SKILL.md` |
| P5 What/How 规范 | **已完成** | | `/init` RULE 骨架 + hook README |

---

## 9. 一句话

先 **看得见（P0）**、再 **拦得住（P1）**、再 **信得过（P2）**、再 **跑得完（P3）**，最后 **写得快、学得会（P4/P5）**。
