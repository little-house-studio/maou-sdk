# hook —— 生命周期钩子脚本
本目录脚本监听 hook 事件触发：用户输入 / 用户输入前 / 压缩前 / 压缩后 / 缓存重建点 / loop 结束 等。
文件名约定事件名，如 on_user_message.ts、pre_compact.ts、cache_rebuild_point.ts、loop_end.ts。

缓存重建点（`cache_rebuild_point`）是文件缓存区重新 cache write 的时机，不是压缩本身。
默认触发：大压缩 / 归档、手动 `/compact`（微压缩不触发）、新建会话、清空会话。
`pre_cache_rebuild` 返回 `{ cancel: true }` 可跳过本次重建（不撤销已发生的压缩或新建会话）。
