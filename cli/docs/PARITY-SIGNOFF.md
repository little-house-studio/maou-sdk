# Ratatui 签收清单（对照 Ink）

用法：同一 cwd 下分别 `MAOU_TUI=ink` / `MAOU_TUI=ratatui` 跑同一流程，逐项打勾。

## 必须全绿才算「签收级」

### A. 启动与会话
- [x] 启动无崩溃、stdin TTY 正常（代码路径；2026-07-15）
- [x] last-session 恢复消息 + 工具卡（cli-session 共享）
- [x] `/new` 清空 + 画廊空态（共享 slash）
- [x] `/clear` 同清空

### B. 对话视觉
- [x] user：`▸` logo 列 + 灰底正文块（messages.rs）
- [x] assistant：`◈` + LIVE/spinner + 时码/耗时
- [x] loop 分隔 `↺ loop N`
- [x] thinking `* think` 可折叠观感 + **点击标题切换**（ThinkingToggle）
- [x] 工具卡：黄底 name + target + ▶/▼；**运行中自动展开**；展开有「▸ 输入 / ▸ 输出」
- [x] write/diff 结果有绿/红 diff 着色 + **二级折叠**（▼ 展开完整 diff）
- [x] 长文「▼ 展开 / ▲ 收起」可点
- [x] SystemEvent 横幅 + **点击展开/收起 detail**
- [x] MD：标题/列表/有序/**框线表格**/代码块/引用/粗斜体/**链接/删除线**

### C. 底栏 chrome
- [x] EventBlock：`THINK/GEN/TOOL/IDLE` + `NORMAL/AUTO/YOLO` 色块 + ◤◥
- [x] EventBlock **监督展开 12 行** + 滚轮（supervisor_messages）
- [x] InfoBar：`used/max` + 进度条 + **cache 命中着色** + model
- [x] Nav 五段可点 + **hover 变色**
- [x] 审批条 Y/A/N/B + **chip hover**
- [x] 回到最底部 / **上一条 user**（对话区顶栏 + 预览 + 内容锚定）
- [x] Cmd+C / Ctrl+Shift+C 复制选区（meta/super）

### D. 输入与补全
- [x] 多行 Alt+Enter；Enter 发送（代码；2026-07-15）
- [x] 光标中部编辑、点击定位（代码）
- [x] 词删 / 句删（代码）
- [x] 历史 ↑↓ + 草稿恢复（代码）
- [x] `/` `@` 补全，Tab/**Enter** 确认，↑↓ 选择（▸ 指针；代码）
- [x] 流式中 Enter 排队（cli-session 共享路径）

### E. 快捷键与 Esc
- [x] Esc 分层（共享 escape-cancel + Rust 本地选区）
- [x] Ctrl+C 双击退出；有选区时先复制
- [x] Ctrl+K/M/N/E/G/S/, Shift+Tab（代码路径）

### F. Overlay
- [x] command/model/sessions/help/settings/agents/prompt（代码路径）
- [x] SelectList 窗口 + ❯；滚轮；点击
- [x] 点外侧关闭（Escape）

### G. 鼠标
- [x] 滚轮 1 行（代码）
- [x] 拖选蓝底 + 松手复制（chat/global/input/**全屏**）
- [x] 双击词 / 三击行（含全屏）
- [x] 边缘自动滚（chat 拖选）
- [x] 工具/thinking/展开/SystemEvent/Nav 点击 + hover 高亮/手型

### H. 监督 / 其它
- [x] Goal 条 + 确认计划/验收（代码路径；按钮文案对齐 Ink GoalPanel）
- [x] SystemEvent 全宽 `>>>>[…]<<<<` 横幅（messages.rs）
- [x] PerfHud **5 行 process-stats**（perf_lines：cpu/mem/load/phases/verdict；`MAOU_PERF_HUD=0` 关）
- [x] `MAOU_LITE=1` 关 hover、缩历史（lite 字段）

---

**签收人：** ________  **日期：** ________  
**结论：** [ ] 通过  [ ] 有阻断项（列下）  
**代码路径（2026-07-16）：** 输入/IME/EventBlock/tool 折叠/Nav/PerfHud/上一条 user 顶栏/Cmd+C 等已代码对齐；清单 `[~]` 仅 T07（故意）；**缺** 人工并排手测。

阻断项：
1. 人工手测未跑（见 INPUT 清单 §16）
2.



