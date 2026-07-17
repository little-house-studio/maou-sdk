# Ratatui ↔ Ink 对等（签收级推进）

**目标**：并排不可区分（允许帧率/亚像素差）。  
**业务**：共用 `headless/cli-session` + store/reducer/`runAgentCli`。  
**签收表**：[`PARITY-SIGNOFF.md`](./PARITY-SIGNOFF.md)

## 本轮签收级改动

| 项 | 实现 |
|----|------|
| 消息版式 | `messages.rs`：LOGO_W=2、user `│`+右对齐`⨁`、shortId 头、`◈ ↺N`、thinking `// N 字`、tool name 色底、`▸ 输入/输出`、diff 色、fold 文案对齐 Ink |
| EventBlock | spinner 忙碌图标 + NORMAL(`inputFieldBg`)/AUTO/YOLO + ◤◥ + 中文「询问」 |
| 底栏 chrome | 补全打开时隐藏 Event/Info；completion 在输入上方（▸+#2121FF）；InfoBar 响应式 bar；Nav tau-ceti 七色；输入 ` ❯ `+inputFieldBg |
| 布局 | 无 Event→input 顶部分隔；BackToBottom 恒占 1 行；placeholder 对齐 |
| SelectList | overlay `❯`；补全 `▸`（与 Ink InputBar 一致） |
| 复制三模式 | chat 内容锚定 / global VRAM / input 草稿 + toast ✓ |
| Esc | Node `handleEscapeCancel` 同一栈 + `registerAbortStream` |
| 监督 | Goal 条 + SUPERVISOR 同步 + goal_action |
| 历史窗 / LITE / PerfHud | chrome 字段下发 |
| 协议 | `usage_input/output`、`input_field_bg` 经 state-snapshot 下发 |

## 使用

```bash
cd maou-sdk/cli
npm run build && npm run build:tui-ratatui
maou coding --tui ratatui
# 对照
MAOU_TUI=ink maou coding
```

## 选区 / 复制（对齐 Ink 三模式）

| 模式 | 起点 | 复制来源 |
|------|------|----------|
| **chat** | 对话区（`resolve_sel_mode`） | 内容锚定 absY + lineCache；边缘 auto-scroll + pin |
| **global** | 对话区外（底栏/空白等） | **显存** `Vram`；双击词 / 三击行用 `vram_word/line_bounds` |
| **input** | 输入框 | 草稿字节切片（不读显存，避 ❯）；拖出框 clamp |

| 显示 | 行为 |
|------|------|
| 颜色 | `#2121FF` + 浅字；松手闪白 50ms 再定格（LITE 直接 settle） |
| 松手 | OSC52 + pbcopy；空提取清选；toast `已复制 N 字「…」` |
| Ctrl+G | `vram.dump_all()` 整屏显存文字 |
| Esc | 先清选区，再走 Node Escape 栈 |
| 滚轮 | 1 行；overlay/补全优先；拖选中滚动保持内容锚 |

## 仍可能差一点点

- T07：`state.input` 不回写 Rust 草稿（架构故意）
- **人工** Ink/Ratatui 并排手测（PARITY-SIGNOFF 结论栏）

默认后端仍为 **ink**。

### 2026-07-16 调度推进摘要

- **PerfHud**：5 行 process-stats
- **上一条 user**：对话区顶栏 + 预览
- **复制**：Cmd+C / Ctrl+Shift+C
- **滚轮（Grok 对齐）**：基线约 **3 行/齿**（对标 Grok `scroll_lines`）；触控板短间隔分数累加防放大惯性；快滑可到 4 行/步，单次封顶 8
- **贴底发送 follow**：send 时 pin 最新；尾部 pad（idle 1 行 / 流式 ~40% 视口）预留 AI 输出空间；过滚回底 re-follow
- cargo test + release

