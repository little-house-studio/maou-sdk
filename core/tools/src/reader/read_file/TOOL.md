# read_file

读取本地 UTF-8 文本。网页用 `web_fetch`，图片用 `read_image`。综合入口仍是 `reader`。按行分页：`offset`/`limit`（也认 `start_line`/`end_line`），一次最多 2000 行、50KiB。
