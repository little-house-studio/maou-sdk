# Ink 输入框完整清单 × Ratatui 对等核对

**目的：** 以 **Ink 现网输入框** 为唯一真相源，列出全部行为；再对 **Ratatui** 逐项打勾。  
**用法：** 改 Ratatui 输入逻辑时只对本文；修完一项把 `[ ]` → `[x]`，并在「备注」写证据（路径/手测）。  
**范围：** 输入栏本身 + 与输入强绑定的补全/历史/全屏编辑/提交队列/Esc 分层。不含聊天气泡排版。  
**日期：** 2026-07-15  
**源码锚点（Ink）：** `cli/src/render/InputBar.tsx`、`FullScreenEditor.tsx`、`overlay/Completer.ts`、`input/*`、`hooks/useInputSelection.ts`、`hooks/escape-cancel.ts`、`app.tsx`、`state/store.ts`、`headless/cli-session.ts`  
**源码锚点（Ratatui）：** `cli/tui-ratatui/src/app/keys.rs`、`state.rs`、`input_paint.rs`、`mouse_*`、`cli/src/tui-bridge/run-agent-ratatui.ts`

图例：

| 标记 | 含义 |
|------|------|
| `[x]` | 已对等（代码 + 行为与 Ink 一致或可接受等价） |
| `[~]` | 部分实现 / 有可观察偏差 |
| `[ ]` | 未实现或明显错误 |
| `—` | Ink 自身也未做 / 仅 DESIGN 愿景，**不对 Ratatui 强求** |

---

## 0. 架构对照（先读）

| | Ink | Ratatui |
|--|-----|---------|
| 草稿持有 | Node `inputValue` + controlled TextArea | **Rust** `App.input` / `cursor` |
| 补全计算 | Node Completer + store | **同** Node；Rust 只画菜单 |
| 历史 | Node store `~/.maou/history.json` | Node navigate + `input_set` |
| 发送/排队 | Node `cli.send` | Rust `submit` → Node `cli.send` |
| 鼠标选区 | Node hit-test + VRAM/input 模式 | Rust SelMode::Input + 草稿切片 |

---

## 1. 文本编辑核心

| ID | Ink 功能 | 键位/触发 | Ink 源 | Ratatui | 备注 |
|----|----------|-----------|--------|---------|------|
| E01 | 多行可控文本 | 键入 | InputBar + app `inputValue` | `[x]` | Rust 持有草稿 |
| E02 | 过滤鼠标/控制序列垃圾 | 任意 change | `scrubInput` / useCleanInput | `[x]` | Rust `scrub_input` 对齐 Ink（CSI/SGR/SS3/C0）；crossterm 事件路径仍为主 |
| E03 | 按 code point 退格 | Backspace | `text-edit` + InputBar | `[x]` | `snap_char_boundary` |
| E04 | 词删 | Alt+Backspace / Ctrl+W | `findPrevWordBoundary` | `[x]` | keys.rs |
| E05 | 句删 | Ctrl+Backspace | `findPrevSentenceBoundary` | `[x]` | 含 `.!?。！？…` |
| E06 | 选区 + Backspace 整块删 | Backspace + sel | useInputSelection | `[x]` | |
| E07 | 键入覆盖选区 | 可打印字符 + sel | useInputSelection | `[x]` | |
| E08 | 避免 TextArea 与自定义 BS 双删 | 禁用 TA 部分 keybinding | InputBar | `[x]` | 无双层库 |
| E09 | 光标活动重置闪烁相位 | onCursorChange | vram-layer | `[x]` | tick_caret_blink + notify_caret_activity |
| E10 | 关库闪烁、用反色光标 | disableCursorBlink | InputBar | `[x]` | `▌` |
| E11 | overlay 或有选区时失焦/藏插入光标 | overlay / sel | InputBar focus | `[x]` | |
| E12 | 空 Enter 不发送 | Enter trim 空 | doSubmit | `[x]` | |
| E13 | 向前 Delete 删一字符 | Delete | TextArea 默认 | `[x]` | `delete_forward` 2026-07-15 |
| E14 | Delete 删选区 | Delete + sel | 部分（TA 受限） | `[x]` | sel-first 同 BS |
| E15 | Undo/Redo | — | — | `—` | Ink 也无 |
| E16 | Kill-ring Ctrl+Y / Alt+Y | — | useKillRing **未接线** | `—` | 两侧都未产品化 |

