# command —— 指令脚本

文件名 = 指令名。用户发 `/<指令名>` 时执行对应文件。

## 支持格式

| 扩展名 | 行为 |
|--------|------|
| `.md` | 默认：固定回复（不进 AI） |
| `.md` + frontmatter `mode: task` | **任务注入**：正文作为用户任务，主 agent 继续跑 AI（类似 skill） |
| `.sh` / `.mjs` / `.js` / `.ts` | 执行脚本，stdout/stderr 作为固定回复 |

## task 模式示例

```markdown
---
mode: task
description: 简短说明（可选）
---

# 任务标题

请 AI 执行的完整提示词……
```

## 查找顺序

1. `<project>/.maou/agents/<name>/command/`
2. `~/.maou/agents/<name>/command/`
3. 上述目录 `.agent.ref` 指向的**模板** `command/`（coding 模板即此）

## 现有指令

- `init.md`（task）：初始化 `.maou/project/` 五份项目说明文件
