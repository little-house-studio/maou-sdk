# TUI 方案调研：Rust 生态 + Pi TUI 源码深读

> 调研日期 2026-07-02。为评估 maou CLI（当前 Ink 7/React/TS）的痛点能否由 Rust 或 Pi TUI 解决。
> 第三份"无限制全语言"调研另见 `RESEARCH-tui-all.md`（生成中）。

## maou CLI 当前痛点（Ink 7）

1. **#935**：内容超视口时 Ink 调 `clearTerminal`（含 `\e[3J`）抹 scrollback + `eraseLines` 行数算错导致顶部 `┌` border 丢失。upstream PR #936/#917 未合并。已用视口模式（不用 `<Static>`，限制渲染行数）绕过。
2. **无 z-index**：overlay 浮窗与下层重叠时背景不填空白格，文字穿透。已用"overlay 开时清空下层"绕过（牺牲浮窗语义）。
3. **无官方鼠标**：useInput 把 SGR 鼠标序列当文本插入乱码。已用 filtered-stdin 剥离 SGR 修复。
4. **无滚动组件**：`<Static>` 触发 #935。已用自管视口（估算行数 + chatScrollOffset）替代。
5. **高频重渲染 OOM（#869）/屏闪（#809）**：Claude Code 自己也中招。已用节流缓解。
6. **多 useInput 实例输入分发问题**：pty 测试时多字符 chunk 被当 paste，Enter 不触发。真终端逐键正常。

---

## 一、Rust 生态（ratatui + crossterm 为主）

### ratatui（首选 Rust 框架）
- 21.3k star，0.30.2（2026-06），活跃。fork 自 tui-rs（已归档）。
- **渲染模型**：immediate-mode + 双缓冲（`buffers: [Buffer; 2]`）+ cell 级 diff（`diff_iter` 零分配）。输入全帧重绘，输出只发变化 cell。
- **#935**：代码库**无 `3J`/`ClearScrollback` 调用**。不主动抹 scrollback。保留 scrollback 用 `Viewport::Inline` + `scrolling-regions` feature（v0.29，`insert_before()` 推进行进真实 scrollback）。
- **overlay**：无原生 z-index。`Clear` widget 是官方方案（对区域每 cell `reset()` 填空白格），有双宽字形 bug（#2526 open）。
- **鼠标**：crossterm `EnableMouseCapture` 默认启 SGR-1006，`parse_csi_sgr_mouse` 产出类型化 `MouseEvent`。无乱码。但多数 ratatui agent TUI（Codex/tenere）不处理鼠标。
- **滚动**：无通用 `Scrollable`。`List`+`ListState` 自管 offset。大列表无虚拟化（#1004）。
- **性能**：无 OOM 报告；失败模式 CPU/lag。inline 高吞吐仍闪（#584 open，需 `scrolling-regions`）。
- **IME**：**crossterm 完全不支持，无 API 无 issue**。终端协议层限制。

### 关键 Rust agent TUI 项目
- **Codex CLI（OpenAI，95k star）**：现存最复杂 ratatui agent TUI。**fork 了 `ratatui::Terminal`**（`codex-rs/tui/src/custom_terminal.rs`，`diff_buffers` line 585）拿 inline viewport + scrollback 保留 + OSC-8 宽度正确 + 4 unstable feature。**双区域流式 markdown**（`MarkdownStreamCollector` 换行门控 + `StreamCore` stable/tail 分区 + `table_holdback`）。Overlay 用 `Clear` + `Overlay` 枚举。**明确丢弃鼠标事件**。MIT 可抄。首要参考/fork 对象。
- **Nori CLI（147 star）**：Codex fork，继承全部 TUI 设计 + ACP 多 provider。
- **pythops/tenere（674 star）**：最小干净 ratatui chat 参考（~19 文件）。
- **MBrassey/agtop（14 star）**：ratatui popup + 鼠标模式参考。
- **Flywheel（15 star，停滞）**：唯一从零造 compositor（actor 模型 + FastPath 追加旁路 + RopeBuffer 1M 行 + dirty-rect diff），无 markdown。
- **Amazon Q CLI**：ratatui 仅 stub，实际 rustyline REPL。维护模式。
- **claude-code-rust**：名不副实，97.4% TS。

### Rust 流式 markdown
- `tui-markdown`（joshka，ratatui 维护者，345k 下载）：`pulldown-cmark` + `syntect`，非流式（每帧重解析）。
- 无成熟增量 markdown crate。**抄 Codex `markdown_stream.rs` + `streaming/table_holdback.rs`** 是最佳路径。

### Rust 能否完美解决？
6 痛点：2 完美（鼠标、输入分发）、3 基本但有摩擦（scrollback、overlay、滚动）、1 大幅缓解非完美（高频/OOM）。
**不完美**：IME 完全不支持；z-index+alpha 合成需 opentui（Zig）或第三方早期 crate；大列表无虚拟化。**Codex 不得不 fork ratatui** 说明 stock 不够。

---

## 二、Pi TUI（@oh-my-pi/pi-tui，TS）源码深读

源码 `earendil-works/pi` 仓库 `packages/tui/src/`。1.1MB，16.2.13，512 版本，活跃。

