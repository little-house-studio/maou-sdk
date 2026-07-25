## 使用指引

- 只有用户明确要求“改造 Agent 自己”时使用，例如新增 Maou 工具/MCP、修改 Ops Agent 模板或改变能力配置。
- 普通业务代码、项目维护和项目内大任务使用 `project_agent`，不要使用 `change_self`。
- 改造前先读取现有实现；只做需求内最小改动，并运行相关 typecheck/test。
- 不得把凭据写入模板、提示词、工具源码或项目文件。
- 不自动 commit、push、发布或删除现有配置。
