# Maou CLI

终端 AI agent 入口（默认 **Ratatui** TUI；Ink 保留可回退）。

## TUI 后端

```bash
# 编译 Ratatui 二进制（首次 / 改 Rust 后）
cd maou-sdk/cli
npm run build:tui-ratatui

maou coding                    # Ratatui（默认）
MAOU_TUI=ratatui maou coding   # 显式 Ratatui
MAOU_TUI=ink maou coding       # 回退 Ink
maou coding --tui ink          # 同上
```

可选 `~/.maou/config.json`：

```json
{ "cli": { "tui": "ink" } }
```

优先级：`--tui` > `MAOU_TUI` > config > **`ratatui`**。

更多：[`tui-ratatui/README.md`](./tui-ratatui/README.md)。

缺二进制时启动会提示编译或回退 Ink。