### 差分渲染（核心，tui.ts:1254-1620）
- **行级 diff**：`previousLines` vs `newLines` 逐行字符串比较，求 `firstChanged`/`lastChanged`，只重写变化区间。**不依赖"画了几行"状态**（Ink eraseLines 的根因）。
- **BSU（CSI 2026）**：所有输出包 `\x1b[?2026h...\x1b[?2026l` 原子刷新，消屏闪。Ink 7 无。
- **`\e[3J` 只在 fullRender(true)**：宽度/高度变化等罕见场景才发，普通增量只 `\e[2K` 单行。**顶部 border 丢失几乎不发生**（border 是某行，增量只重写变化行）。
- **物理 `\r\n` 推溢出行进终端原生 scrollback**：不用 `<Static>` + clearTerminal，避免 #935。

### overlay（tui.ts:1031-1091）
- **painter's algorithm + 行级合成**：overlay 行在 diff **前**覆盖 base 行，整行参与 diff，**天然不穿透**。9 锚点定位 + 百分比/绝对 row/col + margin + 响应式 visible。

### 滚动
- 无通用 ScrollView。Editor 自管 `scrollOffset` + `↑N more` 指示。超屏内容物理 `\r\n` 推 scrollback。

### 鼠标
- **不暴露鼠标事件 API**，但 StdinBuffer 正确界定 SGR-1006 序列（不污染文本）。半解。

### stdin 缓冲（stdin-buffer.ts）
- **序列界定**：按 CSI/OSC/DCS/APC/SS3 类型判断完整性，组件每次收单个完整序列。**解决 paste 误判**（bracketed paste 有明确标记，普通 `\r` 不被当 paste）。
- 超时 flush（10ms）+ Kitty 协议响应拼合 + 重复 printable 抑制。

### IME（tui.ts:120, 1627-1658）
- `CURSOR_MARKER = "\x1b_pi:c\x07"`（零宽 APC）。Focusable 组件在 render 输出插 marker，`extractCursorPosition` 扫描定位，`positionHardwareCursor` 移真硬件光标到 IME 位置。**隐藏光标但 IME 候选窗跟手**。

### 性能
- 16ms 节流（60fps 上限）+ 行级增量 + BSU + 组件 memo（Markdown 缓存）+ 只存上一帧（不累积，无 OOM）。

### markdown（components/markdown.ts，858 行）
- `marked` lexer + 自定义 token→ANSI + `applyBackgroundToLine` 铺满背景 + `trimPartialClosingFences` 处理流式不完整围栏 + `highlightCode` 可注入高亮器。缓存按 (text,width)。

### Pi TUI 解决 Ink 痛点
| 痛点 | Pi 解法 |
|---|---|
| #935 border 丢失 | 行级 diff 不依赖行数计数；`\e[3J` 只在 fullRender |
| overlay 穿透 | 行级合成（diff 前覆盖） |
| 鼠标乱码 | StdinBuffer 界定 SGR（半解，无交互 API） |
| 滚动 | 物理 `\r\n` 推 scrollback，不用 clearTerminal |
| OOM/屏闪 | 16ms 节流 + 增量 + BSU + memo + 只存上一帧 |

### 可直接借鉴到 Ink 的点
1. **BSU 包裹输出**（最低成本最大收益，消屏闪）
2. **bracketed paste + 序列界定**（解决 paste 误判）
3. **行级 diff 替代 eraseLines**（根本解决 border 丢失）
4. **物理 `\r\n` 推 scrollback 替代 `<Static>`**
5. **overlay 行级合成**
6. **CURSOR_MARKER 定位 IME**
7. **Editor 自管 scrollOffset + `↑N more`**

---

## 三、综合对比与建议

| 方案 | #935 | overlay | 鼠标 | 滚动 | OOM/闪 | IME | 流式md | 代价 |
|---|---|---|---|---|---|---|---|---|
| Ink+补丁（现状） | 视口绕过 | 清空下层 | filtered-stdin | 自管视口 | 节流 | useImeCursor | marked | 0 |
| Pi TUI（TS） | 行级diff根本解 | 行级合成 | 半解 | 物理推scrollback | 16ms+BSU | CURSOR_MARKER | marked+流式围栏 | 换框架（同 TS） |
| Rust ratatui | 无3J根本解 | Clear widget | 原生SGR | Viewport::Inline | 双缓冲diff | ❌不支持 | 抄Codex | 换语言+fork |

**结论**：
- **短期**：继续 Ink，加 BSU + 物理推 scrollback（借鉴 Pi），成本最低。
- **中期**：若 Ink eraseLines 仍不稳，引入 Pi 式行级 diff 层（同 TS，可复用）。
- **长期**：换 Rust + ratatui 抄 Codex（生产级，但 IME 需自己用 CURSOR_MARKER 补，跨语言集成成本高）。

**最值得立刻做**：给 Ink 输出加 BSU（`\x1b[?2026h...\x1b[?2026l`）+ 弃用 `<Static>` 改物理 `\r\n` 推 scrollback。

来源：[ratatui](https://github.com/ratatui/ratatui)、[crossterm](https://github.com/crossterm-rs/crossterm)、[Codex CLI](https://github.com/openai/codex)（`codex-rs/tui/`）、[Pi TUI](https://github.com/earendil-works/pi)（`packages/tui/src/`）、[Flywheel](https://github.com/0xchasercat/flywheel)、[opentui](https://github.com/anomalyco/opentui)、[tui-markdown](https://github.com/joshka/tui-markdown)。
