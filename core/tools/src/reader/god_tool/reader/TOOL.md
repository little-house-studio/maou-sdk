## 使用指引

- reader 是读取工具的统一入口，支持文件路径和 URL。
- 传入文件路径读取本地文件，传入 URL 读取网页内容。
- start_line/end_line 仅对文件有效，URL 读取忽略行号参数。
- 大文件或长网页建议用 max_chars 限制返回长度。
