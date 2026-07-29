## 使用指引

- **list**：本机 `projects.json` 注册的 Coding 项目（● 可用 / ○ 标记失效）。
- **create**：绝对路径注册项目 + 写 `.maou/project.json` + 驻扎 coding agent。
- **send**：向项目 coding agent 派任务（path 须 isActive）。
- **repair**：路径存在但标记失效时重建 `project.json`、补 agent、刷新注册。
- **rebind**：`project/name=旧项` + `path=新绝对路径`，更新注册并 repair 新路径。

失效示例：list 显示「路径或 .maou 标记失效」→ `repair path="/abs/project"`。  
搬家：`rebind project=旧名 path="/new/abs/path"`。
