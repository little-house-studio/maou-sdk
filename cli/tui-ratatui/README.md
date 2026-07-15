# maou-tui-ratatui

可选 **Ratatui** TUI 后端。默认 **Ink 版不变**。

## 编译

```bash
cd maou-sdk/cli
npm run build:tui-ratatui
# 或
cargo build --release --manifest-path tui-ratatui/Cargo.toml
```

产物：`tui-ratatui/target/release/maou-tui-ratatui`

## 切换

```bash
# 默认 Ink（现网）
maou coding
# 或
MAOU_TUI=ink maou coding

# Ratatui
MAOU_TUI=ratatui maou coding
maou coding --tui ratatui

# 指定二进制
MAOU_TUI=ratatui MAOU_TUI_BIN=$PWD/tui-ratatui/target/release/maou-tui-ratatui maou coding
```

配置文件（可选）`~/.maou/config.json`：

```json
{
  "cli": { "tui": "ratatui" }
}
```

优先级：`--tui` > `MAOU_TUI` > config > `ink`。

## 协议 / stdio

父进程 **必须** 把 stdin/stdout 继承为真实 TTY（crossterm raw mode 依赖 stdin 是 TTY）。
协议走独立 FD，不能把 JSONL 塞进 stdin。

| FD | 方向 | 用途 |
|----|------|------|
| 0 stdin | TTY inherit | 键盘 / raw mode |
| 1 stdout | TTY inherit | 绘制（Rust 优先 `/dev/tty`） |
| 2 stderr | pipe | TUI → Node JSONL（`ready` / `submit` / `quit` / …） |
| 3 (`MAOU_TUI_IPC_FD`) | pipe | Node → TUI JSONL（`hello` / `state` / `assistant_delta` / …） |

`launch.ts` 使用 `stdio: ["inherit","inherit","pipe","pipe"]` + `MAOU_TUI_IPC_FD=3`。

## 对等

业务与 Ink 共用 Node store/agent；本二进制只做视图与输入。  
验收矩阵见 `cli/docs/PARITY-RATATUI.md`。  
缺二进制或需回退：`MAOU_TUI=ink`。
