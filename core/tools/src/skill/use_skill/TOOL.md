## 使用指引

- 按名称加载专门领域的 skill（专业知识包）。名称与系统提示词 `<available_skills>` 列表一致。
- 只在遇到相关任务时使用；不相关无需加载。
- name 区分大小写，需与 skill 实际名称完全一致。
- 加载结果作为工具返回写入对话历史，后续轮次可见；无需重复加载同一 skill。
- 扫描范围（与列表注入同口径）：
  - 系统/NPM 全局：`~/.agents/skills`、`~/.claude/skills`（默认开启，可用 skillOptions.includeSystemNpmSkills=false 关闭）
  - maou 全局：`~/.maou/skills`
  - 项目：`skills/`、`.agents/skills/`、`.maou/skills`
  - Agent：`.maou/agents/<name>/skills`
