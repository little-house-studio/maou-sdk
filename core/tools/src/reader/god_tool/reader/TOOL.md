## 使用指引

- reader 是读取工具的统一入口，支持文件路径和 URL。
- 传入文件路径读取本地文件，传入 URL 读取网页内容。
- 本地文本按行分页：`offset`/`limit`（也认 `start_line`/`end_line`）。URL 忽略行号。
- 一次最多 2000 行、整窗 50KiB、单行 2000 字。页脚给出下一页的 `offset`。
