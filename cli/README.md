# Maou CLI

终端 AI agent 入口。**唯一 TUI：Ratatui**（Ink 已删除）。

## 编译 TUI 二进制

```bash
cd maou-sdk/cli
npm run build:tui-ratatui   # release → ~/.maou/bin
# 或 maou doctor
```

## 启动

```bash
maou coding
MAOU_TUI_BIN=/path/to/maou-tui-ratatui maou coding
```

对等说明见 [`docs/PARITY-RATATUI.md`](./docs/PARITY-RATATUI.md)。  
Rust 壳：[`tui-ratatui/README.md`](./tui-ratatui/README.md)。
