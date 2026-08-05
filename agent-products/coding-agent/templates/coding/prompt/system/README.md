# system.md —— 系统提示词
本文件是该 agent 的系统提示词入口。每次运行自动解析渲染：
- `{{file.md}}` 递归内联其它文件
- `{{>>script.py}}` 执行脚本并嵌入输出
- `{{display_name}}`/`{{role}}` 等占位符由 agent.json 填充
