# Maou CLI 重构调研报告

> **状态**:调研阶段(未重构)。本文是后续大重构的事实底座,跨会话可查。
> **日期**:2026-07-01
> **目标**:为"贴合 DESIGN.md 的沉浸式 TUI"重构提供严肃、严谨的事实基础,排查官方规则、民间案例、所有已知 bug。
> **方法**:三路并行调研 —— ①读 `node_modules/ink` + `@inkjs/ui` 源码 + Ink 官方文档/issues;②查 xterm spec + 各终端官方文档 + 实测;③查 Claude Code/aider/Ink 生态/替代框架的源码与社区。
> **已定决策**:**升 Ink 7 + 自建补丁**、**务实核心优先**、**调研落盘**(即本文)。

---

## 0. 当前 CLI 现状(读完源码后)

### 0.1 文件清单(全部源码 ~700 行)

```
cli/
├─ DESIGN.md          # 旧设计愿景(沉浸式/弹窗/侧边栏/HUD…)
├─ README.md          # 描述了 HUD/sparkline/3D/OSC52/17页demo/clipboard.ts —— 多数不存在
├─ PLAN.md            # ← 不存在
├─ package.json       # 0.3.0: ink ^5.0.1, @inkjs/ui ^2.0.0, react-ink-textarea ^0.2.2, zustand ^4.5.2
├─ tsconfig.json
├─ scripts/smoke-demo.mjs   # 引用 src/demo.js(不存在)→ 跑不起来
└─ src/
   ├─ index.tsx       # 入口:加载 AgentCliConfig → render(<App/>)
   ├─ app.tsx         # 主应用 ~130 行
   ├─ types.ts        # AgentCliConfig 接口
   ├─ theme.ts        # 2 套主题(acid/vampire),let 导出(切不动)
   ├─ input-demo.tsx  # react-ink-textarea 独立 demo(与主程序无关)
   ├─ state/store.ts  # zustand ~103 行,含 onStream 事件折叠
   ├─ components/{ChatView,Modal,StatusBar}.tsx
   ├─ hooks/{useAgent,useCleanInput,useExternalEditor,useImeCursor,useMouse,useTerminalSize}.ts
   ├─ input/mouse.ts  # SGR-1006 鼠标解析(完备,可复用)
   └─ sdk/            # 空目录
```

### 0.2 README/DESIGN 与实现的诚实对账

| README 声称 | 实际 | 评级 |
|---|---|---|
| `clipboard.ts` OSC52 复制 | **不存在**(全仓 grep 只在 README + smoke-demo.mjs 命中) | 文档谎言 |
| `canvas/`、`image/`、`Panel`、`Gradient`、`Dialog`、`ScrollView`、`Collapsible`、`Hud`、`InputBox` | **全部不存在** | 文档谎言 |
| `dev/demo.tsx`、17 页验收 demo、`pnpm dev:demo`/`test:demo` | **不存在**;`smoke-demo.mjs` 引用的 `src/demo.js` 也不存在 | 文档谎言 |
| `PLAN.md`("完整设计规划") | **不存在** | 文档谎言 |
| 鼠标点击移光标 + 拖选 + OSC52 | `app.tsx:48` `useMouse(false, …)` **写死关闭**;`useImeCursor` **没被调用** | 实现未接线 |
| 主题运行时切换(`--theme cyber`) | `theme.ts` 导出 `let currentTheme`,`import {currentTheme as t}` 拿的是**导入快照**,`setTheme` 后已挂载组件不更新 | bug |
| 上下文占用条 + 缓存率 | `StatusBar` 用 `lastTok/maxCtx=100000`(硬编码);`store.ts` 从不把 `usage` 写进消息,`ChatView` 的 token 徽章是死代码 | 实现半残 |
| 对话区滚动 | `chatOffset` state **无任何代码修改它**(滚轮/方向键被注释),`offset` 永远 0 | 实现未接线 |

**结论**:这是一个 ~700 行的极简原型,披着一套完整 UI 框架的 README。重构第一步不是"加功能",是"先把文档与实现拉齐"。

### 0.3 已发现的具体 bug(静态阅读)

**P1(功能性):**
1. `store.ts` 的 `usage` 永不写入消息 → `ChatView.tsx:81` 的 token 徽章是死代码。
2. `tokenHistory` 在 `clearMessages` 清空,但 StatusBar 用 `lastTok` 算"上下文占用%"——语义不符(应反映累计上下文,非上一轮 token)。
3. `maxCtx = 100000` 硬编码,与 `preset` 里真实模型窗口脱钩,百分比是假的。
4. `app.tsx:48` `useMouse(false, …)` 写死关闭;`useImeCursor` 根本没调用。两个 hook 写了没用。
5. `Modal.tsx` 三处 `{position:"absolute",top:3,left:2}` —— **Ink 5 运行时静默丢弃 `top/left`**,弹窗贴父左上角,不在 (3,2)。
6. `index.tsx:61` 退出序列在从未启用鼠标时也发关闭序列;反之若中途启用 1002/1003 也关不干净(只关 1000/1006)。

**P2(健壮性):**
7. `app.tsx:28` 与 `index.tsx:49` 重复初始化 provider/model,可能竞态。
8. `store.ts` `tool_result` 靠 `tc.id===tool?.id || (!tool?.id && tc.name===tool?.name && !tc.done)` 匹配——并发同名工具 + 无 id 时会错配。
9. `ChatView` 没真滚动(见上)。
10. `Modal.tsx` 的 `as object` cast 掩盖了 `top/left` 运行时无效,TS 无法报警。
11. `useExternalEditor` 用 `spawnSync` 同步阻塞,流式中按 Ctrl+G 卡住事件循环。
12. `index.tsx:45` `NODE_ENV="production"` 全局污染 agent 配置的依赖分支。

**P3(代码卫生):**
13. `input-demo.tsx` 用 `react-ink-textarea`,主程序用 `@inkjs/ui` TextInput——两套输入方案并存,前者只被 demo 用却进了生产依赖。
14. `useCleanInput` 与 `useMouse`/`mouse.ts` 各自定义 `MOUSE_RE`,逻辑重复且 flag 不一致。
15. `theme.ts` `let currentTheme` 导出快照问题(见上)。

---

## 1. Ink 5 / Ink 7 官方规则与能力边界

> 来源:读 `node_modules/ink@5.2.1/build/*` + `@inkjs/ui@2.x/build/*` 源码;vadimdemedes/ink GitHub README(master=Ink 7)与各版本 `styles.ts` git 历史;issues #182/#439/#632/#765/#809/#829/#869/#929/#935/#955/#968。

### 1.1 版本事实(关键)

- 本地装的是 **ink@5.2.1**(`peer react>=18`,`react-reconciler ^0.29.0`,**无 react-dom**)。
- GitHub master 已到 **Ink 7.1.0**(React 19)。README 里 `useWindowSize`/`useCursor`/`useAnimation`/`useBoxMetrics`/`usePaste`/`cleanup()`/`alternateScreen`/`concurrent`/`maxFps`/`incrementalRendering` **多为 Ink 6/7 新增,Ink 5 没有**。