---

## 2. 多行与布局

| ID | Ink 功能 | 键位 | Ink 源 | Ratatui | 备注 |
|----|----------|------|--------|---------|------|
| M01 | 高度 1–4 行自适应 | 内容换行 | viewportLines=4 | `[x]` | `min(lines,4)` |
| M02 | 超过 4 逻辑行时视口跟随光标 | 内容 | TextArea 内部 | `[x]` | `input_view_start` |
| M03 | 前缀 ` ❯ `（固定列） | 常显 | InputBar | `[x]` | PROMPT_STR |
| M04 | 上报 inputLineCount（点选命中） | 内容变 | store | `[x]` | `input_update` → setInputLineCount(1–4)；Rust 点选本地 rect |
| M05 | Alt+Enter 插入换行 | Alt+Enter | TextArea / Help | `[x]` | |
| M06 | Enter = 提交（无补全时） | Enter | doSubmit | `[x]` | |
| M07 | 补全打开时藏 Event/Info | 补全 | Layout | `[x]` | |
| M08 | footerBg + inputFieldBg 双色 | theme | InputBar | `[x]` | |
| M09 | 长行软折行与鼠标列一致 | 自动 | TextArea | `[x]` | 输入 Paragraph 禁用 soft-wrap |
| M10 | Shift+Enter 换行 | Shift+Enter | 未作为主路径（文档 Alt+Enter） | `—` | 与 Ink 文档一致用 Alt+Enter |

---

## 3. 光标与导航

| ID | Ink 功能 | 键位 | Ink 源 | Ratatui | 备注 |
|----|----------|------|--------|---------|------|
| C01 | 受控 [line,col] 光标 | 每键 | placeCursor | `[x]` | byte/codepoint cursor |
| C02 | index ↔ cursor（补全/历史） | — | Completer | `[x]` | Node apply + input_set |
| C03 | 点击定位光标 | 单击 | useMouseInput + hit-test | `[x]` | |
| C04 | 首行 Up：非行首→行首/历史 | Up | onFirstLineUp | `[x]` | |
| C05 | 末行 Down → 历史 | Down | onLastLineDown | `[x]` | 末行光标不变时尝试历史 |
| C06 | 空缓冲 Left → Agents overlay | Left 空 | onFirstCharacterLeft | `[x]` | |
| C07 | 有选区时方向键折叠选区 | 方向键 | collapseSel | `[x]` | |
| C08 | 末尾追加乐观光标 | 尾插 | handleChange | `[x]` | Rust 本地草稿即时，无需乐观补丁 |
| C09 | 删除后钳制光标 | 删 | handleChange | `[x]` | |
| C10 | Home/End = **行**首尾（输入栏） | Home/End | TextArea 行语义 | `[x]` | `move_home_line` / `move_end_line` |
| C11 | 全屏编辑器滚轮移行 | 滚轮 | FSE + inputCursorShift | `[x]` | |
| C12 | 输入栏多行滚轮移光标 | 滚轮 | **Ink 也未接**（DESIGN 有） | `—` | 两侧均为 chat/历史优先 |

---

## 4. 选区与剪贴板

| ID | Ink 功能 | 键位 | Ink 源 | Ratatui | 备注 |
|----|----------|------|--------|---------|------|
| S01 | 输入框拖选 + 蓝底 | 拖 | useMouseInput input mode | `[x]` | |
| S02 | 拖出框 clamp | 拖 | clamp | `[x]` | |
| S03 | 单击不画零宽选区 | 单击 | 仅锚点 | `[x]` | |
| S04 | 松手复制 OSC52 + 系统剪贴板 + toast | 松手 | osc52 + toastCopy | `[x]` | |
| S05 | 复制用草稿切片（不含 `❯`） | 复制 | inputDraft extract | `[x]` | |
| S06 | Ctrl+C 复制输入选区 | Ctrl+C | useInputSelection | `[x]` | 有 sel 时 OSC52+toast，否则 Esc 栈 |
| S07 | 键入/粘贴清选区 | 编辑 | handleChange | `[x]` | |
| S08 | 打开 overlay 清选区 | overlay | effect | `[x]` | apply_in clears sel |
| S09 | 选区 live/release 动效 | 拖 | selFx | `[x]` | SelController flash 50ms → settle；LITE 跳过 |
| S10 | 双击选词 + 复制 | 双击 | chat/global 为主；input 有限 | `[x]` | Ratatui Input 已有 word_bounds |
| S11 | 三击选整段草稿 + 复制 | 三击 | — | `[x]` | Ratatui 有 |
| S12 | 键盘 Shift+方向扩展选区 | Shift+箭头 | **Ink 输入栏基本无** | `—` | |
| S13 | Shift+点击扩展选区 | Shift+点 | DESIGN；输入弱 | `—` | |

