# project_send

向已注册项目的 Coding Agent 派任务。立即返回，Coding 在目标项目会话后台跑；完成后把摘要写回当前 OPS 会话。

- 必填：`project`（路径或唯一名）、`task`
- 项目不存在或失效时，按返回提示对现在的绝对路径 `project_agent create`。目录里已有 `.maou` 只重新挂上。
