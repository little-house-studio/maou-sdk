# 流水线隔离与最小上下文（P2）

> 默认**全部关闭**，日常 coding 行为不变。仅 headless / skill 流水线 opt-in。

## 开关

| 变量 | 作用 | 默认 |
|---|---|---|
| `MAOU_PIPELINE_ISOLATE=1` | 拒绝路径段：`gold` / `management` / `previous_runs` / `.pipeline-management` | 关 |
| `MAOU_DENY_PATH_SEGMENTS=a,b` | 额外 deny 段（逗号分隔） | 空 |
| `MAOU_MINIMAL_CONTEXT=1` | 项目上下文只注入 `RULE.md` | 关 |
| `MAOU_PROJECT_CONTEXT=off\|minimal\|full` | 显式控制注入 | full |
| `MAOU_DOC_EXTRACT=1` | 禁止 write_file/edit_file | 关 |

## 推荐目录

```
task/
  runtime/input|output   # agent 工作
  management/gold|…      # 人维护；agent 在 isolate 下读不到
```

## 与 `.maou/project` 的关系

日常 coding：**有意**注入 USER/PROJECT/RULE…（产品选择）。  
流水线抽取：用 `MAOU_MINIMAL_CONTEXT=1` 或 `MAOU_PROJECT_CONTEXT=off`，避免管理说明污染运行态。

## 安全说明

- deny 在 `resolveToolPath` 层生效（reader/write/glob 等走 path-guard 的工具）
- 不自动搬迁仓库；不默认启用
- 硬指标 `check_command` 见 `hard-check.ts`：无 shell、白名单 bin、路径 jail、超时