---

## 5. 历史

| ID | Ink 功能 | 键位 | Ink 源 | Ratatui | 备注 |
|----|----------|------|--------|---------|------|
| H01 | 提交后写入历史（max 20、连重去重） | 提交 | pushInputHistory → history.json | `[x]` | Node |
| H02 | 边界 Up/Down 浏览历史 | Up/Down | navigateHistory | `[x]` | |
| H03 | 浏览时暂存当前草稿，Down 到底恢复 | 历史 | savedInputRef | `[x]` | `historyDraft` in run-agent-ratatui |
| H04 | 浏览中编辑退出历史模式 | 编辑 | resetHistoryIndex | `[x]` | input_update → resetHistoryIndex |
| H05 | 应用历史关闭补全 | 应用 | applyHistoryText | `[x]` | |
| H06 | 应用后光标到文末 | 应用 | placeCursorAtIndex | `[x]` | input_set cursor |
| H07 | 输入区滚轮 = 历史 | 滚轮 | （Ink 输入区滚轮偏 chat） | `[x]` | Ratatui 明确 InputHistory |

---

## 6. 补全（`/` 与 `@`）

| ID | Ink 功能 | 键位 | Ink 源 | Ratatui | 备注 |
|----|----------|------|--------|---------|------|
| P01 | `/` 模糊+前缀补全 | 键入 | Completer.complete | `[x]` | Node |
| P02 | 目录：本地 slash + runtime + skills | 动态 | getSlashCommands | `[x]` | |
| P03 | 已是完整 slash 命令时关菜单 | 精确匹配 | complete | `[x]` | |
| P04 | `@` 路径补全（最多 24） | `@` | completeFilePath | `[x]` | |
| P05 | 菜单最多 5 行 + footer 提示 | 打开 | InputBar | `[x]` | |
| P06 | 选中行 `▸` + 高亮 | ↑↓ | InputBar | `[x]` | |
| P07 | ↑↓ 循环选项 | ↑↓ | cycleCompletion | `[x]` | complete_cycle |
| P08 | Tab 接受 | Tab | acceptCompletion | `[x]` | |
| P09 | **Enter 接受补全（不发送）** | Enter | doSubmit 优先 accept | `[x]` | 补全打开时 Enter→CompleteAccept |
| P10 | Esc 关补全 | Esc | escape-cancel | `[x]` | |
| P11 | 替换 completion.range / 后缀 | 接受 | applyCompletion | `[x]` | input_set |
| P12 | 刷新列表保持选中项 | 收窄 | updateCompletion | `[x]` | store 按 prev value 保 sel；completions 下发 sel |
| P13 | 已知 `/cmd` 字段内蓝色 | 渲染 | buildCommandLabels | `[x]` | input_paint slash 高亮 |
| P14 | 本地 slash 提交只开 UI 不气泡 | Enter | isLocalCommand | `[x]` | cli.send 路径 |
| P15 | 非本地 slash 当消息发出 | Enter | cli-session | `[x]` | |
| P16 | 点击补全行选中并接受 | 点击 | InputBar | `[x]` | CompleteSelect { index } |
| P17 | 补全区滚轮切换 | 滚轮 | — | `[x]` | CompleteCycle |

---

## 7. 提交 / 中断 / 排队

| ID | Ink 功能 | 键位 | Ink 源 | Ratatui | 备注 |
|----|----------|------|--------|---------|------|
| Q01 | Enter 发送并清空 | Enter | doSubmit → send | `[x]` | |
| Q02 | 流式中 Enter 入队 + toast | Enter | enqueueMessage | `[x]` | cli-session |
| Q03 | 流结束后自动 drain | done | app drain | `[x]` | cli-session finally |
| Q04 | 流式 placeholder「生成中…排队」 | streaming | InputBar | `[x]` | chrome placeholder |
| Q05 | 空闲 placeholder「/ · Ctrl+E」 | idle | InputBar | `[x]` | |
| Q06 | Esc 中断流（分层后） | Esc | escape-cancel | `[x]` | |
| Q07 | Ctrl+C 分层后双击退出 | Ctrl+C | app | `[x]` | |
| Q08 | 提交前恢复终端横向滚动 | submit | restoreTerminalViewport | `[x]` | submit 路径调用 restoreTerminalViewport（与 Ink doSubmit） |
| Q09 | 提交后清空草稿与光标 | submit | doSubmit | `[x]` | |
| Q10 | pendingSend（Goal 按钮） | store | requestSend | `[x]` | unsubPending |

