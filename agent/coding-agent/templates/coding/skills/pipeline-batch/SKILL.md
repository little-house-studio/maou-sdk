---
name: pipeline-batch
description: >
  流水线 / Harness 减轮次骨架：代码出 plan JSON → 批量 subagent 或顺序处理 →
  代码合并排序。精确事用代码，模糊事用模型。配合 MAOU_PIPELINE_ISOLATE / doc_extract。
---

# pipeline-batch —— 流程减轮次骨架（P4）

## 何时用

- 多文档抽取、批量校验、分阶段调研
- 不想让模型每读一个文件就绕几十轮 tool call

## 目录约定（防 context leakage）

```
your-task/
  runtime/           # 仅当次输入 + 当次 output（agent 工作区）
    input/
    output/
  management/        # 管理侧：改 skill、金标、历史 run（agent 默认不可读）
    gold/
    previous_runs/
```

启用隔离（默认关）：

```bash
export MAOU_PIPELINE_ISOLATE=1          # 拒绝路径段 gold/management/previous_runs
export MAOU_MINIMAL_CONTEXT=1           # 仅注入 RULE.md
# 可选叠加：
export MAOU_DOC_EXTRACT=1               # 禁止 write_file/edit_file
```

## 逻辑（顺序 / 分支 / 循环写清楚）

1. **代码**扫描 `runtime/input`，按 token 预算切批 → 写出 `runtime/plan.json`
2. **模型/subagent** 按 plan 批次处理模糊抽取（只读 input，写当次 output）
3. **代码**合并、去重、按日期排序 → `runtime/output/final.json`
4. （可选）**硬指标**：`node scripts/check-stageN.mjs` 退出码 0 才进下一阶段

### plan.json 示例

```json
{
  "batches": [
    { "id": "b1", "docs": ["runtime/input/a.md", "runtime/input/b.md"], "subagent": true },
    { "id": "b2", "docs": ["runtime/input/c.md"], "subagent": false }
  ],
  "merge": { "sort_by": "date", "format": "table" }
}
```

### /goal 分阶段 + 硬指标示例

在 plan MD 中附加：

````markdown
```json:plan
{
  "stages": [
    {
      "id": "small",
      "title": "5 家小样本",
      "success": "金标字段均可在抽取结果中定位（用 check 脚本，不读 gold 目录给 agent）",
      "check_command": "node scripts/check-small.mjs"
    },
    {
      "id": "full",
      "title": "全量",
      "check_command": "node scripts/check-full.mjs"
    }
  ]
}
```
````

`check_command` 安全约束：无 shell 元字符；仅 `node/python3/bash` + 项目内脚本。  
**检查脚本放 management 侧或 scripts/，用 env 传入 gold 路径，不要让 agent 直接读 gold。**

## 角色分工

| 事 | 谁干 |
|---|---|
| 列文件、算长度、切批、排序、格式化 | **代码** |
| 从难读文本抽字段、模糊对齐 | **模型** |
| 是否过线 | **硬指标脚本**（优先）+ supervisor |

## 诊断

```bash
maou session analyze --write
```

看 cache 断点与 Y/P 浪费步，再改 plan / skill。

## 反模式

- 把 CLAUDE.md / 管理 rules 放进 runtime
- 让模型读 `gold/` 或上次 `previous_runs/`
- 用模型做排序 / 固定 schema 格式化
- 一上来全量，没有小样本阶段
