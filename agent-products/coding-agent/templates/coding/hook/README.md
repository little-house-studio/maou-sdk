# hook —— 生命周期钩子

本目录是 **coding 模板说明**（物化到 `.maou/agents/coding/hook/` 时仅作文档）。  
**真正拦截逻辑在 SDK 进程内注册**（`@little-house-studio/coding-agent` 的 `hooks/doc-extract.ts`），  
**不要**把可执行 hook 策略源码放进 skill 业务运行目录——模型可能读到并试图绕过（Harness 优化 ep06）。

## 已提供：doc_extract（文档抽取禁写码）

| 项 | 说明 |
|---|---|
| **何时用** | 让 agent **读难文档 / OCR 文本 / 非结构化材料** 抽信息时，禁止它写 Python/脚本硬抠 |
| **拦什么** | `write_file` / `edit_file`（及常见别名） |
| **怎么开** | 环境变量 `MAOU_DOC_EXTRACT=1`，或 `createCodingAgent({ docExtractMode: true })` |
| **默认** | **关**（日常 coding 不受影响） |
| **更硬方案** | 直接收紧白名单：`toolWhitelist: DOC_EXTRACT_TOOL_WHITELIST` |

```bash
# 仅本次会话
MAOU_DOC_EXTRACT=1 maou coding

# 流水线隔离（拒读 gold/management；默关）
MAOU_PIPELINE_ISOLATE=1 MAOU_MINIMAL_CONTEXT=1 MAOU_DOC_EXTRACT=1 maou coding

# 诊断刚才有没有瞎写代码轮次
maou session analyze --write
```

详见 `docs/harness-pipeline-isolation.md` 与 skill 模板 `skills/pipeline-batch/SKILL.md`。

拦截时模型会收到中文 tool_result，例如：

> 【doc_extract】本任务禁止写代码/改文件（已拦截 write_file）。请直接用 reader / grep …

## What / How / Dispatch 命名（写 hook 时请遵守）

让模型维护 hook/规则代码时，用 **主题在前、手段在后** 的命名，方便增量修与单测：

| 层级 | 含义 | 例子 |
|---|---|---|
| **What** | 在处理什么事 | `doc_extract`、`block_write_tools` |
| **How** | 用什么方式判断 | `name_in_blocked_set`、`regex_path` |
| **Case** | 具体场景/用例 | `case_py_script`、`case_edit_md` |

推荐函数名：`what_how` 或 `whatHow`，测试：`what_how__case_*`。

```ts
// What: block_write_tools
// How: name_in_blocked_set
export function shouldBlockDocExtractTool(toolName: string): boolean { ... }
```

详见 `/init` 写入的 `RULE.md` 中「What / How / Dispatch」一节。

## 事件名（若自写脚本 hook）

文件名约定事件：`on_user_message`、`pre_compact`、`loop_end`、`pre_tool_use` 等。  
当前 coding 产品以 **进程内 Hooks API** 为准（`pre_tool_use` 返回 `false` 或 **原因 string** 可拦截）。