---

## 8. 审批模式与底栏联动

| ID | Ink 功能 | 键位 | Ink 源 | Ratatui | 备注 |
|----|----------|------|--------|---------|------|
| A01 | Shift+Tab 循环 NORMAL/AUTO/YOLO | Shift+Tab | cycleApprovalMode | `[x]` | 需确认 Ratatui 热键表 |
| A02 | 写入 terminal-policy | 切换 | setTerminalMode | `[x]` | 共享 store 路径 |
| A03 | 审批条在输入上方、点选区域正确 | 审批 | TerminalApprovalBar | `[x]` | approval_rect + 点击 Y/A/N/B |
| A04 | Esc 拒绝审批（优先于输入选区） | Esc | escape-cancel | `[x]` | |
| A05 | 草稿计入 EventBlock token 估↑ | 草稿 | EventBlock draft | `[x]` | toProtoChrome idle draftEst |
| A06 | 补全打开时藏 EventBlock | 补全 | Layout | `[x]` | |

---

## 9. 从输入触发的 Overlay / 快捷键

| ID | Ink 功能 | 键位 | Ink 源 | Ratatui | 备注 |
|----|----------|------|--------|---------|------|
| O01 | 本地 slash → 对应 overlay | Enter `/model`… | runCommand | `[x]` | |
| O02 | 空 Left → agents | Left | InputBar | `[x]` | |
| O03 | Ctrl+K 命令板 | Ctrl+K | app | `[x]` | 确认 keys 表 |
| O04 | Ctrl+M 模型 | Ctrl+M | app | `[x]` | |
| O05 | Ctrl+, 设置 | Ctrl+, | app | `[x]` | |
| O06 | Ctrl+N 新会话 | Ctrl+N | app | `[x]` | |
| O07 | Overlay 打开时输入不接收编辑 | overlay | focus=false | `[x]` | keys 早退 |
| O08 | Esc 关一层 overlay | Esc | escape-cancel | `[x]` | |
| O09 | Ctrl+S 音效 | Ctrl+S | app | `[x]` | sound_toggle + toast |
| O10 | Ctrl+G 截屏/屏转文本 | Ctrl+G | app | `[x]` | ScreenDump OSC52 |

---

## 10. 全屏编辑器 Ctrl+E

| ID | Ink 功能 | 键位 | Ink 源 | Ratatui | 备注 |
|----|----------|------|--------|---------|------|
| F01 | 打开全屏，带入草稿 | Ctrl+E | openFullEditor | `[x]` | |
| F02 | Enter 仅换行 | Enter | FSE keybinding | `[x]` | |
| F03 | Esc 返回输入栏（不发送） | Esc | exitFullEditor false | `[x]` | |
| F04 | MD 轻量高亮 | 内容 | MD_LABELS | `[x]` | heading/quote/code/bold/italic |
| F05 | 字数/行数 footer | — | FSE | `[x]` | paint_full_editor_lines 底栏 |
| F06 | 选区 + BS | 拖/BS | useInputSelection | `[x]` | 拖选/双击/三击 + BS 删选区 |
| F07 | 滚轮移光标行 | 滚轮 | FSE | `[x]` | |
| F08 | 无外部 $EDITOR | — | 已删 | `[x]` | |
| F09 | 全屏内词/句删、鼠标点选 | — | FSE | `[x]` | 词/句/Delete + 点击/拖选 |
| F10 | 全屏软件光标可见 | — | FSE | `[x]` | `▌` + paint_full_editor_lines |
| F11 | Ctrl+S 发送（Ratatui 路径） | Ctrl+S | — | `[x]` | Ink UI 主路径 Esc 不发送；Ratatui 有 Ctrl+S submit |

---

## 11. 鼠标（输入区）

