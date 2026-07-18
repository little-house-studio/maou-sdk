# 遗留：TS 终端实现（已弃用）

自 2026-07 起，`use_terminal` **只**走 Rust `@little-house-studio/terminal-engine`：

- 默认全平台管道（shell -c / cmd /c）
- 可选 `MAOU_PTY_FORCE=1` 真 PTY
- 跨平台 ProcessGroup 杀进程树

下列文件**不要再用于生产路径**，仅作历史参考，后续版本将删除：

| 文件 | 原职责 |
|------|--------|
| `registry.ts` | 内存终端表 + node-pty |
| `pty.ts` | node-pty / spawn 降级 |

请勿 `import` `TERMINAL_REGISTRY` 或 `spawnPty`。
新功能只改 `terminal-engine` + `use_terminal/tool.ts`。
