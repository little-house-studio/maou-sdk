## 使用指引

- content 必须是完整文件内容；每次调用整体替换。
- 自动创建不存在的父目录。
- **先读后写**：
  - **新建**：可直接 write。
  - **已存在且从未 read/edit**：默认拦；**故意整文件替换**时传 `"force": true`。
  - **已 read/edit 且无外部 diff**：可直接 write。
  - **已 read/edit 但磁盘有 diff**：须再读（force 不能跳过）。
- 写后验证：**LSP → sqry → 自检提示词**。
- 局部小改优先 edit_file。