| ID | Ink 功能 | 键位 | Ink 源 | Ratatui | 备注 |
|----|----------|------|--------|---------|------|
| U01 | SGR 鼠标模式 | 启动 | enableMouse | `[x]` | crossterm |
| U02 | 过滤鼠标序列进输入 | 始终 | filtered-stdin | `[x]` | crossterm 解析 + scrub_input 双保险；无 Node filtered-stdin 同路径 |
| U03 | input 命中矩形 | 测量 | hit-test | `[x]` | |
| U04 | 指针形状 text/pointer | 移动 | osc22 | `[x]` | 有实现 |
| U05 | 单击 caret | 点 | — | `[x]` | |
| U06 | 拖选+复制 | 拖 | — | `[x]` | |
| U07 | 滚轮优先级 FSE>补全>chat | 滚轮 | useMouseInput | `[x]` | resolve_wheel_target：FSE>overlay>event>comp>input历史>chat |

---

## 12. IME / 粘贴 / 特殊键

| ID | Ink 功能 | 键位 | Ink 源 | Ratatui | 备注 |
|----|----------|------|--------|---------|------|
| I01 | 软件光标为主 | — | useImeCursor 禁用 HW | `[x]` | 两侧软件光标 |
| I02 | IME 候选窗钉点 | focus | pinHardwareCursorForIme | `[x]` | 每帧 `MoveTo`+Hide 钉 HW 光标到 caret（ime_pin_pos） |
| I03 | 横向溢出恢复 | 长预编辑 | terminal-viewport | `[x]` | overflow latch + CSI restore（同 Ink restoreTerminalViewport） |
| I04 | 粘贴后光标在块末 + 短锁 | Paste | pasteCursorLockRef | `[x]` | Event::Paste + paste_str 末尾光标 |
| I05 | UTF-8 不乱码 | IME | filtered-stdin | `[x]` | snap_char_boundary + scrub 保 UTF-8；TTY/crossterm 主路径 |
| I06 | 清功能键垃圾字符 | 键 | useCleanInput | `[x]` | 忽略 F-keys / Null / locks |
| I07 | 长粘贴占位符 | — | DESIGN only | `—` | Ink 也未做 |
| I08 | Bracketed paste 整块插入 | Paste | 部分经多 Char | `[x]` | EnableBracketedPaste |

---

## 13. 视觉 chrome

| ID | Ink 功能 | Ratatui | 备注 |
|----|----------|---------|------|
| V01 | ` ❯ ` 前缀 | `[x]` | |
| V02 | 底栏/字段双色 | `[x]` | |
| V03 | 补全面板 info 蓝 | `[x]` | |
| V04 | 补全 footer `↑↓ · Tab/Enter · Esc` | `[x]` | 行为已对齐 Enter=确认 |
| V05 | 空会话提示 | `[x]` | Layout 级 |
| V06 | Toast | `[x]` | |
| V07 | 已知 slash 字段内上色 | `[x]` | P13 |

---

## 14. Store / 会话集成

| ID | Ink 功能 | Ratatui | 备注 |
|----|----------|---------|------|
| T01 | completion 共享 | `[x]` | Node |
| T02 | history 持久化 | `[x]` | |
| T03 | pendingMessages 队列 | `[x]` | |
| T04 | inputDraft 镜像 | `[x]` | input_update |
| T05 | fullEditor 生命周期 | `[x]` | 协议齐；编辑能力弱 |
| T06 | streaming 占位 | `[x]` | |
| T07 | snapshot `state.input` 回写草稿 | Ink 本控 | `[~]` | Ratatui **故意不**应用 state.input，只认 input_set |

---

## 15. 优先修复队列

### 已完成（2026-07-15 本轮）

1. ~~P09 补全 Enter 接受~~  
2. ~~I04/I08 Bracketed paste~~  
3. ~~C10 Home/End 行语义~~  
4. ~~P16 点击补全行~~  
5. ~~P13 slash 高亮~~  
6. ~~E13 Forward Delete~~  
7. ~~F10 全屏软件光标 + F05 字数行数 + F09 词句删~~  
8. ~~H03/H04 历史草稿~~  
9. ~~S06 Ctrl+C 复制输入选区~~  
10. ~~硬件光标隐藏~~  

### 仍可后续抛光

- T07 snapshot `state.input` 故意不回写（Rust 草稿权威；非 bug）  
- **人工** Ink/Ratatui 并排手测签收（PARITY-SIGNOFF 结论栏）