### 1.2 事件流:useInput / useStdin / useStdout / raw mode

- `useStdin`/`useStdout` 仅 `useContext` 返回流对象,无逻辑(`build/hooks/use-stdin.js`、`use-stdout.js`)。
- **raw mode 不是 `render()` 开的**,而是 `App.handleSetRawMode`(`build/components/App.js:104-131`)**引用计数**管理:首个 `useInput`(isActive=true)挂载时 `stdin.setRawMode(true)` + `addListener('readable', handleReadable)`,计数到 0 才真正关。
- **多 useInput 无抢占、无优先级、无 stopPropagation**:`handleReadable`(App.js:132-139)读 chunk → `handleInput`(处理 Ctrl+C/Tab/Esc 焦点)→ `emit('input', chunk)` 扇出给**所有** active 的 useInput handler,同一 tick 内都收到**同一份** input。唯一 opt-out 是 `options.isActive`。
- `@inkjs/ui` TextInput 内部用 `useInput`(`use-text-input.js:40,64`)。**外层 useInput 与 TextInput 的 useInput 同时收到同一字符,无法互相拦截。** 要单方收,只能 `isActive`/`isDisabled`。
- **含义**:外层 `useCleanInput` 与 TextInput 并存时,TextInput 会把没拦的字符(含鼠标 SGR 序列)当文本插入 —— 这是当前核心痛点。

### 1.3 鼠标:Ink 官方不支持

- **无 `useMouse`**。`index.d.ts` 导出无鼠标 hook;grep `mouse|sgr|1006` 零命中。examples/ 28 个无鼠标。
- 历次请求均关闭未合并:#632、#220、#955(PR,sindresorhus 指出布局坐标≠屏幕坐标等阻塞性 bug)、#968(扩展 `measureElement` 返回坐标,**Open,最有希望的官方切入点,未合并**)。
- **`useInput` 对 SGR 序列的处理**:`parseKeypress`(`build/parse-keypress.js`)识别不了 `ESC[<...M`(`[` 后跟 `<` 不匹配 fnKeyRe)→ `key.name=''`、`input=keypress.sequence` → handler 收到 strip 掉前导 ESC 的残缺串 `[<...M`。**Ink 既不解析也不吞鼠标序列,作为残缺文本泄漏。**
- 官方无替代。`useStdin` 的 `internal_eventEmitter` `'input'` 事件不是干净通道(已被 parseKeypress 污染)。
- **`useCleanInput` 吞序列非官方认可**,是自造防御层;且 TextInput 内部 useInput **不经** useCleanInput,治标不治本。

### 1.4 绝对定位 / overlay / Modal

- **Ink 5.2.1**:`position:"absolute"|"relative"` 类型与运行时**存在**(`Box.d.ts:10`,`styles.js:2-8` 调 `setPositionType`),但 **`top/left/right/bottom` 类型与运行时均不存在**——absolute 元素只能落到 Yoga 默认位置(父 content box 左上角),无法偏移。当前 `Modal.tsx` 的 `top:3,left:2` **运行时被静默丢弃**。
- **Ink 7.0.0+(2026-04-08,commit c2f4b86e0d)** 才加 `top/right/bottom/left`(`test/position.tsx` 断言 `<Box position="absolute" top={1} left={2}>` 渲染到 row1 col2)。
- **z-index 任何版本都没有**:无类型字段,`output.ts` 是 2D `StyledChar[][]`,`currentLine[offset]=character` 直接覆写,后写覆盖先写。唯一"z 序"是 React 树顺序,不可控。
- **无 Fixed、无 Portal**(`reconciler.js` 有 `preparePortalMount:()=>null` 但不暴露 createPortal 路径)。`@inkjs/ui` **无 Modal/Dialog/Overlay**(13 组件:TextInput/EmailInput/PasswordInput/ConfirmInput/Select/MultiSelect/Spinner/ProgressBar/Badge/StatusMessage/Alert/UnorderedList/OrderedList)。社区需自建条件渲染 + 树序控 z。
- issue #182(请求 absolute 做 dialog,Closed)、PR #439(加 position 样式,**owner vadimdemedes 关闭**,声明 absolute 是内部用于 `<Static>`、不打算扩展)。

### 1.5 样式:真彩 / 降级 / borderStyle / flex

- **真彩 hex 支持**:`colorize.js:18-22` `color.startsWith('#')` → `chalk.hex(color)(str)`;也支持 `rgb(r,g,b)`、`ansi256(n)`、chalk named。
- **降级委托 chalk**:Ink 自己无降级逻辑。chalk 5 按 `supports-color.level`:3(truecolor)→ `38;2;r;g;b`;2(256)→ `38;5;N`(hex 最近邻);1(16色)。level 探测:`COLORTERM=truecolor`/`TERM=xterm-kitty|ghostty|wezterm`/`TERM_PROGRAM=iTerm.app≥3` → 3;**`Apple_Terminal` → 2**(与不支持真彩吻合)。
- **borderStyle**:来自 `cli-boxes@3.0.0`,8 种:`single/double/round/bold/singleDouble/doubleSingle/classic/arrow`;也接受自定义对象。
- **flex 全支持**:`flexGrow/flexShrink/flexDirection/flexBasis/flexWrap/alignItems/alignSelf/justifyContent/gap/display/width/height(数或%)/margin/padding`。

### 1.6 React 18 兼容

