## 使用指引

- 不指定 id 为临时终端（执行完即销毁），指定 id 为持久终端（可反复操作）。
- 常驻终端适合需要保持状态的场景：dev server、watch 模式、REPL 等。
- command 中的路径含空格时必须用引号包裹。
- timeout 默认 120 秒，长任务设 background=true 避免超时。
- 前台超时会自动转后台，不会丢失进程。
- result_limit 控制返回内容长度，大输出建议设小值（如 2000），避免 token 浪费。
- manage_action=list 查看所有终端，manage_action=logs 查看后台终端输出。
- 不要用终端执行文件读写操作——有专门的 read_file/write_file/edit_file 工具。
- 破坏性命令（rm -rf、drop table 等）先向用户确认再执行。