### 不对齐也不算 Bug（Ink 同样缺）

- 输入栏多行滚轮移光标（C12）  
- 长粘贴占位（I07）  
- Kill-ring / Undo（E15/E16）  
- 键盘 Shift 选区（S12）  

---

## 16. 手测脚本（对照 Ink / Ratatui 各跑一遍）

```text
1. 键入 abc，中部插入，Backspace / Alt+BS / Ctrl+BS
2. Alt+Enter 两行；高度是否 cap 4
3. 空 Enter 无发送；有字 Enter 发送并清空
4. 生成中再 Enter → 排队 toast → 结束后自动发
5. 输入 /mo → ↑↓ → Tab 接受；再 /he → Enter 应「接受/执行」而非把半截当消息（P09）
6. @src 路径补全
7. ↑ 历史；编辑后再 ↑
8. 拖选复制；双击词
9. 点击定位光标（含中文）
10. Ctrl+E 全屏：Enter 换行，Esc 带回，是否看得见光标
11. 空缓冲 Left → agents
12. Shift+Tab 审批模式
13. 大段粘贴（bracketed paste）光标是否在末尾
14. Home/End 在多行第二行是否只动「行内」
```

签收：同一 cwd，`MAOU_TUI=ink` vs `MAOU_TUI=ratatui`，上表 P0 全绿后再谈「输入对齐」。

---

## 17. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-07-15 | 初版：Ink 全量盘点 + Ratatui 代码静态核对（未全部手测） |
| 2026-07-15 | 同步修复：refreshSupervisor 死循环（非输入，但阻断实测） |
| 2026-07-15 | P0/P1 输入对齐：Enter 补全、Paste、Home/End、Delete、点击补全、slash 高亮、全屏光标、历史草稿、Ctrl+C 复制选区；cargo test 38 ok + release/cli build |
| 2026-07-15 | 调度轮：全屏 MD 着色、全屏点击定位、overlay 清选区、chrome 草稿 token 估；cargo test 38 ok |
| 2026-07-15 | 调度轮：全屏拖选/双击三击复制/BS 删选区；F06/F09 勾选；cargo test 38 + release/cli build |
| 2026-07-15 | 调度轮：Shift+click 扩展 chat/global 锚点；光标闪烁相位；过滤 F-keys；cargo test + release |
| 2026-07-15 | 调度轮：idle ↑ 会话+草稿估算；输入禁 soft-wrap；审批条点击 Y/A/N/B；cargo test 39 + builds |
| 2026-07-15 | 调度轮：`scrub_input`（E02/U02）；submit `restoreTerminalViewport`（Q08）；idle ↑ +systemPrompt（A05）；勾选 M04/P12/S09/C08/U07；cargo test 44 + release/cli build |
| 2026-07-15 | 调度轮：I02 IME HW pin（ime_pin_pos+MoveTo）；I03 overflow latch+CSI restore；I05 勾选；cargo test 47 + release/cli build |
| 2026-07-15 | 调度轮：SystemEvent `>>>>[sym…]<<<<` 横幅+detail；GoalPanel 状态/按钮/验收色对齐 Ink；cargo test 48 + release/cli build |
| 2026-07-15 | 调度轮：SystemEvent 点击展开/收起 detail；Thinking 标题点击 ThinkingToggle；cargo test 50 + release/cli build |
| 2026-07-15 | 调度轮：MD link/strikethrough + 样式 wrap 保真；hover think/sys/expand + chrome 指针；gallery 居中；cargo test 52 + builds |
| 2026-07-15 | 一口气修：overlay 窗口点击；框线表格；审批 chip hover；工具运行自动展开；收起文案；LIVE；cache 色；jump 内容锚定；OSC22 门控；gallery 尺寸；cargo test 54 + builds |
| 2026-07-15 | EventBlock 监督 12 行展开+滚轮；tool result/diff 二级折叠；Nav 段 hover 变色；cargo test 55 + builds |
| 2026-07-16 | PerfHud 完整 5 行 process-stats（cpu/mem/load/phases/verdict）经 chrome.perf_lines；cargo test 55 + builds |
| 2026-07-16 | 上一条 user：对话区顶栏 + userBg 预览；Cmd/Ctrl+Shift+C 复制选区；cargo test 56 + builds |

**维护约定：** 只改输入相关代码时必须更新本文件对应行状态。