- **Ink 5 不支持 concurrent rendering**:不调 `createRoot`(非 react-dom renderer),`reconciler.createContainer(rootNode, 0, ...)` tag=0=LegacyRoot,`getCurrentEventPriority:()=>DefaultEventPriority`。grep `createRoot|concurrent|StrictMode` 零命中。
- StrictMode 无特殊处理;raw-mode 引用计数对称,能扛双挂载。
- Ink 6/7 才有 `ConcurrentRoot` opt-in(#850)。React 19 需 Ink 7。

### 1.7 退出清理

- `exitOnCtrlC` 默认 true;true 时 Ctrl+C 在 useInput handler **之前**被拦截。
- `unmount()`(ink.js:175-205)顺序:最终渲染 → 注销 signal-exit → restoreConsole → unsubscribeResize → 卸载 React 树 → resolve waitUntilExit。`App.componentWillUnmount` 调 `cliCursor.show()` + `setRawMode(false)`。
- **Ink 退出只做:显光标、关 raw mode**。**不进/出 alt screen**(grep 1049 零命中),**不重置鼠标**(从不开)。所以手写 `?25h ?1049l ?1006l ?1000l` 与 Ink 不冲突。
- **但无崩溃安全网**:当前 `index.tsx:60-62` 只挂 `waitUntilExit().then()`,无 `process.on('exit'|'SIGINT'|'SIGTERM'|'uncaughtException')`。crash/SIGKILL 下终端卡死在 alt screen + 隐光标。Ink 的 signal-exit 只在正常信号下触发 unmount,且不写 alt-screen 退出序列。
- `cleanup()`/`alternateScreen` render option 是 **Ink 6/7 API**,Ink 5 必须手写 ANSI。

### 1.8 滚动 / 视口

- **Ink 无官方滚动组件/ hook**。issue #432(Closed)、#839(自撤)、#838(把 `ink-scroll-view` 加入"useful components"——官方事实推荐用社区库)。
- `overflow:'hidden'` **运行时有效但仅 paint-time**:`render-node-to-output.js:57-95` 算 clip 矩形 + `output.clip/unclip` 切片丢弃越界字符。Yoga 仍按自然尺寸布局,**无滚动/视口平移**——要做 viewport 得自建固定高 `overflow:'hidden'` Box + state 偏移。
- `@inkjs/ui` 无 ScrollArea;`Select` 的 `visibleOptionCount` 是**数组切片 windowing**(`use-select-state.ts` `visibleFromIndex/visibleToIndex`),非滚动容器。
- **#935(OPEN,生产级 bug)**:渲染循环在输出超视口时发 `CSI 3J` 抹终端 scrollback,每次重渲染都抹;明示下游报告存在于 **Claude Code 和 Codex CLI**。提议改 `eraseScreen + cursorTo(0,0)`。

### 1.9 响应式

- **Ink 5 无 `useWindowSize`**(Ink 7 才有)。Ink 内部 `stdout.on('resize')` 只调 `calculateLayout`(只传 width 不传 height)+ `onRender`,**不把 size 推入 React 树**——pure size 变化不自动触发组件重渲染。当前 `useTerminalSize.ts` 自建是**唯一正确做法**。

### 1.10 当前代码踩到的 Ink 陷阱(对照 src/)

| # | 陷阱 | 违反的规则 | 证据 | 严重度 |
|---|---|---|---|---|
| 1 | 鼠标 SGR 序列泄漏进 useInput 当文本 | Ink 不解析鼠标,#955 未合并 | `useCleanInput.ts:5-15`;`use-input.js:67,73-75` | 高 |
| 2 | TextInput 绕过 useCleanInput | TextInput 内部 useInput 不经 wrapper | `app.tsx:45-48` 注释自认;`use-text-input.js:40` | 高 |
| 3 | useMouse 用 `stdin.on('data')` 与 Ink `'readable'` 竞争 | data 监听器把 stream 切 flowing,可能抢走 chunk | `useMouse.ts:22`;`App.js:117-121,132-139` | 高(若开鼠标) |
| 4 | `top/left/backgroundColor` 在 Ink 5 运行时丢弃 | Ink 5 无 setPosition 调用 | `Modal.tsx:20,38,62`;`styles.js:2-8` | 高(布局错位) |
| 5 | `as object` cast 部分多余、部分掩盖 bug | position 本在类型内不需 cast | `Modal.tsx:20`;`app.tsx:101` | 中 |
| 6 | 退出无 `process.on('exit')` 兜底 | Ink unmount 不写 alt-screen 序列 | `index.tsx:60-62` | 高 |
| 7 | `exitOnCtrlC:false` + 手动 Ctrl+C,但 TextInput 吞 Ctrl+C | TextInput 的 useInput 对 ctrl+c early-return | `app.tsx:51-55` | 中 |
| 8 | IME 硬件光标靠手写 ANSI,与 Ink 渲染竞态 | Ink `cliCursor.hide()` 隐光标,useImeCursor 在 useEffect 写定位,下次 onRender 可能擦 | `useImeCursor.ts:22-43`;`App.js:94` | 中 |
| 9 | useExternalEditor 用 spawnSync 阻塞渲染循环 | 同步 spawn 冻结事件循环 | `useExternalEditor.ts:27-40` | 低 |
| 10 | ChatView 用消息条数猜高度 | Ink 无子树渲染高度 API | `ChatView.tsx:98-101` | 中 |
| 11 | 同名 MOUSE_RE 两个不同 flag(g vs 非 g) | 易误用 | `mouse.ts:25`;`useCleanInput.ts:5` | 低 |
| 12 | pino 日志污染 stdout 靠 NODE_ENV 静默 | 非根治 | `index.tsx:45` | 低 |

---

## 2. 终端底层 ANSI/DEC 规则

> 来源:xterm ctlseqs、各终端官方文档、tmux man、termstandard/colors、Alacritty/kitty/Ghostty/WezTerm changelog、Claude Code v2.1.89 cli.js 实测、本地 `cli/src/input/mouse.ts` 等。

### 2.1 鼠标 SGR 模式【xterm spec】

| 模式 | 行为 |
|---|---|
| `?1000` | 仅按下/释放 |
| `?1002` | + 按住拖动(button-event) |
| `?1003` | 所有移动(any-event,完全抢走原生拖选) |
| `?1006` | SGR 编码 `\x1b[<BTN;COL;ROW M/m`(1-based,编码层,可与任一追踪模式叠加) |
| `?1005` | UTF-8 坐标(旧,>127 列混乱,弃用) |
| `?1015` | urxvt 编码 |
| `?1016` | SGR 像素模式 |

- 1000/1002/1003 互斥;1006 是编码层。推荐 `1002+1006`(拖动)或 `1000+1006`(仅点击)。本地 `mouse.ts` 的 `enableMouse` 正是此组合。
- 滚轮 = 按钮 64/65,1000/1002 下均上报。本地 `parseMouse` 正确处理 `btn & 64`。
- **绕过原生拖选的修饰键(逐终端)**:xterm/WezTerm(默认 SHIFT,可配 ALT)/kitty/Shift/Ghostty=**Shift**;iTerm2=Shift 或 Option;Apple Terminal=Shift;**Windows Terminal 无 bypass 概念**(靠 copyOnSelect)。
- README 的 "Shift(xterm)/Option(iTerm2)" 偏窄,建议改 "Shift(xterm 系/WezTerm/kitty/Ghostty);iTerm2 亦可用 Option"。

### 2.2 OSC 52 剪贴板

- 格式 `\x1b]52;c:<base64>\x07`(`c`=CLIPBOARD,`p`=PRIMARY)。查询 `Pd=?`。
- **逐终端**:
  - iTerm2:支持,需手动开 "Applications in terminal may access clipboard"。
  - WezTerm:默认允许写,查询被忽略(安全)。
  - kitty/Ghostty:write 默认 allow,read 默认 ask(确认)。
  - Windows Terminal:默认开。
  - **Apple Terminal:不支持**。
  - Alacritty:0.13.0 起默认禁用,需配 `terminal.osc52`。
  - tmux:`set-clipboard on`(双向)/`external`(只出不进)/`off`;passthrough 转发外层终端。
- **安全**:远端 SSH 读剪贴板风险(恶意服务端发 `]52;c;?` 读密码)。kitty/Ghostty 读默认 ask;WezTerm 忽略查询;Alacritty 默认禁用。
- **"OSC52 是 Claude Code 新版做法"——属实**。实测 Claude Code v2.1.89 cli.js:确有 `]52;c;` + base64;有 SSH 守卫(`SSH_CONNECTION || SSH_CLIENT || SSH_TTY`);平台策略(macOS 非 SSH 用 pbcopy,tmux 用 tmux-buffer,否则 OSC52);CHANGELOG 2.1.144/153/157/161/162/176 多次修 copy-on-select(含 WSL 用 PowerShell 替代 OSC52)。

### 2.3 备用屏 ?1049h/l【xterm spec】

| 模式 | 保存光标 | 清屏 |
|---|---|---|
| `?47` | 否 | 否 |
| `?1047` | 否 | 退出时清备用屏 |
| `?1048` | 是(DECSC/DECRC) | 否 |
| `?1049` | 是(进入时 DECSC) | 进入时清备用屏;**不清主屏**,退出恢复主屏原貌+光标 |

- **macOS Apple Terminal 对 1049 长期有 bug**(光标不归位/scrollback 混入),行为更接近 47。本地 `index.tsx` 用 `\x1b[?1049h\x1b[H` 进入,Apple Terminal 上可能光标错位。

### 2.4 光标 ?25l/?25h 与 IME

- `?25h`=DECTCEM 显,`?25l`=隐。
- **IME 候选窗跟随硬件光标位置是终端实现选择,非规范**。`?25l` 隐光标后,部分终端 IME 框架取不到坐标 → 候选窗落角落。`useImeCursor` 的解决(输入框获焦时 `\x1b[<row>;<col>H\x1b[?25h` 定位+显)在 iTerm2/WezTerm/kitty/Ghostty 成立;**Apple Terminal IME 历史较弱**。

### 2.5 真彩 / 256 / 基色

- 基色 `3x/4x`(16);256 `38;5;N`;真彩 `38;2;R;G;B`(分号)或 `38:2:Pi:R:G:B`(冒号)。
- `COLORTERM=truecolor` 是事实标准检测,但**不被 sudo/ssh 默认转发**。
- **Ink 发 hex 时**:iTerm2/WezTerm/kitty/Ghostty → 真彩 `38;2;r;g;b`;**Apple Terminal → 降级 256 `38;5;N`**(chalk level 2)。

### 2.6 盲文与块字符画布

- 盲文 U+2800-U+28FF:每码点 8 位 = 2 列 × 4 行 = 8 像素亚像素画布。
- 块字符 `▀▄█░▒▓`:1 单元格可分上下半 = 1×2 亚像素。
- **string-width 实测**:盲文 `⠀⠷⣿` = 1(窄);CJK `你` = 2;emoji = 2。`useImeCursor` 用 stringWidth 逐字符累加,对盲文算 1、CJK 算 2,**正确**。
- **盲文字形渲染依赖终端字体**(Noto Sans Mono/Hack/Fira Code 等);缺字形显方框 → 画布失效。部署风险点。

### 2.7 全屏文字编辑器

- 本地 `useExternalEditor.ts`:退出备用屏 → `spawnSync($EDITOR, [tmp], {stdio:'inherit'})` → 重进备用屏 → 读文件。回退 `vi`。
- **坑**:编辑器异常退出时 catch 为空,主屏可能残留编辑器输出;tmux 下 `escape-time`(默认 10ms)影响 vim 的 Esc;无 vi 环境失败 → 返回 null(调用方需处理)。
- Ctrl+G 拦截在上层 useInput,`spawnSync` 后子进程 `stdio:inherit` 独占 stdin,绕过 Ink raw mode,编辑器直接读输入。

### 2.8 ANSI 序列与 Ink raw mode(漏网序列)

- "点击插入乱码"根因已由 `use-input.js` 源码确认:未识别序列 → `input=keypress.sequence` 原样传出。
- `useCleanInput` 的 `ANSI_RE=/\x1b\[[0-9;?]*[a-zA-Z<]/` **漏洞**:
  - **`~` 结尾的 CSI**(F5-F12 `\x1b[15~`、PgUp `\x1b[5~`、Ins `\x1b[2~`):末尾类 `[a-zA-Z<]` 不含 `~` → 不匹配。靠 parseKeypress 上游消化(`keyName` 表),但 ANSI_RE 本身不兜底。
  - **modifyOtherKeys/CSI u**(`\x1b[27;5;65~`):`~` 不匹配,且 parseKeypress 的 `keyName` 表无条目 → `input=sequence` **原样传出 → 插入乱码**(真实漏洞,终端开 modifyOtherKeys 时出现)。
  - **SS3**(`\x1bOP` F1-F4、`\x1bOA` 方向键):ANSI_RE 不匹配 `\x1bO`,但 parseKeypress 的 fnKeyRe 识别 → 上游消化。
  - **OSC/DCS 应答**(`\x1b]...\x07`、`\x1bP...\x1b\\`):不匹配,终端主动上报时原样插入(罕见)。
- **建议**:ANSI_RE 末尾类改 `[a-zA-Z<~]`,增补 SS3(`\x1bO[A-Z]`)与 OSC/DCS 头部匹配。
- `mouse.ts` 的 `MOUSE_RE`/`stripMouseSequences` **完备**覆盖 1006 SGR。

### 2.9 逐终端兼容性矩阵

| 特性 | iTerm2 | WezTerm | kitty | Ghostty | Apple Terminal | Win Terminal | tmux |
|---|---|---|---|---|---|---|---|
| OSC52 写 | 是(需开) | 是(默认允许) | 是(write allow) | 是(write allow) | **否** | 是(默认) | 是(on/external) |
| OSC52 读 | 同上需开 | 否(忽略查询) | 是(read ask) | 是(read ask) | 否 | 同上 | on 时双向 |
| 真彩 | 是 | 是 | 是 | 是 | **否** | 是 | 是(2.2+) |
| chalk level | 3 | 3 | 3 | 3 | **2** | 3 | 3 |
| SGR 鼠标 1006 | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| 备用屏 1049 | 是 | 是 | 是 | 是 | **有 bug** | 是 | 是 |
| 绕过修饰键 | Shift/Option | SHIFT(可配 ALT) | Shift | Shift | Shift | 无 | n/a |
| IME 跟随光标 | 是 | 是 | 是 | 是 | 弱 | 是 | 取决外层 |

**关键风险**:Apple Terminal 在 OSC52(不支持)/真彩(不支持,降级 256)/备用屏(1049 bug)三项均落后。若用户在 macOS 自带 Terminal,自绘 canvas + OSC52 + 真彩渐变**全受影响**,应提示换 iTerm2/WezTerm/Ghostty。

---

## 3. 民间与知名案例

> 来源:Claude Code 二进制 strings + CHANGELOG;aider `aider/mdstream.py`/`io.py`/`commands.py` 源码;vadimdemedes/ink、ink-picture、ink-three、ink-chart、@pppp606/ink-chart、ink-ui 源码;HN Algolia;blessed/terminal-kit/neo-blessed/blessed-contrib 源码;npm registry。

### 3.1 Claude Code 自己的 CLI —— 证伪"自建"

- **[确认] Claude Code 是 Ink/React 应用,不是自建 raw-ANSI。** 对 `@anthropic-ai/claude-code-darwin-arm64@2.1.197` 原生 Mach-O 二进制(227MB)做 strings:完整 React 运行时符号(`Symbol.for("react.element")`/`react.fragment`/`react.context`/`react.memo`/`react.lazy`)和 Ink hook(`useApp`×8、`useStdin`×2、`useStdout`×1、`useFocus`×2)。`react` 906 次、`ink` 81 次。应用源码闭源,以压缩 ESM bundle 嵌入。
- **[确认] Bun 编译的单文件应用(SEA)**:二进制含 `BunError-SourceLine`、`justify-react@19`、`VERSION:"2.1.197", BUILD_TIME:"2026-06-29T19:08:42Z"`。npm wrapper 注释:"After this runs, `claude` execs the native binary directly — no Node.js process stays resident."
- **[确认] 布局是 Ink/Yoga flexbox**,渲染进全屏 TUI;状态栏/页脚独立底部区域。CHANGELOG:2.1.181 "Fixed fullscreen TUI corruption (statusline mid-screen, duplicated spinner rows)";2.1.169 footer hints;2.1.176 `footerLinksRegexes`。
- **[确认] 鼠标 SGR-1006**:二进制含 `MOUSE_NORMAL:1000,MOUSE_BUTTON:1...1003,MOUSE_SGR:1006,FOCUS_EVENTS:1`。
- **[确认] OSC52 主剪贴板机制 + 平台回退**:二进制含 `]52;c;` + `wl-copy`/`xclip`/`xsel`/`pbcopy`/`pbpaste`/`clip.exe`。CHANGELOG 2.1.144(WSL 用 PowerShell 替代 OSC52)/153/157/161(Linux 用 wl-copy/xclip/xsel)/162/176。
- **[确认] 鼠标点击+拖选+copy-on-select**,由 `CLAUDE_CODE_DISABLE_MOUSE_CLICKS` env 门控。CHANGELOG 2.1.145(建议列表 hover/click)/187(选菜单 click)/181(modifier+drag 原生选区)/195(env 关闭 click/drag 保 wheel)/174(`wheelScrollAccelerationEnabled`)。
- **[确认] Ctrl+K 命令面板 / Ctrl+E 外部编辑器 / `/model` 选择器**:二进制含 `Command Palette`×3、`Ctrl+K`×18、`Ctrl+E` "Show last response in external editor"/`$EDITOR`/`$VISUAL`。
- **[推测 未证实]** "点击把光标移到宽字符位置"和"状态栏常驻实时 token 计数器"未在 CHANGELOG/strings 找到明确出处,看似源自第三方博客。底层机制(SGR-1006 + OSC-52)已确认,但这两个精确表述无独立出处。

**一句话**:Claude Code = Ink/React(Yoga)+ Bun 编译;SGR-1006 鼠标 + OSC52(带回退)+ Ctrl+K/Ctrl+E 全确认。"Claude Code 用 raw ANSI 自建"的传言**证伪**。但 Claude Code 正是 Ink #935(抹 scrollback)+ #809(屏闪)的生产受害者。

### 3.2 aider —— 双缓冲流式是黄金参考

- **[确认]** aider = `prompt_toolkit`(输入)+ `rich`(输出/流式)+ `pygments`(词法)+ `difflib`(diff)。无 Ink/textual/curses。
- **[确认] 多行输入三套机制**:`/multiline` 切换(Enter/Alt+Enter 对调)、`{ ... }` 花括号块、`Ctrl-X Ctrl-E` 开 `$EDITOR`。
- **[确认] 双缓冲流式 `MarkdownStream`(`aider/mdstream.py`)—— 直接借鉴**:`Live` 窗口只留最后 `live_window=6` 行"不稳定"行(可重绘);滚出窗口的行视为"稳定",用 `console.print(show)` 打印进永久滚动历史(不像纯 Live 抹历史)。节流自适应:`min_delay = min(max(render_time*10, 1/20), 2)`(渲染慢则退避到 2s)。`final=True` 全量 flush。自定义 rich 子类:`NoInsetCodeBlock`(代码块无内边距)、`LeftHeading`(H1 包 `Panel(box.HEAVY)`)。reasoning 内容包 `<reasoning>` 标签归一化。首 chunk 前 `WaitingSpinner`,首 chunk 到达即停。
- **[确认] diff 显示**:`diffs.py` 的 `diff_partial_update`(unified_diff n=5,去 `---`/`+++`,包进 ` ```diff ` markdown 走 Syntax 着色);partial 更新侧最后一行注入进度条 `"█"*filled + "░"*empty + " {n}/{total} lines [{bar}] {pct}%"`。
- **[确认] /commands**:`cmd_*` 约定分发(连字符/下划线等价,`!` 是 `/run` 的 shell 转义);约 40 命令;`ThreadedCompleter`(后台线程不阻塞)。
- **可借鉴 UX**:双缓冲流式、自适应节流、Enter/Alt+Enter 反转 + `{}` 块、输入行 inline markdown 词法、`cmd_*` 约定、ThreadedCompleter、diff 内进度条、`<reasoning>` 归一化、WaitingSpinner 自停、Ctrl+Z 挂起、`/tokens` 用量报告。

### 3.3 其他 Ink-based 成熟 TUI

- **在 10 个候选知名 CLI 中,只有 gatsby-cli 真用 Ink**(v3,devDep,rollup 打包)。其余:Wrangler=yargs+prompts;npm/cli=archy+nopt;Sentry=Rust;create-next-app=prompts+commander;**Fig→Amazon Q CLI=Rust+ratatui+crossterm**;Prisma=@inquirer/prompts;GitHub CLI=Go(cobra+lipgloss);expo=@expo/cli;terraform-docs=Go。
- **重点:Amazon Q CLI(Fig 继承者)是 Rust+ratatui**,是"沉浸式 agent 终端"最强参照,但不在 Ink 生态。
- 实现过高级效果的 Ink 项目:
  1. **endernoke/ink-picture** —— Ink 生态唯一通用绝对定位覆盖层+画布。`useDirectRenderer`(DECSC `\x1b7` 保存光标→cursorUp/Forward 到绝对坐标→写→DECRC `\x1b8` 恢复)+ `usePosition`(沿 Yoga 节点树累加 `getComputedLeft/Top`)+ `<Profiler>` onRender 重绘(因 Ink 每次重绘清屏)。渲染器:braille/halfBlock/kitty/iterm2/sixel。
  2. **QQ-NYC/zsh.nyc** —— 唯一 Ink 3D 线框。手写软件 3D 管线(视图+投影矩阵,投影后 `drawLine` 连顶点,无深度缓冲),`setInterval`+`useState` 动画,字符 `•─█` 非 braille。
  3. **denicprotopopov/ink-three**(npm `ink-three@0.3.0`)—— Ink 3D 光栅化(重心坐标三角形+逆深度缓冲+背面剔除+着色,亮度映射 `' .,:;+=*#%@'`)。
  4. **@pppp606/ink-chart**(npm `0.2.6`)—— **Ink 生态唯一确认的 sparkline**,`mode:'braille'`(⠀⠄⠆⠇⠏⠟⠿⣿)或 `'block'`(▁▂▃▄▅▆▇█),支持阈值/渐变/自动宽度。
  5. **vadimdemedes/ink-ui Select** —— Ink 滚动视口规范模式:`visibleFromIndex/visibleToIndex` 窗口切片(非真虚拟化)。
- **库存在性核实**(`npm view`):存在 `ink-chart`/`@pppp606/ink-chart`(Sparkline)/`ink-three`(3D)/`ink-big-text`/`ink-gradient`(静态无动画)/`ink-link`/`ink-select-input`/`ink-spinner`/`ink-text-input`/`ink-progress-bar`/`ink-table`/`ink-syntax-highlight`。**不存在(404)**:`ink-sparkline`/`ink-charts`/`ink-3d`/`ink-overlay`/`ink-modal`/`ink-popup`/`ink-accordion`/`ink-collapse`/`ink-viewport`/`ink-scroller`/`ink-tui`/`ink-toast`。`sparkly@6.0.1`(sindresorhus)存在但非 Ink 组件(返回字符串,deps 仅 chalk,可塞 `<Text>`)。`drawille@2.0.2`(braille 2D 画布底层原语,2D 非 3D)。

### 3.4 react-ink-textarea vs @inkjs/ui TextInput

| 能力 | react-ink-textarea 0.2.2 | @inkjs/ui TextInput 2.0.0 |
|---|---|---|
| 多行 | **是** | 否(单行) |
| 自适应高度/视口滚动 | **是**(`initialLineCount`+`viewportLines`+光标追逐) | 否 |
| 点击移光标/拖选 | 否(README 明示 "No mouse") | 否 |
| IME/CJK | **CJK 双宽正确**(string-width+Intl.Segmenter) | **broken**(issue #18 候选窗跑右下角,`cursorOffset+1` 不计双宽) |
| ref 编程式 API | **是**(`TextAreaHandle.insert(text)`) | 否(无 ref) |
| 输入语法高亮 | **是**(`labels` 规则) | 否 |
| onChange bug | #26 spuriously fire | #26 spuriously fire(`use-text-input-state.ts:186-190`) |
| 键绑定可定制 | **是**(`keybindings` per-chord,设 false 吞键) | 否(Enter 总提交) |
| 维护 | **活跃**:2026-06-28 发布,6 版本/2 月,正在关 bug | **停滞**:2024-05-22 最后发布(2 年前),21 open issue 无人理,不兼容 ink v6/React 19(#14) |

**结论**:用 react-ink-textarea 做多行输入+指令补全(活跃、专为该场景);Ctrl+E 全屏编辑器自建(覆盖其 Ctrl+E 键绑定 + 受控模式 + `$EDITOR`)。**不要用 @inkjs/ui TextInput**(单行、IME broken、onChange bug、停滞)。

### 3.5 社区对"Ink 做沉浸式 UI"的经验/吐槽

- **Ink 已知限制(主源 issue)**:绝对定位坏 CJK(#929 closed,`Output.write()` 固定列覆写撕裂);**无 z 序**;无内置鼠标(#632/#220/#765 open);**#935 抹 scrollback(OPEN,中招 Claude Code+Codex)**;#809 屏闪(closed,"many thousands of users");**#869 OOM(6.6/6.7,1ms setInterval 100s 到 304MB,"the more elements on the screen, the worse")**;#870 useCursor 要位置感知组件(OPEN)。
- **用 Ink 做出沉浸式的尝试**:InkCanvas(Discussion #832,braille 多色画布,**0 回复、单参与者、无采用**);Ink "Who's Using Ink?" 全是回合/网格游戏(扫雷/Wordle/数独),**无浮窗/折叠动画/braille sparkline/3D/HUD**。**未找到 Ink 原生沉浸式 HUD 成功案例。**
- **公认吐槽**:jitl(HN)"Ink leaves something to be desired... tried to build a Viewport, after scrolling 150 rows Ink rendered strangely, top line overflowed box bounds... suspect floating point in Yoga<-JS layer";ASalazarMX"why choose React for TUI, making a dune buggy out of a Hummer"。Flywheel 自称 "Zero-Flicker... No screen clears"(把 Ink 式 clear+redraw 当缺陷)。CellState(HN "React isn't the terminal UI bottleneck, the output pipeline is")保留 React 替换 Ink 输出管线(cell diff + native scrollback + frame coalescing + backpressure)。
- **离开 Ink 的项目去向**(2025-26 Show HN):claude-code-rust("because Ink got slow")、Nori("no flicker",Rust+ratatui 双缓冲)、Flywheel(Rust 双缓冲 diff)、CellState(自建 React 渲染器)、OpenCode(Zig+SolidJS,opentui)。**无一迁往 blessed。** Giggles 选择留在 Ink 上层叠补 focus/路由/导航。

### 3.6 纯 ANSI 自建替代框架

| 框架 | 维护 | 绝对定位 | z 序 | SGR 鼠标 | 画布 | 滚动 | 全屏 |
|---|---|---|---|---|---|---|---|
| **terminal-kit** | **活跃(2026-06-29)** | ✅ `moveTo`+parent-relative | ✅ `Element.zIndex`/`zChildren`/`.topZ/.bottomZ`(源码确认) | ✅ `grabInput({mouse})`+SGR-1006+Document z 序命中分发 | ✅ **ScreenBuffer+ScreenBufferHD(RGBA 合成器)** | ✅ `Container.scrollable`+`scrollTo` | ✅ `fullscreen()` |
| blessed | 停滞(2024-03) | ✅ CSS 式 absolute | ✅ `setIndex/setFront/setBack`+painter's | ✅ sgrMouse | ✅ Image/ANSIImage/Video | ✅ CSR/BCE | ✅ alternateBuffer |
| neo-blessed | 停滞(2021-04) | 同 blessed | 同 | 同 | 同 | 同 | 同 |
| 自建 raw-ANSI | — | 自写 | 自写 z 缓冲 | 自解析(本项目 `mouse.ts` 可复用) | drawille/terminal-image | `ansi-escapes.scrollUp/Down`+alt screen | `enterAlternativeScreen` |

- **terminal-kit 是唯一活跃维护且六项能力源码全确认的 Node 框架**;`ScreenBuffer.draw({delta:true})` 只绘变单元,对流式 token 天然友好。代价:命令式 API,丢 React/zustand。
- **自建 raw-ANSI 积木**(均活跃):`ansi-escapes`(sindresorhus,仅输出侧,无输入/鼠标)、`ansi-styles`(chalk)、`string-width`、`cli-cursor`、`wrap-ansi`、`yoga-layout`(可脱离 Ink 独立用做 flex)、`@tsports/go-osc52`(OSC52 emitter)、`terminal-image`(图形协议+块字符回退)。**SGR-1006 解析无独立流行 npm 包**,需从 blessed/terminal-kit(MIT)移植,或复用本项目 `input/mouse.ts`。

### 3.7 DESIGN.md 逐条愿景的可行性盘点

| DESIGN.md 愿景 | 谁已做/怎么做 | Ink 内可行性 | 陷阱 |
|---|---|---|---|
| 不透明弹窗(任意位置) | ink-picture `useDirectRenderer`(DECSC/DECRC + Yoga 树坐标 + Profiler 重绘);或 **Ink 7 原生 `position="absolute" top left`** | Ink5 ❌ / Ink7 ✅ 但无 z 序靠树序 | 重叠坏 CJK(#929) |
| 收纳侧边栏(左/右) | 无现成组件,blessed/terminal-kit 有;Ink 自建 | ⚠️ 自建 | — |
| 选择菜单(指令补全/模型) | react-ink-textarea README §6 slash-picker;Claude Code `/model` | ✅ | 当前用错 TextInput |
| 状态栏(底部) | Claude Code footer+`footerLinksRegexes`;本项目 `StatusBar.tsx` 已有 | ✅ | — |
| 输入框(自适应高度,≤4 行后滚,Ctrl+E 全屏) | react-ink-textarea `viewportLines`+光标追逐;Ctrl+E 自建 | ✅(换库后) | 鼠标滚轮自建(已有解析) |
| 上下文窗口(95% 面积,滚轮) | ink-ui Select 切片;aider **MarkdownStream 双缓冲**(强烈借鉴);terminal-kit scrollable | ⚠️ Ink 无真滚动 | #935 抹 scrollback |
| 卡片折叠/展开 | 无 Ink 动画库,`setInterval(16ms)`+缓动 `setHeight` 自建 | ⚠️ 自建 | — |
| 鼠标点击移光标(宽字符感知) | Claude Code 已做;自建:解析(col,row)+命中测试+string-width 算列 | ⚠️ 自建命中测试 | 与 TextInput 抢输入(#1/#2/#3) |
| 拖选+松手 OSC52 | Claude Code 已做;自建:SGR down/drag/up+自绘反色+`@tsports/go-osc52` | ⚠️ 自建 | 终端需支持 OSC52(Apple Terminal ❌) |
| Ctrl+K 命令面板 | Claude Code 已做;Ink=绝对定位浮窗+react-ink-textarea 暂停输入 | Ink5 ❌ / Ink7 ✅ | 同弹窗 |
| 响应式 | 本项目 `useTerminalSize` 已正确(Ink5 无 useWindowSize,自建唯一正解) | ✅ | — |
| HUD(token 血条/sparkline/3D/成本曲线) | `@pppp606/ink-chart` Sparkline(braille);3D 看 ink-three;token 计数自建 | ✅ sparkline / ⚠️ 3D | 3D 炫技,弱相关 |
| 图片→ASCII | `terminal-image`(图形协议+块字符);ink-picture 渲染器 | ✅ | 炫技,后置 |

---

## 4. 交叉验证的硬结论(≥2 份报告独立证实)

| # | 事实 | 证据 |
|---|---|---|
| 1 | 当前 CLI 锁 Ink 5.2.1,`top/left/backgroundColor` 是 **Ink 7.0.0(2026-04-08)** 才加;当前 `Modal.tsx` 的 `top:3,left:2` **运行时丢弃**,弹窗贴左上角 | 报告1读 `styles.js` + 报告3读 ink 各版本 `styles.ts` git 历史 |
| 2 | Ink **任何版本无 z-index**,唯一层序是 React 树序(后写覆盖先写),重叠坏 CJK(#929) | 报告1 grep `Box.d.ts` + 报告3 gh code search + issue #929 |
| 3 | **"Claude Code 用 raw ANSI 自建"证伪**——实为 Ink+React+Yoga,Bun 编译成原生二进制;SGR-1006+OSC52+Ctrl+K/E 全确认;"OSC52 是 Claude Code 做法"属实 | 报告2 CHANGELOG + 报告3 二进制 strings |
| 4 | Claude Code 正是 Ink #935(抹 scrollback)+ #809(屏闪)生产受害者 | 报告1 + 报告3 同批 issue |
| 5 | Ink 无官方鼠标(无 useMouse,#632/#220/#955 关闭);useInput 把 SGR 序列当残缺文本泄漏;当前 `input/mouse.ts` SGR-1006 解析完备可复用 | 报告1 Ink 源码 + 报告2 xterm spec 核验 |
| 6 | @inkjs/ui TextInput 停滞 2 年/单行/IME 错位(#18)/onChange bug(#26);react-ink-textarea 活跃(2026-06-28)/多行/CJK 正确/有 ref;当前主程序选错库 | 报告3 逐 issue 核实 |
| 7 | aider `MarkdownStream` 双缓冲(稳定行进历史+不稳定行小窗口+自适应节流)是流式渲染黄金参考 | 报告3 读 `mdstream.py` |
| 8 | 5 个 2025-26 Show HN 项目+OpenCode 把 Ink 输出管线当替换目标,去向 Rust+ratatui/Zig+SolidJS/自建 React 渲染器;**无一迁 blessed**;terminal-kit 是唯一活跃且六项能力全确认的 Node 框架 | 报告3 逐仓库核实 + 报告1/2 侧证 |

---

## 5. 战略矛盾与已定决策

### 5.1 核心矛盾

目标"贴合 DESIGN.md 沉浸式 UI"与"Ink 能力"存在张力:**DESIGN.md 的沉浸式特征(任意位置弹窗/z 序层叠/鼠标拖选自绘选区/长滚动历史)恰是 Ink 最弱处**——无 z 序、重叠坏 CJK、超视口抹 scrollback、无内置鼠标。把 Ink 当沉浸式 UI 用的最大案例 Claude Code 正是这些 bug 的受害者。

**留 Ink 路线 = 接受在瘸腿上叠自建补丁(Claude Code 已证明代价);换框架(terminal-kit/自建)= 沉浸式原生更强,但丢 React/zustand + 更高工作量。**

### 5.2 已定决策

1. **技术栈:升 Ink 7 + 自建补丁。** 理由:最贴合现有代码;Claude Code 已验证 Ink 可做到 Claude Code 级 UI;能复用已自建的 `input/mouse.ts`/`useExternalEditor`/`useImeCursor`/`useTerminalSize`;拿到 Ink 7 原生 `top/left`/`useCursor`/`useAnimation`/`cleanup()`/`alternateScreen`。代价:仍需自建鼠标命中测试、折叠动画、z 序(无)、OSC52;仍是 #935/#809 潜在受害者,需在渲染层规避。
2. **DESIGN.md 范围:务实核心优先。** 核心项先做扎实:可滚动上下文窗口(借鉴 aider 双缓冲)+ 不透明弹窗 + 多行输入(Ctrl+E 全屏)+ 鼠标移光标/拖选/OSC52 + 流式渲染。炫技项(3D 水晶/盲文 sparkline/图片→ASCII/侧边栏)后置或砍掉,DESIGN.md 同步删改。
3. **调研落盘:即本文 RESEARCH.md。**

### 5.3 升级 Ink 7 的连带影响(待方案阶段细化)

- Ink 7 需 React 19。
- `@inkjs/ui` 2.x **不兼容 ink v6+/React 19**(issue #14)——升级后需替换为 react-ink-textarea(已 peer `ink ^7`)。
- `react-ink-textarea` 已 peer `ink ^7`,升级后兼容。
- zustand ^4.5.2 与 React 19 兼容(zustand 4 支持 React 18/19)。
- #935(scrollback 抹除)在 Ink 7 仍未修,长跑全屏 TUI 需在渲染层规避(如 aider 双缓冲思路 / 不依赖终端 scrollback 而自管滚动历史)。

---

## 6. 重构方案边界(待展开为正式 plan)

> 本节是调研向方案过渡的提纲,具体 plan 待用户确认后用 EnterPlanMode 展开。

### 6.1 核心项优先级(务实核心)

1. **修文档与实现拉齐**:删/改 README 的谎言描述(clipboard.ts/canvas/17页demo/PLAN.md);补死代码或删掉(usage 徽章、chatOffset、useImeCursor 未调用、smoke-demo 引用的 demo.js)。
2. **升 Ink 7 + React 19**:换掉 `@inkjs/ui` TextInput → react-ink-textarea;处理 peer 兼容。
3. **流式渲染层**:借鉴 aider 双缓冲(稳定行进历史 + 不稳定行小窗口 + 自适应节流),规避 #935。
4. **可滚动上下文窗口**:基于 react-ink-textarea 的视口思路 + 自管滚动历史(不依赖终端 scrollback)。
5. **不透明弹窗(Ctrl+K 命令面板 / 模型选择 / 帮助)**:Ink 7 原生 `position="absolute" top left` + 树序控 z;处理重叠 CJK(#929)。
6. **多行输入 + Ctrl+E 全屏编辑器**:react-ink-textarea 受控模式 + 覆盖 Ctrl+E 键绑定 + `$EDITOR` 子进程。
7. **鼠标移光标 + 拖选 + OSC52**:复用 `input/mouse.ts` SGR-1006;自建命中测试 + string-width 算列 + 自绘反色选区 + `@tsports/go-osc52`;处理与 react-ink-textarea 的输入竞争(改走 `stdin.on('data')` 之外的通道,或 patch)。
8. **退出安全网**:`process.on('exit'|'SIGINT'|'SIGTERM'|'uncaughtException')` 兜底写 `?25h ?1049l ?1006l ?1000l`。
9. **状态/事件层分离**:把 `store.ts` 的 stream→UI 折叠逻辑评估是否下沉 SDK(与 maou-agent Feishu 插件重复);`useAgent` 的 `process.cwd()`/`HOME/.maou` 改由 `index.tsx` 注入。
10. **逐终端能力探测 + 降级**:检测 OSC52/真彩/备用屏支持,Apple Terminal 提示换终端 + 降级方案。

### 6.2 炫技项(后置/砍掉)

- 3D 水晶(ink-three 自建,弱相关,建议砍)
- 盲文 sparkline(@pppp606/ink-chart,token 曲线可用,后置)
- 图片→ASCII(terminal-image,后置)
- 左/右侧边栏(DESIGN.md 自称"暂时无内容",建议砍)

### 6.3 自建补丁清单(升 Ink 7 后仍需自建)

- 鼠标命中测试(无官方)
- 折叠动画(`setInterval`+缓动,Ink 7 `useAnimation` 可用)
- z 序(无,靠树序 + 渲染顺序)
- OSC52 emitter(`@tsports/go-osc52` 或自写)
- #935 规避(双缓冲 / 自管滚动历史)
- IME 光标定位(Ink 7 `useCursor` 可用,替代自写 useImeCursor)

---

## 附录 A:来源索引

**Ink 官方/源码**:
- 本地 `node_modules/ink@5.2.1/build/*`(hooks/use-input.js、parse-keypress.js、components/App.js、styles.js、colorize.js、ink.js、reconciler.js、output.js、render-node-to-output.js)
- 本地 `node_modules/@inkjs/ui@2.x/build/components/text-input/use-text-input.js`
- https://github.com/vadimdemedes/ink(master=Ink7 README;各版本 `src/styles.ts` git 历史;commit c2f4b86e0d 加 top/left;test/position.tsx)
- issues:#182 #439 #632 #765 #809 #829 #869 #870 #929 #935 #955 #968

**终端底层**:
- xterm ctlseqs https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
- termstandard/colors https://github.com/termstandard/colors
- WezTerm https://wezfurlong.org/wezterm/escape-sequences.html 、bypass_mouse_reporting_modifiers
- kitty conf https://sw.kovidgoyal.net/kitty/conf/
- Ghostty https://ghostty.org/docs/config/reference
- Alacritty changelog https://github.com/alacritty/alacritty/blob/master/CHANGELOG.md
- tmux man + CHANGES
- Windows Terminal https://learn.microsoft.com/en-us/windows/terminal/customize-settings/interaction
- Claude Code v2.1.89 cli.js 实测

**民间案例**:
- Claude Code 二进制 strings + CHANGELOG https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md
- aider https://github.com/Aider-AI/aider/blob/main/aider/mdstream.py 、io.py 、commands.py 、diffs.py
- ink-picture https://github.com/endernoke/ink-picture
- zsh.nyc three-d-engine.tsx
- ink-three https://raw.githubusercontent.com/denicprotopopov/ink-three/main/src/rasterizer.ts
- @pppp606/ink-chart https://raw.githubusercontent.com/pppp606/ink-chart/main/src/components/Sparkline.tsx
- ink-ui Select https://raw.githubusercontent.com/vadimdemedes/ink-ui/main/source/components/select/use-select-state.ts
- HN Algolia(jitl/ASalazarMX 帖)、Flywheel/CellState/Nori/claude-code-rust/OpenCode README
- blessed https://github.com/chjj/blessed(lib/program.js)、neo-blessed、blessed-contrib、terminal-kit https://github.com/cronvel/terminal-kit(lib/termconfig/xterm.js、Element.js、Document.js、ScreenBuffer.js、Container.js)

**本地源码(重构参考)**:
- `/Users/mac/Documents/vscodeProject/maou-sdk/cli/DESIGN.md`(愿景)
- `/Users/mac/Documents/vscodeProject/maou-sdk/cli/src/{index,app,types,theme}.tsx?`
- `/Users/mac/Documents/vscodeProject/maou-sdk/cli/src/components/{ChatView,StatusBar,Modal}.tsx`
- `/Users/mac/Documents/vscodeProject/maou-sdk/cli/src/hooks/{useMouse,useExternalEditor,useImeCursor,useTerminalSize,useCleanInput,useAgent}.ts`
- `/Users/mac/Documents/vscodeProject/maou-sdk/cli/src/input/mouse.ts`
- `/Users/mac/Documents/vscodeProject/maou-sdk/cli/src/state/store.ts`
- `/Users/mac/Documents/vscodeProject/maou-sdk/cli/src/input-demo.tsx`
- `/Users/mac/Documents/vscodeProject/maou-sdk/cli/package.json`
