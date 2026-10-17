## 使用指引

`use_computer` 按 MCP 门面调用：`list` 拿目录，`call` 执行。这段说明不进系统提示词。

- 截图：`call name=screenshot`（或直接 `action=screenshot`）。
- 控件：`snapshot` 拿 `[N]`，再 `click`/`type`，带上 `snapshot`。
- 每个 agent 一把虚拟光标，动作串行，系统指针会还回去。
- 网页用 `use_browser`。
