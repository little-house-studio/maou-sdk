# supervisor_task_control

监督 Agent 生命周期控制工具（仅 `/goal` 监督模式下可用）。

## 用途

监督 Agent 通过此工具控制监督流程的生命周期：
- `start`：启动监督，绑定任务计划 MD
- `confirm_end`：任务完成，向用户发起验收
- `end`：用户验收通过，完全结束监督模式

## 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| action | string | 是 | `start` / `confirm_end` / `end` |
| plan | string | action=start 时必填 | 任务计划 MD（包含任务要求、细节、验收标准） |
| summary | string | action=confirm_end 时建议填 | 任务完成总结，发给用户验收 |

## 状态机

```
planning → started → confirming → ended
   │         │           │
   │         │           └── 用户拒绝 → 回到 started
   │         └── confirm_end
   └── start
```

## 限制

- 仅在监督 Agent session 内可用
- 必须按状态机顺序调用（不能跳过 start 直接 confirm_end）
