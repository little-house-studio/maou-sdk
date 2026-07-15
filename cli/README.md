# Maou CLI

终端 AI agent 入口（默认 **Ink** TUI）。

## TUI 后端切换（Ink 保留 / Ratatui 可选）

**默认仍是 Ink 现网版，未删除、未覆盖。**

```bash
# 1) 编译 Ratatui 后端（一次）
cd maou-sdk/cli
npm run build:tui-ratatui

# 2) 切换启动
maou coding                    # Ink（默认）
MAOU_TUI=ink maou coding       # 显式 Ink
MAOU_TUI=ratatui maou coding   # Ratatui
maou coding --tui ratatui      # 同上
```

可选配置 `~/.maou/config.json`：

```json
{ "cli": { "tui": "ratatui" } }
```

优先级：`--tui` > `MAOU_TUI` > config > `ink`。

更多：[`tui-ratatui/README.md`](./tui-ratatui/README.md)。

Ratatui 为 **Phase 0/1 切片**（可聊 + 滚动 + 状态栏），完整 parity 分阶段；缺功能时回退 `MAOU_TUI=ink`。
