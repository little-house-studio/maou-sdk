# oh-my-pi 仓库 TUI 功能全览

> 仓库：oh-my-pi（clone 于 `/Users/mac/.claude/jobs/aeed0f11/tmp/oh-my-pi-research/`）
> 范围：`packages/tui/src/`（pi-tui 包）+ `packages/coding-agent/src/modes/`、`packages/coding-agent/src/tui/`、`packages/coding-agent/src/tools/`（coding-agent 自研）
> 所有路径相对仓库根。行号为符号定义处，可直接 grep 定位。

---

## 1. 引擎核心（TUI 类、渲染、diff、scrollback、同步输出）

### TUI 主类 `TUI`
- 作用：差分渲染 TUI 引擎主类，管理组件树、光标、覆盖层、滚动提交与窗口重绘
- 关键词：`TUI`
- 路径：packages/tui/src/tui.ts:902
- 归属：pi-tui
- API：
```ts
export class TUI extends Container {
  constructor(terminal: Terminal, showHardwareCursor?: boolean, options?: TUIOptions)
  start(options?: TUIStartOptions): void
  stop(): void
  requestRender(force?: boolean, options?: RenderRequestOptions): void
  setFocus(component: Component | null): void
  showOverlay(component: Component, options?: OverlayOptions): OverlayHandle
  hideOverlay(): void
  addInputListener(listener: InputListener): () => void
}
```

### 容器类 `Container`
- 作用：子组件容器，对子组件渲染结果做引用相等性记忆化拼接
- 关键词：`Container`
- 路径：packages/tui/src/tui.ts:489
- 归属：pi-tui
- API：`class Container implements Component { addChild(c); removeChild(c); clear(); render(width): readonly string[] }`

### 组件接口 `Component`
- 作用：所有组件必须实现的核心接口，定义 render/handleInput/dispose 契约
- 关键词：`Component`
- 路径：packages/tui/src/tui.ts:140
- 归属：pi-tui
- API：`interface Component { render(width: number): readonly string[]; handleInput?(data: string): void; dispose?(): void }`

### 可聚焦接口 `Focusable`
- 作用：可接收焦点并显示光标的组件接口
- 关键词：`Focusable` / `isFocusable`
- 路径：packages/tui/src/tui.ts:323（`isFocusable`:336）
- 归属：pi-tui
- API：`interface Focusable { focused: boolean; setUseTerminalCursor?(b): void }`

### 光标标记 `CURSOR_MARKER`
- 作用：零宽度 APC 序列，组件在光标位置发出此标记，TUI 定位硬件光标
- 关键词：`CURSOR_MARKER`
- 路径：packages/tui/src/tui.ts:346
- 归属：pi-tui
- API：`export const CURSOR_MARKER = "\x1b_pi:c\x07"`

### 覆盖层选项/句柄 `OverlayOptions` / `OverlayHandle`
- 作用：覆盖层定位、尺寸、可见性、全屏配置接口；句柄控制隐藏/显示
- 关键词：`OverlayOptions` / `OverlayHandle`
- 路径：packages/tui/src/tui.ts:427 / :477
- 归属：pi-tui
- API：`interface OverlayOptions { width?; anchor?; fullscreen?; visible?(...); ... }` / `interface OverlayHandle { hide(); setHidden(b); isHidden() }`

### 滚动提交接口 `NativeScrollbackLiveRegion`
- 作用：组件报告本地滚动提交边界（live 区起点/提交安全终点/快照安全终点）
- 关键词：`NativeScrollbackLiveRegion`
- 路径：packages/tui/src/tui.ts:221
- 归属：pi-tui
- API：`interface NativeScrollbackLiveRegion { getNativeScrollbackLiveRegionStart(): number | undefined; getNativeScrollbackCommitSafeEnd?(): number | undefined }`

### 稳定前缀接口 `RenderStablePrefix`
- 作用：组件报告渲染数组中与上次字节相同的前导行数，引擎跳过重处理
- 关键词：`RenderStablePrefix`
- 路径：packages/tui/src/tui.ts:274
- 归属：pi-tui
- API：`interface RenderStablePrefix { getRenderStablePrefixRows(): number }`

### 视口尾部接口 `ViewportTailProvider`
- 作用：resize 快速路径下组件只渲染底部 maxRows 行的接口
- 关键词：`ViewportTailProvider`
- 路径：packages/tui/src/tui.ts:303
- 归属：pi-tui
- API：`interface ViewportTailProvider { renderViewportTail(width, maxRows): readonly string[] }`

### SGR 合并 `coalesceAdjacentSgr`
- 作用：将字节相邻的 SGR 序列合并为单个 CSI，减少每帧字节量
- 关键词：`coalesceAdjacentSgr`
- 路径：packages/tui/src/tui.ts:716
- 归属：pi-tui
- API：`function coalesceAdjacentSgr(line: string): string`

### 提交前缀重同步 `findCommittedPrefixResync`
- 作用：检测已提交前缀是否与当前帧对齐，返回需重新锚定的行号
- 关键词：`findCommittedPrefixResync`
- 路径：packages/tui/src/tui.ts:839
- 归属：pi-tui
- API：`function findCommittedPrefixResync(frame, prefix, auditTo?, exemptFrom?, exemptTo?, permanentEnd?): number`

### 终端接口 `Terminal` / `ProcessTerminal`
- 作用：终端抽象接口与基于 process.stdin/stdout 的真实实现（Kitty/modifyOtherKeys 探测、OSC 11 主题检测、DEC 2048）
- 关键词：`Terminal` / `ProcessTerminal` / `TerminalAppearance`
- 路径：packages/tui/src/terminal.ts:309 / :431 / :308
- 归属：pi-tui
- API：`interface Terminal { start(onInput,onResize); write(data); get columns(); setTitle(t); ... }` / `class ProcessTerminal implements Terminal`

### ConPTY 分块/检测 `chunkForConPTY` / `isConPTYHosted`
- 作用：将大数据按 UTF-8 字节分块避免 ConPTY 视口跟踪丢失 / 检测 ConPTY
- 关键词：`chunkForConPTY` / `isConPTYHosted`
- 路径：packages/tui/src/terminal.ts:88 / :390
- 归属：pi-tui
- API：`function chunkForConPTY(data, maxChunkBytes?): string[]` / `function isConPTYHosted(): boolean`

### 紧急终端恢复 `emergencyTerminalRestore`
- 作用：信号/崩溃处理中重置终端状态，无需 ProcessTerminal 实例
- 关键词：`emergencyTerminalRestore` / `setAltScreenActive`
- 路径：packages/tui/src/terminal.ts:262 / :161
- 归属：pi-tui
- API：`function emergencyTerminalRestore(): void` / `function setAltScreenActive(active: boolean): void`

### 循环看门狗 `LoopWatchdog`
- 作用：常驻事件循环延迟探测，超阈值时记录 ui.loop-blocked 及当前循环阶段
- 关键词：`LoopWatchdog`
- 路径：packages/tui/src/loop-watchdog.ts:38
- 归属：pi-tui
- API：`class LoopWatchdog { constructor(options?: LoopWatchdogOptions); start(); stop() }`

### 输入缓冲 `StdinBuffer`
- 作用：缓冲 stdin 输入并发射完整转义序列，处理分块到达的鼠标/粘贴事件
- 关键词：`StdinBuffer`
- 路径：packages/tui/src/stdin-buffer.ts:350
- 归属：pi-tui
- API：`class StdinBuffer extends EventEmitter { constructor(options?); process(data); flush(): string[]; destroy() }`

### 可见宽度 `visibleWidth`
- 作用：计算字符串终端可见列宽，排除 ANSI/OSC，修正制表符与韩文兼容字母
- 关键词：`visibleWidth`
- 路径：packages/tui/src/utils.ts:249
- 归属：pi-tui
- API：`function visibleWidth(str: string): number`

### 文本切片/截断/换行 `sliceWithWidth` / `truncateToWidth` / `wrapTextWithAnsi` / `extractSegments`
- 作用：按列切片/截断/带 ANSI 换行/提取段落
- 关键词：`sliceWithWidth` / `truncateToWidth` / `wrapTextWithAnsi` / `extractSegments`
- 路径：packages/tui/src/utils.ts:105 / :109 / :130 / :134
- 归属：pi-tui

### 文本缩放 `encodeTextSized`
- 作用：用 Kitty OSC 66 协议编码缩放文本跨度
- 关键词：`encodeTextSized`
- 路径：packages/tui/src/utils.ts:90
- 归属：pi-tui

### 词导航 `moveWordLeft` / `moveWordRight` / `getWordNavKind` / `isWordNavJoiner`
- 作用：Unicode 感知的词移动与字符分类
- 关键词：`moveWordLeft` / `moveWordRight` / `getWordNavKind`
- 路径：packages/tui/src/utils.ts:422 / :478 / :392
- 归属：pi-tui

### 紧凑模式 `setTuiTight` / `isTuiTight` / `getPaddingX`
- 作用：紧凑渲染模式控制与 padding 调整
- 关键词：`setTuiTight` / `isTuiTight` / `getPaddingX`
- 路径：packages/tui/src/utils.ts:560 / :564 / :568
- 归属：pi-tui

### 其他 utils 导出
- 关键词：`Ellipsis` / `DEFAULT_TAB_WIDTH` / `replaceTabs` / `padding` / `setHangulCompatibilityJamoWidth` / `normalizeTerminalOutput` / `sliceByColumn` / `applyBackgroundToLine`
- 路径：packages/tui/src/utils.ts（多处）
- 归属：pi-tui

---

## 2. 基础组件（components/）

### Box 容器 `Box`
- 作用：带内边距、背景、可选边框的容器组件
- 关键词：`Box` / `BoxBorder`
- 路径：packages/tui/src/components/box.ts:28 / :13
- 归属：pi-tui
- API：`class Box implements Component { constructor(paddingX?, paddingY?, bgFn?, border?); addChild(c); setBgFn(fn?) }`

### Editor 编辑器 `Editor`
- 作用：多行文本编辑器，支持自动补全、撤销、kill-ring、词导航、粘贴折叠、历史
- 关键词：`Editor` / `EditorTheme` / `EditorTopBorder`
- 路径：packages/tui/src/components/editor.ts:373 / :346 / :355
- 归属：pi-tui
- API：`class Editor implements Component, Focusable { setAutocompleteProvider(p); setText(t); insertText(t); pasteText(t); submit() }`

### Markdown 组件 `Markdown`
- 作用：Markdown 渲染组件，支持代码高亮、表格、数学公式、Mermaid、HTML 归一化
- 关键词：`Markdown` / `MarkdownTheme` / `clearRenderCache` / `renderInlineMarkdown`
- 路径：packages/tui/src/components/markdown.ts:792 / :507 / :467 / :1994
- 归属：pi-tui
- API：`class Markdown implements Component { constructor(text, paddingX, paddingY, theme, ...); setText(t); invalidate() }`

### ScrollView 滚动视图 `ScrollView`
- 作用：固定高度视口，带可选右侧滚动条，管理行偏移
- 关键词：`ScrollView` / `ScrollViewTheme` / `ScrollViewOptions`
- 路径：packages/tui/src/components/scroll-view.ts:55 / :10 / :15
- 归属：pi-tui
- API：`class ScrollView implements Component { setLines(l); setHeight(h); scroll(delta); scrollToBottom() }`

### SelectList 选择列表 `SelectList`
- 作用：可过滤、可滚动的选择列表，支持鼠标路由、悬停、描述换行
- 关键词：`SelectList` / `SelectItem` / `SelectListTheme` / `SelectListLayoutOptions`
- 路径：packages/tui/src/components/select-list.ts:84 / :24 / :32 / :51
- 归属：pi-tui
- API：`class SelectList implements Component, MouseRoutable { setFilter(f); setSelectedIndex(i); hitTest(line); clickItem(i); routeMouse(event,line,col) }`

### SettingsList 设置列表 `SettingsList`
- 作用：带分区、搜索、子菜单的设置列表，支持分栏布局
- 关键词：`SettingsList` / `SettingItem` / `SettingsListTheme` / `getSettingItemFilterText`
- 路径：packages/tui/src/components/settings-list.ts:93 / :16 / :35 / :82
- 归属：pi-tui

### TabBar 标签栏 `TabBar`
- 作用：水平标签栏，支持鼠标命中、悬停、缩短标签、循环切换
- 关键词：`TabBar` / `Tab` / `TabBarTheme`
- 路径：packages/tui/src/components/tab-bar.ts:56 / :16 / :28
- 归属：pi-tui

### Input 单行输入 `Input`
- 作用：单行文本输入组件，带水平滚动、kill-ring、撤销、词导航
- 关键词：`Input`
- 路径：packages/tui/src/components/input.ts:27
- 归属：pi-tui

### TruncatedText 截断文本 `TruncatedText`
- 作用：将文本截断至视口宽度的组件
- 关键词：`TruncatedText`
- 路径：packages/tui/src/components/truncated-text.ts:7
- 归属：pi-tui

### Loader 加载器 `Loader` / `CancellableLoader`
- 作用：旋转动画加载指示器 / 可用 Escape 取消并提供 AbortSignal
- 关键词：`Loader` / `CancellableLoader` / `LoaderMessageColorFn`
- 路径：packages/tui/src/components/loader.ts:20 / packages/tui/src/components/cancellable-loader.ts:13
- 归属：pi-tui

### Image 图像组件 `Image` / `ImageBudget`
- 作用：终端图像渲染组件（Kitty/iTerm2/Sixel 协议与文本回退）+ 图像 ID 预算管理
- 关键词：`Image` / `ImageBudget` / `ImageTheme` / `DEFAULT_MAX_INLINE_IMAGES`
- 路径：packages/tui/src/components/image.ts:301 / :63 / :12 / :39
- 归属：pi-tui

### Spacer 间隔 `Spacer`
- 作用：渲染指定数量空行的组件
- 关键词：`Spacer`
- 路径：packages/tui/src/components/spacer.ts:6
- 归属：pi-tui

### Text 文本 `Text`
- 作用：多行文本组件，带自动换行、边距、背景
- 关键词：`Text`
- 路径：packages/tui/src/components/text.ts:7
- 归属：pi-tui

---

## 3. 输入交互（键盘、鼠标、autocomplete、keybindings、剪贴板、paste）

### 键匹配/解析 `matchesKey` / `parseKey` / `Key`
- 作用：将原始终端输入匹配/解析为规范化键标识符；Key 为类型安全助手
- 关键词：`matchesKey` / `parseKey` / `Key`
- 路径：packages/tui/src/keys.ts:547 / :559 / :201
- 归属：pi-tui
- API：`function matchesKey(data, keyId): boolean` / `function parseKey(data): string | undefined` / `const Key = { escape, enter, ctrl(k), ... }`

### Kitty 键盘协议 `setKittyProtocolActive` / `isKittyProtocolActive` / `parseKittySequence`
- 作用：设置/查询 Kitty 键盘协议全局状态 / 解析 Kitty 序列
- 关键词：`setKittyProtocolActive` / `isKittyProtocolActive` / `parseKittySequence`
- 路径：packages/tui/src/keys.ts:66 / :73 / :369
- 归属：pi-tui

### 键释放/重复/可打印文本 `isKeyRelease` / `isKeyRepeat` / `extractPrintableText` / `decodePrintableKey`
- 路径：packages/tui/src/keys.ts:334 / :354 / :453 / :503
- 归属：pi-tui

### Windows Terminal / 退格 `isWindowsTerminalSession` / `matchesRawBackspace`
- 路径：packages/tui/src/keys.ts:32 / :47
- 归属：pi-tui

### 键绑定管理器 `KeybindingsManager` / `TUI_KEYBINDINGS`
- 作用：全局键绑定注册与匹配，支持用户覆盖、冲突检测
- 关键词：`KeybindingsManager` / `TUI_KEYBINDINGS` / `getKeybindings` / `setKeybindings` / `canonicalKeyId` / `addKeyAliases`
- 路径：packages/tui/src/keybindings.ts:242 / :57 / :332 / :328 / :185 / :217
- 归属：pi-tui
- API：`class KeybindingsManager { matches(data, keybinding): boolean; getKeys(keybinding): KeyId[]; getConflicts() }`

### 自动补全提供器 `CombinedAutocompleteProvider`
- 作用：组合斜杠命令与文件路径的自动补全提供器
- 关键词：`CombinedAutocompleteProvider` / `AutocompleteProvider` / `AutocompleteItem` / `SlashCommand` / `findLeadingSlashCommandStart`
- 路径：packages/tui/src/autocomplete.ts:368 / :194 / :170 / :180 / :65
- 归属：pi-tui
- API：`class CombinedAutocompleteProvider implements AutocompleteProvider { getSuggestions(lines, line, col): Promise<{items, prefix}|null>; applyCompletion(...) }`

### 括号粘贴处理 `BracketedPasteHandler`
- 作用：处理括号粘贴模式缓冲，组装跨分块的完整粘贴内容
- 关键词：`BracketedPasteHandler` / `decodeReencodedPasteControls` / `PasteResult`
- 路径：packages/tui/src/bracketed-paste.ts:69 / :37 / :4
- 归属：pi-tui
- API：`class BracketedPasteHandler { constructor(options?); process(data): PasteResult }`

### Kill 环 `KillRing`
- 作用：Emacs 风格 kill/yank 环形缓冲，支持累积合并与轮转
- 关键词：`KillRing`
- 路径：packages/tui/src/kill-ring.ts:10
- 归属：pi-tui
- API：`class KillRing { push(text, opts); peek(): string | undefined; rotate() }`

### SGR 鼠标解析/路由 `parseSgrMouse` / `routeSgrMouseInput` / `routeSelectListMouse` / `MouseRoutable`
- 作用：解析 SGR 鼠标报告为结构化事件；转发给处理器；为 SelectList 类目标做滚轮/悬停/点击命中；定义 MouseRoutable 组件契约
- 关键词：`parseSgrMouse` / `routeSgrMouseInput` / `routeSelectListMouse` / `SgrMouseEvent` / `MouseRoutable` / `SelectListMouseTarget`
- 路径：packages/tui/src/mouse.ts:34 / :56 / :80 / :12 / :102 / :68
- 归属：pi-tui
- API：`function parseSgrMouse(data): SgrMouseEvent | null` / `function routeSelectListMouse(target, event, line): boolean` / `interface MouseRoutable { routeMouse(event, line, col): void }`

### 表情补全 `getEmojiSuggestions` / `applyEmojiCompletion` / `expandEmoticons`
- 作用：`:shortcode` 与西方表情符（`:D` `:-)` `<3`）的补全建议、内联替换、提交时展开
- 关键词：`getEmojiSuggestions` / `applyEmojiCompletion` / `tryEmojiInlineReplace` / `isEmojiPrefix` / `expandEmoticons`
- 路径：packages/coding-agent/src/modes/emoji-autocomplete.ts:131 / :167 / :245 / :249 / :258
- 归属：coding-agent 自研

### 内部 URL 补全 `getInternalUrlSuggestions` / `extractInternalUrlContext`
- 作用：`skill://` `rule://` `omp://` `local://` `memory://` `agent://` `artifact://` 等 scheme 的模糊匹配补全
- 关键词：`getInternalUrlSuggestions` / `extractInternalUrlContext` / `isInternalUrlPrefix` / `applyInternalUrlCompletion`
- 路径：packages/coding-agent/src/modes/internal-url-autocomplete.ts:93 / :23 / :131 / :140
- 归属：coding-agent 自研

### 提示动作补全 `PromptActionAutocompleteProvider`
- 作用：组合补全——`#` 触发动作（复制行/复制提示/撤销/光标移动）、内部 URL、表情、基础斜杠命令
- 关键词：`PromptActionAutocompleteProvider` / `createPromptActionAutocompleteProvider`
- 路径：packages/coding-agent/src/modes/prompt-action-autocomplete.ts:96 / :205
- 归属：coding-agent 自研

### 键绑定匹配器 `matchesAppInterrupt` 等
- 作用：判断输入字节流是否匹配特定快捷键（中断、取消、上下、翻页、外部编辑器、follow-up）
- 关键词：`matchesAppInterrupt` / `matchesSelectCancel` / `matchesSelectUp` / `matchesSelectDown` / `matchesSelectPageUp` / `matchesSelectPageDown` / `matchesAppExternalEditor` / `matchesAppFollowUp`
- 路径：packages/coding-agent/src/modes/utils/keybinding-matchers.ts:10 起
- 归属：coding-agent 自研

### 快捷键提示格式化 `keyHint` / `appKeyHint` / `editorKey` / `rawKeyHint`
- 作用：格式化快捷键提示字符串（dim key + muted 描述）
- 关键词：`keyHint` / `appKeyHint` / `editorKey` / `appKey` / `rawKeyHint`
- 路径：packages/coding-agent/src/modes/components/keybinding-hints.ts:39 / :52 / :20 / :27 / :63
- 归属：coding-agent 自研

### 自定义编辑器粘贴/图片检测 `extractPastePathsFromText` 等
- 作用：从粘贴文本/bracketed paste 中提取文件路径与图片路径
- 关键词：`extractPastePathsFromText` / `extractBracketedPastePaths` / `extractBracketedImagePastePaths` / `extractImagePastePathsFromText` / `extractImagePathFromText`
- 路径：packages/coding-agent/src/modes/components/custom-editor.ts:217 / :221 / :228 / :239 / :273
- 归属：coding-agent 自研

---

## 4. 布局/容器（Container、overlay、焦点管理）

### 覆盖层边框工具 `topBorder` / `fit` / `divider` / `bottomBorder` / `row` / `splitRow`
- 作用：全屏覆盖层共享的圆角边框 chrome（topBorder/divider/bottomBorder/row/split 布局 helper）
- 关键词：`topBorder` / `fit` / `divider` / `bottomBorder` / `row` / `splitBodyWidth` / `topBorderSplit` / `dividerSplit` / `splitRow`
- 路径：packages/coding-agent/src/modes/components/overlay-box.ts:26 / :11 / :40 / :45 / :51 / :68 / :73 / :93 / :104
- 归属：coding-agent 自研

### 选择器辅助工具 `renderScrollableList` 等
- 作用：选择器/列表/面板共享脚手架——ScrollView 渲染、居中窗口、行宽计算、选择钳制、Tab 切换
- 关键词：`renderScrollableList` / `centeredWindow` / `contentRowWidth` / `clampSelection` / `searchableChar` / `handleTabSwitchKey` / `padLinesToHeight`
- 路径：packages/coding-agent/src/modes/components/selector-helpers.ts:16 / :35 / :49 / :59 / :87 / :106 / :124
- 归属：coding-agent 自研

### SelectList 鼠标路由（带顶边框）`routeSelectListMouseWithTopBorder`
- 作用：将 SGR 鼠标事件路由到带顶部边框的 SelectList（wheel/hover/click），偏移顶部边框行
- 关键词：`routeSelectListMouseWithTopBorder`
- 路径：packages/coding-agent/src/modes/components/select-list-mouse-routing.ts:11
- 归属：coding-agent 自研

### 动态边框 `DynamicBorder`
- 作用：按视口宽度调整的水平圆角边框组件（缓存渲染结果）
- 关键词：`DynamicBorder`
- 路径：packages/coding-agent/src/modes/components/dynamic-border.ts:11
- 归属：coding-agent 自研

### 对话容器 `TranscriptContainer` / `TranscriptBlock`
- 作用：transcript 容器——逐块渲染、增量组装、native scrollback live-region 接缝管理、稳定前缀棘轮、视口尾部快速渲染
- 关键词：`TranscriptContainer` / `TranscriptBlock`
- 路径：packages/coding-agent/src/modes/components/transcript-container.ts:419 / :806
- 归属：coding-agent 自研
- API：`class TranscriptContainer extends Container { isBlockInLiveRegion(c); renderViewportTail(width,maxRows); getRenderStablePrefixRows() }`

### 设置向导覆盖层 `SetupWizardComponent`
- 作用：设置向导顶层组件，管理 splash→transition→scene→outro 阶段，跨帧溶解动画
- 关键词：`SetupWizardComponent` / `runSetupWizard` / `ALL_SCENES`
- 路径：packages/coding-agent/src/modes/setup-wizard/wizard-overlay.ts:65 / setup-wizard/index.ts:74 / :15
- 归属：coding-agent 自研

### 移动覆盖层 `MoveOverlay`
- 作用：`/move` 路径输入覆盖层——实时目录自动补全 + Tab 补全 + Enter 确认
- 关键词：`MoveOverlay` / `resolveMovePath` / `resolveExistingDirectory`
- 路径：packages/coding-agent/src/modes/components/move-overlay.ts:156 / :80 / :89
- 归属：coding-agent 自研

---

## 5. coding-agent 的对话区组件

### 对话记录构建器 `ChatTranscriptBuilder`
- 作用：从持久化 session 消息条目重建/追加整个 transcript
- 关键词：`ChatTranscriptBuilder`
- 路径：packages/coding-agent/src/modes/components/chat-transcript-builder.ts:78
- 归属：coding-agent 自研

### 对话块基类 `ChatBlock`
- 作用：生命周期感知的 transcript block 基类（mount/finish/dispose），所有自管理 block 继承它
- 关键词：`ChatBlock` / `ChatBlockHost`
- 路径：packages/coding-agent/src/modes/components/chat-block.ts:29 / :7
- 归属：coding-agent 自研

### 消息卡片框渲染 `renderFramedMessage`
- 作用：extension/hook 自定义消息的共享框渲染——优先自定义 renderer，失败回退到 icon+markdown 卡片
- 关键词：`renderFramedMessage` / `FramedMessage` / `FramedRenderer` / `RebuildFrameOptions`
- 路径：packages/coding-agent/src/modes/components/message-frame.ts:50 / :17 / :27 / :33
- 归属：coding-agent 自研

### 工具执行组件 `ToolExecutionComponent`
- 作用：渲染单个工具调用及其结果（可更新），处理 spinner 动画、edit diff 预览、图片、JSON 树、多文件编辑
- 关键词：`ToolExecutionComponent` / `ToolExecutionHandle` / `ToolExecutionOptions` / `sharedSpinnerFrame` / `SPINNER_RENDER_INTERVAL_MS`
- 路径：packages/coding-agent/src/modes/components/tool-execution.ts:206 / :170 / :160 / :195 / :188
- 归属：coding-agent 自研

### 助手消息组件 `AssistantMessageComponent`
- 作用：渲染完整 assistant 消息（text/thinking blocks），含流式 thinking 脉冲动画、速度徽章、缓存失效标记
- 关键词：`AssistantMessageComponent` / `resetThinkingSpeedTracker`
- 路径：packages/coding-agent/src/modes/components/assistant-message.ts:188 / :162
- 归属：coding-agent 自研

### 用户消息组件 `UserMessageComponent`
- 作用：渲染用户消息气泡（Markdown + magic keyword 高亮 + 图片引用占位符 + OSC133 shell 集成标记）
- 关键词：`UserMessageComponent`
- 路径：packages/coding-agent/src/modes/components/user-message.ts:16
- 归属：coding-agent 自研

### Read 工具分组 `ReadToolGroupComponent`
- 作用：将连续的 read 调用聚合为一组，渲染路径树/摘要行 + 可选代码内容预览（折叠/展开）
- 关键词：`ReadToolGroupComponent` / `readArgsHaveTarget` / `readArgsTargetInternalUrl`
- 路径：packages/coding-agent/src/modes/components/read-tool-group.ts:288 / :27 / :31
- 归属：coding-agent 自研

### Bash 执行组件 `BashExecutionComponent`
- 作用：渲染用户发起的 bash 命令执行，流式输出 + 折叠预览 + 退出状态 + sixel 透传
- 关键词：`BashExecutionComponent`
- 路径：packages/coding-agent/src/modes/components/bash-execution.ts:36
- 归属：coding-agent 自研

### Eval 执行组件 `EvalExecutionComponent`
- 作用：渲染用户发起的 eval（python/js）执行，共享 bash 的框架
- 关键词：`EvalExecutionComponent` / `EvalExecutionLanguage`
- 路径：packages/coding-agent/src/modes/components/eval-execution.ts:24 / :22
- 归属：coding-agent 自研

### 执行共享原语 `buildExecutionFrame` / `buildStatusFooter` / `createCollapsedPreview` / `resolveExecutionStatus`
- 作用：bash/eval 共享的框架原语——动态边框 + 内容容器 + Loader 构建、折叠预览、状态脚注
- 关键词：`buildExecutionFrame` / `buildStatusFooter` / `createCollapsedPreview` / `resolveExecutionStatus` / `ExecutionStatus` / `ExecutionColorKey`
- 路径：packages/coding-agent/src/modes/components/execution-shared.ts:27 / :67 / :55 / :97 / :16 / :19
- 归属：coding-agent 自研

### 自定义编辑器 `CustomEditor`
- 作用：主输入编辑器，处理可配置应用级快捷键、magic keyword shimmer 动画、bracketed paste 路径/图片检测、push-to-talk 空格长按手势
- 关键词：`CustomEditor` / `SPACE_REPEAT_MAX_GAP_MS` / `SPACE_HOLD_MECHANICAL_RUN`
- 路径：packages/coding-agent/src/modes/components/custom-editor.ts:289 / :82 / :93
- 归属：coding-agent 自研

### 自定义消息组件 `CustomMessageComponent`
- 作用：渲染 extension 注入的自定义消息卡片（icon + customType 标签 + markdown body）
- 关键词：`CustomMessageComponent`
- 路径：packages/coding-agent/src/modes/components/custom-message.ts:12
- 归属：coding-agent 自研

### Advisor 消息卡片 `createAdvisorMessageCard`
- 作用：渲染 advisor 注入的只读笔记卡片（引言边框 + severity 徽章 + 多 advisor 归属）
- 关键词：`createAdvisorMessageCard`
- 路径：packages/coding-agent/src/modes/components/advisor-message.ts:48
- 归属：coding-agent 自研

### Skill 消息组件 `SkillMessageComponent`
- 作用：渲染 skill 调用提示卡片（icon + 名称 + args + 路径链接 + 展开后 markdown prompt）
- 关键词：`SkillMessageComponent`
- 路径：packages/coding-agent/src/modes/components/skill-message.ts:9
- 归属：coding-agent 自研

### Hook 消息/编辑器/输入 `HookMessageComponent` / `HookEditorComponent` / `HookInputComponent`
- 作用：hook 注入消息卡片 / hook 多行编辑器（Ctrl+G 外部编辑器）/ hook 单行输入（倒计时超时）
- 关键词：`HookMessageComponent` / `HookEditorComponent` / `HookInputComponent` / `HookEditorOptions` / `HookInputOptions`
- 路径：packages/coding-agent/src/modes/components/hook-message.ts:15 / hook-editor.ts:25 / hook-input.ts:16 / hook-editor.ts:20 / hook-input.ts:10
- 归属：coding-agent 自研

### 后台 Tan 派发块 `createBackgroundTanDispatchBlock`
- 作用：渲染 `/tan` 后台派发的单行面包屑（图标 + jobId + work 预览）
- 关键词：`createBackgroundTanDispatchBlock`
- 路径：packages/coding-agent/src/modes/components/background-tan-message.ts:21
- 归属：coding-agent 自研

### 协作提示消息 `CollabPromptMessageComponent`
- 作用：渲染 collab guest 的 prompt 气泡（作者名前缀 + 用户消息样式 bubble）
- 关键词：`CollabPromptMessageComponent`
- 路径：packages/coding-agent/src/modes/components/collab-prompt-message.ts:11
- 归属：coding-agent 自研

### 压缩摘要 `CompactionSummaryMessageComponent` / `HandoffSummaryMessageComponent` / `BranchSummaryMessageComponent`
- 作用：compaction/handoff/branch 历史折叠点的细分隔条，展开显示摘要 markdown
- 关键词：`CompactionSummaryMessageComponent` / `HandoffSummaryMessageComponent` / `createHandoffSummaryMessageComponent` / `BranchSummaryMessageComponent`
- 路径：packages/coding-agent/src/modes/components/compaction-summary-message.ts:85 / :121 / :149 / :164
- 归属：coding-agent 自研

### 延迟诊断消息 `LateDiagnosticsMessageComponent`
- 作用：渲染 edit/write 返回后到达的 LSP 延迟诊断（树形，复用工具诊断渲染器）
- 关键词：`LateDiagnosticsMessageComponent`
- 路径：packages/coding-agent/src/modes/components/late-diagnostics-message.ts:18
- 归属：coding-agent 自研

### 段轨道渲染 `renderSegmentTrack` / `resolveSegmentPalette`
- 作用：渲染水平彩色段轨道（powerline chip 风格），用于 model-tier 滑块
- 关键词：`renderSegmentTrack` / `resolveSegmentPalette` / `TrackSegment`
- 路径：packages/coding-agent/src/modes/components/segment-track.ts:63 / :45 / :13
- 归属：coding-agent 自研

### BTW 面板 `BtwPanelComponent`
- 作用：`/btw` 侧问面板——边框内渲染问题 + 流式回答 + 状态脚注
- 关键词：`BtwPanelComponent`
- 路径：packages/coding-agent/src/modes/components/btw-panel.ts:13
- 归属：coding-agent 自研

### 错误横幅 `ErrorBannerComponent`
- 作用：固定在编辑器上方的持久错误横幅（3 行截断），下一轮发送时清除
- 关键词：`ErrorBannerComponent`
- 路径：packages/coding-agent/src/modes/components/error-banner.ts:16
- 归属：coding-agent 自研

### Diff 渲染 `renderDiff`
- 作用：渲染 diff 字符串——上下文行 dim、删除行红、新增行绿、行内词级 diff 反色高亮
- 关键词：`renderDiff` / `RenderDiffOptions`
- 路径：packages/coding-agent/src/modes/components/diff.ts:108 / :97
- 归属：coding-agent 自研

### 带边框加载器 `BorderedLoader`
- 作用：Loader 外包边框 + "esc cancel" 提示，用于 hook UI 等待状态
- 关键词：`BorderedLoader`
- 路径：packages/coding-agent/src/modes/components/bordered-loader.ts:6
- 归属：coding-agent 自研

### 缓存失效标记 `detectCacheInvalidation` / `CacheInvalidationMarkerComponent`
- 作用：检测并渲染 prompt cache 失效的细左对齐分隔条
- 关键词：`detectCacheInvalidation` / `CacheInvalidationMarkerComponent` / `CacheInvalidation`
- 路径：packages/coding-agent/src/modes/components/cache-invalidation-marker.ts:49 / :78 / :15
- 归属：coding-agent 自研

### 欢迎屏 `WelcomeComponent` / `gradientLogo` / `renderWelcomeTip`
- 作用：双栏欢迎屏——块字符 Logo + 渐变/动画 intro + 模型名 + Tips/LSP/最近会话列表
- 关键词：`WelcomeComponent` / `gradientLogo` / `gradientEscape` / `renderWelcomeTip` / `PI_LOGO` / `ShineConfig`
- 路径：packages/coding-agent/src/modes/components/welcome.ts:142 / :527 / :484 / :86 / :454 / :471
- 归属：coding-agent 自研

### 页脚 `FooterComponent`
- 作用：底部状态栏——pwd + git 分支 + token 统计 + 费用 + 上下文用量 + 模型名 + thinking level
- 关键词：`FooterComponent`
- 路径：packages/coding-agent/src/modes/components/footer.ts:18
- 归属：coding-agent 自研

### Agent 控制中心 `AgentDashboard`
- 作用：Task subagent 配置全屏面板——源标签 + 双栏（agent 列表 + inspector），支持启用/禁用、模型覆盖编辑
- 关键词：`AgentDashboard`
- 路径：packages/coding-agent/src/modes/components/agent-dashboard.ts:347
- 归属：coding-agent 自研

### Agent Hub 覆盖层 `AgentHubOverlayComponent`
- 作用：agent hub 表格视图——列出所有注册 agent，j/k 选择，Enter 聚焦，r 唤醒，x 终止
- 关键词：`AgentHubOverlayComponent` / `AgentHubRemote` / `AgentHubDeps`
- 路径：packages/coding-agent/src/modes/components/agent-hub.ts:184 / :142 / :150
- 归属：coding-agent 自研

### Agent 对话查看器 `AgentTranscriptViewer`
- 作用：全屏 transcript 查看器（alternate screen），增量 tail 本地/远程 session 文件
- 关键词：`AgentTranscriptViewer` / `AgentTranscriptViewerDeps`
- 路径：packages/coding-agent/src/modes/components/agent-transcript-viewer.ts:138 / :35
- 归属：coding-agent 自研

### 视觉截断 `truncateToVisualLines`
- 作用：将文本截断为最大视觉行数（考虑换行），从末尾取，用于 bash/tool 折叠预览
- 关键词：`truncateToVisualLines` / `VisualTruncateResult`
- 路径：packages/coding-agent/src/modes/components/visual-truncate.ts:37 / :7
- 归属：coding-agent 自研

### Todo 提醒 `TodoReminderComponent`
- 作用：agent 停止且有未完成 todo 时提交到 transcript 的提醒通知
- 关键词：`TodoReminderComponent`
- 路径：packages/coding-agent/src/modes/components/todo-reminder.ts:11
- 归属：coding-agent 自研

### TTSR 通知 `TtsrNotificationComponent`
- 作用：Time Traveling Stream Rules 规则违规通知（黄底反色框 + 规则名/描述 + 倒回图标）
- 关键词：`TtsrNotificationComponent`
- 路径：packages/coding-agent/src/modes/components/ttsr-notification.ts:15
- 归属：coding-agent 自研

### 用量行 `createUsageRowBlock`
- 作用：每轮 assistant 消息下方的 token 用量行（输入/输出/缓存/TTFT/吞吐量）
- 关键词：`createUsageRowBlock`
- 路径：packages/coding-agent/src/modes/components/usage-row.ts:9
- 归属：coding-agent 自研

### 倒计时计时器 `CountdownTimer`
- 作用：可复用的对话框倒计时计时器，每秒 tick + 到期回调
- 关键词：`CountdownTimer`
- 路径：packages/coding-agent/src/modes/components/countdown-timer.ts:6
- 归属：coding-agent 自研

### Tiny 模型下载进度 `TinyTitleDownloadProgressComponent`
- 作用：Tiny 本地模型下载进度条（边框 + 状态 + 进度条 + 百分比 + 字节数）
- 关键词：`TinyTitleDownloadProgressComponent`
- 路径：packages/coding-agent/src/modes/components/tiny-title-download-progress.ts:54
- 归属：coding-agent 自研

### Snapcompact 形状预览 `SnapcompactShapePreview`
- 作用：`snapcompact.shape` 设置的实时预览——用真实光栅器渲染示例 session 为缩放迷你页
- 关键词：`SnapcompactShapePreview` / `SnapcompactShapePreviewOptions`
- 路径：packages/coding-agent/src/modes/components/snapcompact-shape-preview.ts:60 / :51
- 归属：coding-agent 自研

### OMFG 面板 `OmfgPanelComponent`
- 作用：`/omfg` TTSR 规则生成面板——边框内渲染 complaint + 流式候选规则 + 状态
- 关键词：`OmfgPanelComponent` / `OmfgPanelState`
- 路径：packages/coding-agent/src/modes/components/omfg-panel.ts:21 / :6
- 归属：coding-agent 自研

---

## 6. coding-agent 的选择器/弹窗

### 主题选择器 `ThemeSelectorComponent`
- 作用：主题选择列表（SelectList），带边框、预选当前主题、选择时实时预览
- 关键词：`ThemeSelectorComponent`
- 路径：packages/coding-agent/src/modes/components/theme-selector.ts:10
- 归属：coding-agent 自研

### 模型选择器 `ModelSelectorComponent`
- 作用：模型选择器——provider 标签页 + 搜索 + 模型列表 + 角色徽章 + 上下文菜单（角色 + thinking level 两步）
- 关键词：`ModelSelectorComponent`
- 路径：packages/coding-agent/src/modes/components/model-selector.ts:133
- 归属：coding-agent 自研

### 会话选择器 `SessionSelectorComponent`
- 作用：会话恢复选择器——多行项 + 模糊搜索 + prompt 历史匹配 + 文件夹/全局切换 + 删除确认
- 关键词：`SessionSelectorComponent` / `rankSessionSearchMatches` / `mergeSessionRanking` / `SessionSelectorOptions`
- 路径：packages/coding-agent/src/modes/components/session-selector.ts:501 / :81 / :133 / :477
- 归属：coding-agent 自研

### 设置选择器 `SettingsSelectorComponent`
- 作用：主设置面板——标签页 + 分组列表 + 全局搜索 + 子菜单 + 主题/status-line 预览 + snapcompact 预览
- 关键词：`SettingsSelectorComponent` / `SettingsCallbacks` / `SettingsRuntimeContext` / `StatusLinePreviewSettings`
- 路径：packages/coding-agent/src/modes/components/settings-selector.ts:412 / :393 / :363 / :383
- 归属：coding-agent 自研

### 设置定义 `SettingDef` / `getAllSettingDefs` / `getSettingsForTab` / `getSettingDef`
- 作用：settings-schema 的 UI 适配器，产出类型化 widget 定义（boolean/enum/submenu/text/providerLimits）
- 关键词：`SettingDef` / `BooleanSettingDef` / `EnumSettingDef` / `SubmenuSettingDef` / `TextInputSettingDef` / `ProviderLimitsSettingDef` / `getAllSettingDefs` / `getSettingsForTab` / `getSettingDef` / `getDisplayDefault`
- 路径：packages/coding-agent/src/modes/components/settings-defs.ts:75 / :49 / :53 / :60 / :67 / :71 / :197 / :216 / :228 / :233
- 归属：coding-agent 自研

### Advisor 配置 `AdvisorConfigOverlayComponent`
- 作用：全屏 `/advisor configure` 覆盖层——双栏编辑 WATCHDOG.yml advisor 名册
- 关键词：`AdvisorConfigOverlayComponent` / `AdvisorConfigCallbacks` / `AdvisorConfigDeps`
- 路径：packages/coding-agent/src/modes/components/advisor-config.ts:114 / :56 / :68
- 归属：coding-agent 自研

### 计划审查覆盖层 `PlanReviewOverlay`
- 作用：全屏 plan-review——markdown 分节渲染 + 滚动 + Contents 侧栏（跳转/删除/批注）+ 审批选项
- 关键词：`PlanReviewOverlay` / `PlanReviewOverlayCallbacks` / `PlanReviewOverlayOptions`
- 路径：packages/coding-agent/src/modes/components/plan-review-overlay.ts:114 / :80 / :95
- 归属：coding-agent 自研

### 计划目录解析 `parsePlanSections` / `stripInlineMarkdown` / `joinPlanSections` / `sectionDeletionSpan`
- 作用：plan markdown 的纯 heading/section 解析器
- 关键词：`parsePlanSections` / `stripInlineMarkdown` / `joinPlanSections` / `sectionDeletionSpan` / `PlanSection`
- 路径：packages/coding-agent/src/modes/components/plan-toc.ts:51 / :30 / :117 / :129 / :16
- 归属：coding-agent 自研

### 插件选择器 `PluginSelectorComponent`
- 作用：市场插件选择列表，显示可用插件 + 已安装标记 + scope 标签
- 关键词：`PluginSelectorComponent` / `PluginItem` / `PluginSelectorCallbacks`
- 路径：packages/coding-agent/src/modes/components/plugin-selector.ts:24 / :17 / :12
- 归属：coding-agent 自研

### 插件设置 `PluginSettingsComponent` / `PluginListComponent` / `PluginDetailComponent` / `MarketplacePluginDetailComponent`
- 作用：插件设置 UI——npm + marketplace 插件分层列表 + 详情（启用/禁用、feature toggle、config 值编辑）
- 关键词：`PluginSettingsComponent` / `PluginListComponent` / `PluginDetailComponent` / `MarketplacePluginDetailComponent` / `handleInputOrEscape`
- 路径：packages/coding-agent/src/modes/components/plugin-settings.ts:600 / :104 / :223 / :398 / :46
- 归属：coding-agent 自研

### 队列模式选择器 `QueueModeSelectorComponent`
- 作用：队列模式选择（one-at-a-time / all），带边框 SelectList
- 关键词：`QueueModeSelectorComponent`
- 路径：packages/coding-agent/src/modes/components/queue-mode-selector.ts:9
- 归属：coding-agent 自研

### Thinking 选择器 `ThinkingSelectorComponent`
- 作用：thinking level 选择列表（带边框），显示可用 effort 级别
- 关键词：`ThinkingSelectorComponent`
- 路径：packages/coding-agent/src/modes/components/thinking-selector.ts:11
- 归属：coding-agent 自研

### 树选择器 `TreeSelectorComponent`
- 作用：session 树形选择器——ASCII 树可视化 + 搜索过滤 + 节点选择，用于 `/tree`
- 关键词：`TreeSelectorComponent`
- 路径：packages/coding-agent/src/modes/components/tree-selector.ts:910
- 归属：coding-agent 自研

### OAuth 选择器 `OAuthSelectorComponent`
- 作用：OAuth provider 选择器——provider 列表 + 搜索 + 凭证来源标签，用于 `/login`
- 关键词：`OAuthSelectorComponent`
- 路径：packages/coding-agent/src/modes/components/oauth-selector.ts:53
- 归属：coding-agent 自研

### 复制选择器 `CopySelectorComponent`
- 作用：全屏 `/copy` 选择器——copy target 树（最近 assistant 消息 + 代码块嵌套）+ 高亮预览
- 关键词：`CopySelectorComponent` / `CopySelectorCallbacks`
- 路径：packages/coding-agent/src/modes/components/copy-selector.ts:53 / :20
- 归属：coding-agent 自研

### Hook 选择器 `HookSelectorComponent`
- 作用：通用 hook 选项选择器——列表 + 模糊搜索 + 倒计时超时 + 可选 slider + radio/checkbox
- 关键词：`HookSelectorComponent` / `HookSelectorSlider` / `HookSelectorSliderSegment` / `HookSelectorOptions` / `HookSelectorOption`
- 路径：packages/coding-agent/src/modes/components/hook-selector.ts:161 / :50 / :38 / :60 / :88
- 归属：coding-agent 自研

### 用量重置选择器 `ResetUsageSelectorComponent`
- 作用：`/usage reset` 账户选择器——列出账户 + 可用重置次数，Enter 二次确认
- 关键词：`ResetUsageSelectorComponent`
- 路径：packages/coding-agent/src/modes/components/reset-usage-selector.ts:14
- 归属：coding-agent 自研

### 显示图片选择器 `ShowImagesSelectorComponent`
- 作用：是否在终端内联显示图片的选择器（Yes/No）
- 关键词：`ShowImagesSelectorComponent`
- 路径：packages/coding-agent/src/modes/components/show-images-selector.ts:9
- 归属：coding-agent 自研

### 用户消息选择器 `UserMessageSelectorComponent`
- 作用：用户消息列表选择器——搜索 + 选择历史用户消息条目
- 关键词：`UserMessageSelectorComponent`
- 路径：packages/coding-agent/src/modes/components/user-message-selector.ts:193
- 归属：coding-agent 自研

### 登出账户选择器 `LogoutAccountSelectorComponent`
- 作用：`/logout` 账户选择器——列出 provider 账户 + 活跃标记
- 关键词：`LogoutAccountSelectorComponent`
- 路径：packages/coding-agent/src/modes/components/logout-account-selector.ts:10
- 归属：coding-agent 自研

### 登录对话框 `LoginDialogComponent`
- 作用：OAuth 登录流程中替换编辑器的对话框——标题 + 动态内容区 + 输入框
- 关键词：`LoginDialogComponent`
- 路径：packages/coding-agent/src/modes/components/login-dialog.ts:10
- 归属：coding-agent 自研

### MCP 添加向导 `MCPAddWizard`
- 作用：交互式多步 MCP server 添加向导（name/transport/command/url/auth-method/oauth/apikey/scope/confirm）
- 关键词：`MCPAddWizard` / `MCPAddWizardOAuthResult`
- 路径：packages/coding-agent/src/modes/components/mcp-add-wizard.ts:105 / :57
- 归属：coding-agent 自研

### 历史搜索 `HistorySearchComponent`
- 作用：prompt 历史搜索覆盖层——输入查询 + 模糊匹配 + 高亮 token + 上下翻页选择
- 关键词：`HistorySearchComponent`
- 路径：packages/coding-agent/src/modes/components/history-search.ts:151
- 归属：coding-agent 自研

---

## 7. 渲染工具函数

### 渲染工具核心 `render-utils.ts`
- 作用：共享工具渲染格式化、截断、状态图标、diff 统计、代码帧、诊断、缓存组件
- 关键词：`formatExpandHint` / `formatMoreItems` / `formatBadge` / `formatStatusIcon` / `formatTitle` / `formatErrorMessage` / `formatErrorDetail` / `formatEmptyMessage` / `formatMeta` / `formatCodeFrameLine` / `formatDiagnostics` / `getDiffStats` / `formatDiffStats` / `truncateDiffByHunk` / `shortenPath` / `formatToolWorkingDirectory` / `formatScreenshot` / `wrapBrackets` / `capPreviewLines` / `previewWindowRows` / `capPreviewLines` / `getPreviewLines` / `previewLine` / `getDomain` / `expandKeyHint` / `createCachedComponent` / `cachedRenderedString` / `createRenderedStringCache` / `invalidateRenderedStringCache` / `appendParseErrorsBulletList` / `formatParseErrorsCountLabel` / `capParseErrors` / `formatParseErrors` / `dedupeParseErrors` / `getLspBatchRequest` / `PREVIEW_LIMITS` / `TRUNCATE_LENGTHS` / `PARSE_ERRORS_LIMIT` / `resolveImageOptions` / `ToolUIStatus` / `ToolUIColor` / `CodeFrameMarker` / `DiffStats` / `RenderedStringCache` / `LspBatchRequest`
- 路径：packages/coding-agent/src/tools/render-utils.ts:174 / :193 / :183 / :145 / :301 / :253 / :264 / :268 / :244 / :278 / :351 / :491 / :517 / :555 / :672 / :683 / :697 / :726 / :229 / :212 / :229 / :99 / :111 / :122 / :87 / :776 / :829 / :820 / :825 / :862 / :883 / :759 / :744 / :732 / :901 / :48 / :66 / :730 / :29 / :294 / :295 / :276 / :484 / :812 / :896
- 归属：coding-agent 自研
- 重点 API：
```ts
function formatExpandHint(theme: Theme, expanded?: boolean, hasMore?: boolean): string
function formatMoreItems(remaining: number, itemType: string): string
function formatStatusIcon(status: ToolUIStatus, theme: Theme, spinnerFrame?: number): string
function getDiffStats(diffText: string): DiffStats
function truncateDiffByHunk(diffText, maxHunks, maxLines, options?): { text; hiddenHunks; hiddenLines }
function createCachedComponent(getExpanded, compute, options?): Component
```

### JSON 树渲染 `json-tree.ts`
- 作用：JSON 树形渲染——递归渲染对象/数组/标量，按深度行数截断
- 关键词：`renderJsonTreeLines` / `formatArgsInline` / `formatScalar` / `JSON_TREE_MAX_DEPTH_COLLAPSED` / `JSON_TREE_MAX_DEPTH_EXPANDED` / `JSON_TREE_MAX_LINES_COLLAPSED` / `JSON_TREE_MAX_LINES_EXPANDED` / `JSON_TREE_SCALAR_LEN_COLLAPSED` / `JSON_TREE_SCALAR_LEN_EXPANDED`
- 路径：packages/coding-agent/src/tools/json-tree.ts:104 / :53 / :32 / :9-14
- 归属：coding-agent 自研
- API：
```ts
function renderJsonTreeLines(value, theme, maxDepth, maxLines, maxScalarLen): { lines: string[]; truncated: boolean }
function formatArgsInline(args: Record<string, unknown>, maxWidth: string): string
```

### 工具渲染器注册表 `renderers.ts`
- 作用：按工具名映射到对应渲染器的全局注册表
- 关键词：`toolRenderers` / `ToolRenderer`
- 路径：packages/coding-agent/src/tools/renderers.ts:79 / :35
- 归属：coding-agent 自研

### Eval 渲染器 `eval-render.ts`
- 作用：eval 工具的 TUI 渲染器——代码单元格尾窗口 + 输出 + JSON 树 + 状态事件树 + agent 进度树
- 关键词：`evalToolRenderer` / `upsertStatusEvent` / `EVAL_DEFAULT_PREVIEW_LINES`
- 路径：packages/coding-agent/src/tools/eval-render.ts:491 / :110 / :43
- 归属：coding-agent 自研

### GitHub 渲染器 `gh-renderer.ts`
- 作用：GitHub 工具的 TUI 渲染器（run_watch 运行监控 + 搜索/repo 回退渲染）
- 关键词：`githubToolRenderer` / `formatShortSha`（gh-format.ts:6）
- 路径：packages/coding-agent/src/tools/gh-renderer.ts:418
- 归属：coding-agent 自研

### 记忆渲染器 `memory-render.ts`
- 作用：长期记忆工具（retain/recall/reflect）的内联 TUI 渲染器
- 关键词：`retainToolRenderer` / `recallToolRenderer` / `reflectToolRenderer`
- 路径：packages/coding-agent/src/tools/memory-render.ts:78 / :111 / :158
- 归属：coding-agent 自研

### 匹配行格式化 `match-line-format.ts`
- 作用：grep/ast-grep 风格匹配结果的单行格式化
- 关键词：`formatMatchLine`
- 路径：packages/coding-agent/src/tools/match-line-format.ts:9
- 归属：coding-agent 自研

### Inspect Image 渲染器 `inspect-image-renderer.ts`
- 作用：inspect_image 工具的 TUI 渲染器
- 关键词：`inspectImageToolRenderer`
- 路径：packages/coding-agent/src/tools/inspect-image-renderer.ts:34
- 归属：coding-agent 自研

### JTD 转 JSON Schema `jtd-to-json-schema.ts`
- 作用：JTD（RFC 8927）到 JSON Schema 的转换器
- 关键词：`isJTDSchema` / `jtdToJsonSchema` / `normalizeSchema`
- 路径：packages/coding-agent/src/tools/jtd-to-json-schema.ts:143 / :201 / :209
- 归属：coding-agent 自研

### 代码单元格 `renderCodeCell` / `renderMarkdownCell`
- 作用：渲染代码/markdown 单元格——header（索引/标题/状态/spinner/时长/语言图标）+ 代码 + 可选输出块
- 关键词：`renderCodeCell` / `renderMarkdownCell` / `CodeCellOptions` / `MarkdownCellOptions`
- 路径：packages/coding-agent/src/tui/code-cell.ts:114 / :218 / :16 / :203
- 归属：coding-agent 自研

### 文件列表 `renderFileList`
- 作用：渲染文件列表——图标 + 路径 + 元数据，支持目录/文件区分、OSC8 超链接
- 关键词：`renderFileList` / `FileEntry` / `FileListOptions`
- 路径：packages/coding-agent/src/tui/file-list.ts:27 / :8 / :17
- 归属：coding-agent 自研

### 超链接 `uriHyperlink` / `urlHyperlink` / `fileHyperlink` / `isHyperlinkEnabled`
- 作用：OSC 8 终端超链接支持——为路径/URL 包装 display 文本，遵循 `tui.hyperlinks` 设置
- 关键词：`isHyperlinkEnabled` / `uriHyperlink` / `urlHyperlink` / `urlHyperlinkAlways` / `fileHyperlink` / `tryResolveInternalUrlSync`
- 路径：packages/coding-agent/src/tui/hyperlink.ts:50 / :86 / :94 / :112 / :137 / :155
- 归属：coding-agent 自研

### 输出块 `renderOutputBlock` / `framedBlock` / `CachedOutputBlock`
- 作用：带边框的输出容器——可选 header + 多 section + 状态色边框/背景，sixel 透传
- 关键词：`renderOutputBlock` / `framedBlock` / `CachedOutputBlock` / `markFramedBlockComponent` / `isFramedBlockComponent` / `outputBlockContentWidth` / `FramedBlockComponent`
- 路径：packages/coding-agent/src/tui/output-block.ts:60 / :242 / :197 / :29 / :34 / :56 / :29
- 归属：coding-agent 自研

### 工具状态行 `renderStatusLine`
- 作用：工具输出的标准化状态头渲染（图标 + 标题 + 描述 + 徽章 + meta）
- 关键词：`renderStatusLine` / `StatusLineOptions`
- 路径：packages/coding-agent/src/tui/status-line.ts:32 / :8
- 归属：coding-agent 自研

### 树列表 `renderTreeList`
- 作用：层级树列表渲染 helper——展开/折叠、maxCollapsed/maxCollapsedLines 预算、树连接符前缀
- 关键词：`renderTreeList` / `TreeListOptions`
- 路径：packages/coding-agent/src/tui/tree-list.ts:26 / :11
- 归属：coding-agent 自研

### TUI 工具集 `Hasher` / `getStateBgColor` / `padToWidth` / `buildTreePrefix` / `getTreeBranch`
- 作用：工具 UI 共享 helper——增量 xxHash64 哈希器、状态背景色、padding、截断、树连接符
- 关键词：`Hasher` / `getStateBgColor` / `padToWidth` / `buildTreePrefix` / `getTreeBranch` / `getTreeContinuePrefix` / `RenderCache`
- 路径：packages/coding-agent/src/tui/utils.ts:25 / :99 / :92 / :80 / :84 / :88 / :80
- 归属：coding-agent 自研
- API：`class Hasher { str(s); u32(n); u64(n); bool(b); optional(v); digest(): bigint }`

### 宽度感知文本 `WidthAwareText`
- 作用：内容按实际渲染宽度重新格式化的 Text 包装——延迟 format 到 render(width)
- 关键词：`WidthAwareText`
- 路径：packages/coding-agent/src/tui/width-aware-text.ts:17
- 归属：coding-agent 自研

### 渐变高亮器 `createGradientHighlighter` / `KeywordHighlighter`
- 作用：声明式构造按 HSL 渐变为关键词着色的高亮器，零宽 SGR 转义、调色板按颜色模式懒编译缓存
- 关键词：`createGradientHighlighter` / `KeywordHighlighter` / `GradientHighlightSpec`
- 路径：packages/coding-agent/src/modes/gradient-highlight.ts:39 / :12 / :17
- 归属：coding-agent 自研

### 魔法关键词 `highlightMagicKeywords` / `hasMagicKeyword`
- 作用：聚合 ultrathink/orchestrate/workflowz 三个魔法关键词的高亮与检测
- 关键词：`highlightMagicKeywords` / `hasMagicKeyword` / `containsUltrathink` / `highlightUltrathink` / `containsOrchestrate` / `highlightOrchestrate` / `containsWorkflow` / `highlightWorkflow`
- 路径：packages/coding-agent/src/modes/magic-keywords.ts:23 / :37 / ultrathink.ts:27 / orchestrate.ts:28 / workflow.ts:28
- 归属：coding-agent 自研

### Markdown 散文掩码 `maskNonProse` / `keywordInProse`
- 作用：将 Markdown 中代码块/行内代码/HTML-XML 标签区域掩码为空格，使关键词匹配只命中散文
- 关键词：`maskNonProse` / `keywordInProse`
- 路径：packages/coding-agent/src/modes/markdown-prose.ts:162 / :244
- 归属：coding-agent 自研

### 图片引用 `shiftImageMarkers` / `renderPlaceholders` / `materializeImageReferenceLinks`
- 作用：匹配/重编号 `[Image #N]` `[Paste #N]` 占位符，渲染引用，物化为 blob 链接
- 关键词：`shiftImageMarkers` / `renderPlaceholders` / `imageReferenceHyperlink` / `materializeImageReferenceLinks` / `materializeImageReferenceLinksSync` / `PLACEHOLDER_REGEX`
- 路径：packages/coding-agent/src/modes/image-references.ts
- 归属：coding-agent 自研

### 上下文用量 `computeContextBreakdown` / `renderContextUsage`
- 作用：计算并渲染会话上下文 token 占用明细（消息/工具/skills/系统提示）
- 关键词：`computeContextBreakdown` / `renderContextUsage` / `ContextBreakdown` / `computeNonMessageTokens` / `estimateSkillsTokens` / `estimateToolSchemaTokens`
- 路径：packages/coding-agent/src/modes/utils/context-usage.ts:119 / :399 / :33 / :89 / :57 / :57
- 归属：coding-agent 自研

### 复制目标 `buildCopyTargets` / `extractCodeBlocks` / `extractLastCodeBlock`
- 作用：从消息中提取代码块、引用块、最后命令，构建复制选择器目标列表
- 关键词：`buildCopyTargets` / `extractCodeBlocks` / `extractLastCodeBlock` / `extractQuoteBlocks` / `extractLastCommand` / `extractBlocks` / `CopyTarget` / `CopySource` / `CodeBlock` / `QuoteBlock`
- 路径：packages/coding-agent/src/modes/utils/copy-targets.ts:325 / :115 / :122 / :134 / :180 / :71 / :34 / :53 / :5 / :13
- 归属：coding-agent 自研

### 转录渲染助手 `buildAsyncResultBlock` / `buildIrcMessageCard` / `assistantHasVisibleContent`
- 作用：构建异步结果块、IRC 消息卡；判断助手是否有可见内容；规范化工具参数
- 关键词：`buildAsyncResultBlock` / `buildIrcMessageCard` / `buildFileMentionBlock` / `assistantHasVisibleContent` / `normalizeToolArgs` / `resolveAssistantErrorMessage`
- 路径：packages/coding-agent/src/modes/utils/transcript-render-helpers.ts:24 / :68 / :98 / :125 / :137 / :145
- 归属：coding-agent 自研

### UI 助手集合 `UiHelpers`
- 作用：封装一系列 UI 便捷操作（剪贴板、展开切换、编辑器等）
- 关键词：`UiHelpers`
- 路径：packages/coding-agent/src/modes/utils/ui-helpers.ts:83
- 归属：coding-agent 自研

### Markdown 表格工具 `buildHotkeysMarkdown` / `buildToolsMarkdown`
- 作用：将键绑定/工具列表渲染为 Markdown 表格
- 关键词：`buildHotkeysMarkdown` / `HotkeysMarkdownBindings` / `buildToolsMarkdown` / `ToolsMarkdownBindings`
- 路径：packages/coding-agent/src/modes/utils/hotkeys-markdown.ts:11 / :3 / tools-markdown.ts:14 / :3
- 归属：coding-agent 自研

---

## 8. 鼠标能力

### SGR 鼠标解析/路由（pi-tui 核心）
- 作用：解析 SGR 鼠标报告、转发给处理器、为 SelectList 类目标做滚轮/悬停/点击命中、定义 MouseRoutable 组件契约
- 关键词：`parseSgrMouse` / `routeSgrMouseInput` / `routeSelectListMouse` / `SgrMouseEvent` / `SgrMouseHandler` / `SelectListMouseTarget` / `MouseRoutable`
- 路径：packages/tui/src/mouse.ts:34 / :56 / :80 / :12 / :48 / :68 / :102
- 归属：pi-tui
- API：
```ts
function parseSgrMouse(data: string): SgrMouseEvent | null
function routeSgrMouseInput(data: string, handler: SgrMouseHandler): boolean
function routeSelectListMouse(target: SelectListMouseTarget, event: SgrMouseEvent, line: number): boolean
interface MouseRoutable { routeMouse(event: SgrMouseEvent, line: number, col: number): void }
```

### SelectList 鼠标路由（带顶边框）`routeSelectListMouseWithTopBorder`
- 作用：将 SGR 鼠标事件路由到带顶部边框的 SelectList（wheel/hover/click），偏移顶部边框行
- 关键词：`routeSelectListMouseWithTopBorder`
- 路径：packages/coding-agent/src/modes/components/select-list-mouse-routing.ts:11
- 归属：coding-agent 自研

### 各选择器的鼠标路由
- 作用：各选择器组件实现 `routeMouse(event, line, col)` 方法，支持鼠标滚轮/悬停/点击
- 关键词：`routeMouse`（在 ThemeSelectorComponent / ModelSelectorComponent / PluginSelectorComponent / QueueModeSelectorComponent / ThinkingSelectorComponent / ShowImagesSelectorComponent / ResetUsageSelectorComponent 等中实现）
- 路径：packages/coding-agent/src/modes/components/*-selector.ts
- 归属：coding-agent 自研

---

## 9. 主题/符号

### 符号主题 `SymbolTheme` / `BoxSymbols`
- 作用：定义光标、边框、表格、引用、水平线等符号字形的接口
- 关键词：`SymbolTheme` / `BoxSymbols`
- 路径：packages/tui/src/symbols.ts:15 / :1
- 归属：pi-tui
- API：`interface SymbolTheme { cursor; inputCursor; boxRound; boxSharp; table; quoteBorder; hrChar; spinnerFrames }`

### Editor 组件主题 `EditorTheme` / `EditorTopBorder`
- 路径：packages/tui/src/components/editor.ts:346 / :355
- 归属：pi-tui

### Markdown 组件主题 `MarkdownTheme` / `DefaultTextStyle`
- 路径：packages/tui/src/components/markdown.ts:507 / :488
- 归属：pi-tui

### ScrollView 主题 `ScrollViewTheme`
- 路径：packages/tui/src/components/scroll-view.ts:10
- 归属：pi-tui

### SelectList 主题 `SelectListTheme` / `SelectListTruncatePrimaryContext`
- 路径：packages/tui/src/components/select-list.ts:32 / :43
- 归属：pi-tui

### SettingsList 主题 `SettingsListTheme`
- 路径：packages/tui/src/components/settings-list.ts:35
- 归属：pi-tui

### TabBar 主题 `TabBarTheme`
- 路径：packages/tui/src/components/tab-bar.ts:28
- 归属：pi-tui

### Image 主题 `ImageTheme`
- 路径：packages/tui/src/components/image.ts:12
- 归属：pi-tui

### DECCARA 矩形 SGR 优化 `planDeccaraFills` / `encodeDeccara` / `analyzeBgFillLine`
- 作用：规划 DECCARA 矩形 SGR 背景填充，替换每行背景填充空格
- 关键词：`planDeccaraFills` / `encodeDeccara` / `analyzeBgFillLine` / `DECSACE_RECT` / `DECSACE_DEFAULT` / `DeccaraPlan` / `BgFillAnalysis`
- 路径：packages/tui/src/deccara.ts:240 / :43 / :137 / :27 / :28 / :223 / :117
- 归属：pi-tui

### Theme 主题系统 `Theme` / `theme`
- 作用：加载/管理明暗主题、符号预设(unicode/nerd/ascii)、配色、编辑器/Markdown/选择列表主题、代码高亮、自动明暗切换、文件监听
- 关键词：`Theme` / `theme` / `SymbolPreset` / `SymbolKey` / `ThemeColor` / `ThemeBg` / `isValidThemeColor` / `highlightCode` / `getSymbolTheme` / `getMarkdownTheme` / `getSelectListTheme` / `getEditorTheme` / `getSettingsListTheme` / `setMarkdownMermaidRendering` / `initTheme` / `setTheme` / `previewTheme` / `enableAutoTheme` / `onThemeChange` / `setSymbolPreset` / `getAvailableSymbolPresets` / `isValidSymbolPreset` / `setThemeInstance` / `fgOrPlain` / `getThemeEpoch` / `stopThemeWatcher` / `getAvailableThemes` / `getAvailableThemesWithPaths` / `getThemeByName` / `getResolvedThemeColors` / `isLightTheme` / `getThemeExportColors` / `setAutoThemeMapping` / `onTerminalAppearanceChange` / `setColorBlindMode` / `getColorBlindMode` / `SpinnerType` / `ThemeChangeEvent` / `ThemeInfo`
- 路径：packages/coding-agent/src/modes/theme/theme.ts:1457 / :2148 / :29 / :34 / :1114 / :1245 / :1241 / :2800 / :2808 / :2863 / :2921 / :2946 / :2965 / :2857 / :2184 / :2212 / :2249 / :2276 / :2367 / :2313 / :2396 / :2342 / :2302 / :2157 / :2383 / :2544 / :1948 / :1964 / :2093 / :2662 / :2695 / :2717 / :2285 / :2296 / :2342 / :2363 / :962 / :2160 / :1964
- 归属：coding-agent 自研
- API：
```ts
class Theme { fg(color, text); bg(color, text); bold(text); styledSymbol(key, fallback?); checkbox; spinnerFrames }
export var theme: Theme
async function initTheme(name?, appearanceOverride?): Promise<void>
async function setTheme(name: string): Promise<void>
function highlightCode(code: string, lang?: string, highlightTheme?: Theme): string[]
function getSymbolTheme(): SymbolTheme
function getMarkdownTheme(): MarkdownTheme
```

### Shimmer 微光文本动画 `shimmerText` / `shimmerSegments` / `shimmerEnabled`
- 作用：对加载/工作提示等文本施加随时间渐变的微光着色（Claude-Code 式 shimmer）
- 关键词：`shimmerText` / `shimmerSegments` / `shimmerEnabled` / `ShimmerPalette` / `DEFAULT_SHIMMER_PALETTE` / `ShimmerSegment`
- 路径：packages/coding-agent/src/modes/theme/shimmer.ts:233 / :179 / :162 / :40 / :57 / :52
- 归属：coding-agent 自研

### Mermaid ASCII 缓存 `resolveMermaidAscii` / `clearMermaidCache`
- 作用：将 Mermaid 源码解析为 ASCII 表示并按源码哈希缓存，主题切换时清除
- 关键词：`resolveMermaidAscii` / `clearMermaidCache` / `MermaidResolveOptions`
- 路径：packages/coding-agent/src/modes/theme/mermaid-cache.ts:54 / :90 / :8
- 归属：coding-agent 自研

### 内置默认主题 `defaultThemes`
- 作用：导出内置的明/暗默认主题对象集合（100+ 个 JSON 主题文件在 defaults/ 下）
- 关键词：`defaultThemes`
- 路径：packages/coding-agent/src/modes/theme/defaults/index.ts:100
- 归属：coding-agent 自研

---

## 10. 其他 TUI 能力

### 终端能力信息 `TerminalInfo` / `TERMINAL` / `TERMINAL_ID`
- 作用：终端能力信息类与全局单例，含图像协议、真彩、超链接、通知、DECCARA、文本缩放
- 关键词：`TerminalInfo` / `RuntimeTerminal` / `TERMINAL` / `TERMINAL_ID` / `ImageProtocol` / `NotifyProtocol` / `TerminalId`
- 路径：packages/tui/src/terminal-capabilities.ts:62 / :494 / :502 / :486 / :13 / :19 / :25
- 归属：pi-tui

### 终端能力检测函数集
- 作用：终端能力检测与覆盖函数集
- 关键词：`detectTerminalId` / `isInsideTmux` / `isInsideTerminalMultiplexer` / `wrapTmuxPassthrough` / `shouldEnableSynchronizedOutputByDefault` / `synchronizedOutputUserOverride` / `detectRectangularSgrSupport` / `shouldEnableHyperlinksByDefault` / `hyperlinksUserOverride` / `isWindowsTerminalPreviewSixelSupported` / `resolveWarpImageProtocol` / `getTerminalInfo` / `setTerminalImageProtocol` / `setTerminalDeccara` / `setTerminalScreenToScrollback` / `setTerminalTextSizing` / `isNotificationSuppressed` / `setOsc99Supported` / `isOsc99Supported`
- 路径：packages/tui/src/terminal-capabilities.ts:444 / :143 / :148 / :171 / :257 / :226 / :311 / :367 / :326 / :206 / :412 / :567 / :540 / :549 / :554 / :563 / :175 / :1015 / :1020
- 归属：pi-tui

### 图像编码/渲染函数
- 作用：图像编码、尺寸解析、渲染函数
- 关键词：`encodeKitty` / `encodeKittyTransmit` / `encodeKittyPlacement` / `encodeKittyDeleteImage` / `encodeITerm2` / `renderImage` / `imageFallback` / `calculateImageRows` / `getImageDimensions` / `getPngDimensions` / `getJpegDimensions` / `getGifDimensions` / `getWebpDimensions` / `getCellDimensions` / `setCellDimensions` / `TerminalNotification` / `CellDimensions` / `ImageDimensions` / `ImageRenderOptions`
- 路径：packages/tui/src/terminal-capabilities.ts:642 / :664 / :676 / :696 / :700 / :907 / :982 / :725 / :891 / :766 / :787 / :830 / :852 / :604 / :608 / :995 / :575 / :580 / :585
- 归属：pi-tui

### 桌面通知 `sendDesktopNotification` / `resolveDesktopNotifier`
- 作用：Linux D-Bus 桌面通知投递（notify-send/gdbus 回退）
- 关键词：`sendDesktopNotification` / `resolveDesktopNotifier` / `shouldDeliverDesktopNotification` / `hasLinuxDesktopSession` / `buildDesktopNotifyCommand` / `resetDesktopNotifierCache` / `DesktopNotifier` / `DesktopNotifierKind`
- 路径：packages/tui/src/desktop-notify.ts:166 / :84 / :59 / :42 / :132 / :74 / :32 / :30
- 归属：pi-tui

### TTY 标识 `getTtyPath` / `getTerminalId`
- 作用：解析 stdin TTY 设备路径 / 获取稳定终端标识符
- 关键词：`getTtyPath` / `getTerminalId`
- 路径：packages/tui/src/ttyid.ts:6 / :41
- 归属：pi-tui

### LaTeX 显示数学块 `latexToBlock`
- 作用：将显示 LaTeX 数学渲染为多行（分数竖排堆叠），非分数部分委托 latexToUnicode
- 关键词：`latexToBlock`
- 路径：packages/tui/src/latex-block.ts:450
- 归属：pi-tui

### LaTeX 转 Unicode `latexToUnicode` / `renderMathInText`
- 作用：将裸 LaTeX 数学片段转为最佳 Unicode/ANSI 渲染
- 关键词：`latexToUnicode` / `renderMathInText` / `inlineMathSpanEnd` / `isBareMathEnvironment`
- 路径：packages/tui/src/latex-to-unicode.ts:1760 / :1888 / :1973 / :1806
- 归属：pi-tui

### Kitty 图形占位符 `KITTY_PLACEHOLDER` / `detectKittyUnicodePlaceholdersSupport` / `renderKittyPlaceholderLines`
- 作用：Kitty Unicode 占位符（U+1 + U+10EEEE）渲染，运行时特性与环境覆盖
- 关键词：`KITTY_PLACEHOLDER` / `KITTY_PLACEHOLDER_MAX_CELLS` / `detectKittyUnicodePlaceholdersSupport` / `getKittyGraphics` / `setKittyGraphics` / `kittyPlaceholdersFit` / `encodeKittyVirtualPlacement` / `encodeKittyPlaceholderGrid` / `renderKittyPlaceholderLines` / `KittyGraphicsFeatures`
- 路径：packages/tui/src/kitty-graphics.ts:19 / :52 / :76 / :91 / :95 / :100 / :114 / :132 / :160 / :54
- 归属：pi-tui

### 模糊匹配 `fuzzyMatch` / `fuzzyRank` / `fuzzyFilter`
- 作用：词级局部模糊匹配，支持空格分词、首字母缩略、字母数字交换
- 关键词：`fuzzyMatch` / `fuzzyRank` / `fuzzyFilter` / `resetFuzzyIndexCache` / `FuzzyMatch` / `FuzzyFilterResult`
- 路径：packages/tui/src/fuzzy.ts:317 / :325 / :343 / :354 / :11 / :16
- 归属：pi-tui

### 自定义编辑器接口 `EditorComponent`
- 作用：自定义编辑器组件接口，允许扩展提供 vim/emacs 等实现
- 关键词：`EditorComponent`
- 路径：packages/tui/src/editor-component.ts
- 归属：pi-tui

### 交互模式核心 `InteractiveMode`
- 作用：coding-agent 主 TUI 类，装配所有控制器、UI 容器、会话/编辑器/状态行，管理 plan/goal/loop 模式、todos、子代理 HUD、欢迎页、关闭流程
- 关键词：`InteractiveMode` / `InteractiveModeContext` / `InteractiveModeOptions` / `computeEditorMaxHeight` / `renderSubagentHudLines`
- 路径：packages/coding-agent/src/modes/interactive-mode.ts:382 / packages/coding-agent/src/modes/types.ts:94 / interactive-mode.ts:305 / :254 / :348
- 归属：coding-agent 自研
- API：`class InteractiveMode implements InteractiveModeContext { init(options?); getUserInput(); shutdown() }`

### 控制器集
- 作用：处理斜杠命令分发、会话事件驱动 UI、选择器覆盖层管理、键盘提交控制、流式平滑展开、工具参数流式展开等
- 关键词：`CommandController` / `EventController` / `SelectorController` / `InputController` / `StreamingRevealController` / `ToolArgsRevealController` / `BtwController` / `OmfgController` / `TanCommandController` / `TodoCommandController` / `MCPCommandController` / `SSHCommandController` / `ExtensionUiController` / `SessionFocusController`
- 路径：packages/coding-agent/src/modes/controllers/*.ts
- 归属：coding-agent 自研
- 重点：
  - `StreamingRevealController`（streaming-reveal.ts:209）——以 ~30fps 逐字素展开流式助手文本/思考块
  - `ToolArgsRevealController`（tool-args-reveal.ts:439）——工具参数 JSON 流式到达时节流暴露字符串字段
  - `EventController`（event-controller.ts:67）——订阅 AgentSession 事件驱动 TUI 转录更新
  - `SelectorController`（selector-controller.ts:80）——统一管理各类选择器覆盖层
  - `InputController`（input-controller.ts:142）——装配编辑器键处理器与提交处理器
  - `SessionFocusController`（session-focus-controller.ts:17）——子代理视图聚焦

### 设置向导场景 `SetupScene` / `SetupSceneController` / `SetupTab`
- 作用：设置向导各场景（splash/providers/theme/glyph/web-search/sign-in/outro）的类型契约与实现
- 关键词：`SetupScene` / `SetupSceneController` / `SetupSceneHost` / `SetupTab` / `SetupSceneResult` / `glyphSetupScene` / `providersSetupScene` / `themeSetupScene` / `SignInTab` / `WebSearchTab` / `renderSetupSplash` / `renderStarfield` / `renderSetupOutro` / `runStartupSplash` / `runSetupWizard`
- 路径：packages/coding-agent/src/modes/setup-wizard/scenes/types.ts / scenes/glyph.ts:98 / scenes/providers.ts:99 / scenes/theme.ts:315 / scenes/sign-in.ts:75 / scenes/web-search.ts:31 / scenes/splash.ts:126 / :54 / scenes/outro.ts:20 / startup-splash.ts:87 / index.ts:74
- 归属：coding-agent 自研

### RPC 模式 `RpcClient` / `runRpcMode` / `RpcSubagentRegistry`
- 作用：通过 stdio JSON 帧与 coding-agent RPC 服务端通信；RPC 服务端模式主循环
- 关键词：`RpcClient` / `runRpcMode` / `dispatchRpcInputFrame` / `RpcShutdownCoordinator` / `RpcExtensionUserMessageTracker` / `RpcSubagentRegistry` / `RpcHostToolBridge` / `RpcHostUriBridge` / `defineRpcClientTool` / `RpcCommand` / `RpcResponse` / `RpcSessionState`
- 路径：packages/coding-agent/src/modes/rpc/rpc-client.ts:206 / rpc-mode.ts:515 / :261 / :324 / :140 / rpc-subagents.ts:107 / host-tools.ts:74 / host-uris.ts:67 / rpc-client.ts:89 / rpc-types.ts:27 / :170 / :93
- 归属：coding-agent 自研

### 打印模式 `runPrintMode`
- 作用：`omp -p` 单次执行模式——发送提示、输出 text 或 JSON 事件流、退出
- 关键词：`runPrintMode` / `PrintModeOptions`
- 路径：packages/coding-agent/src/modes/print-mode.ts:35 / :18
- 归属：coding-agent 自研

### 会话观察注册 `SessionObserverRegistry`
- 作用：跟踪主会话与子代理会话状态，供 HUD 与 todo 自动勾选用
- 关键词：`SessionObserverRegistry` / `ObservableSession`
- 路径：packages/coding-agent/src/modes/session-observer-registry.ts:34
- 归属：coding-agent 自研

### 会话拆除 `createSessionTeardown`
- 作用：信号安全的 promise-memoized 拆除——保存编辑器草稿、dispose 会话
- 关键词：`createSessionTeardown` / `SessionTeardown`
- 路径：packages/coding-agent/src/modes/session-teardown.ts:66
- 归属：coding-agent 自研

### 循环限制 `parseLoopLimitArgs` / `createLoopLimitRuntime`
- 作用：解析 `/loop [count|duration]` 参数，创建迭代/时长运行时
- 关键词：`parseLoopLimitArgs` / `createLoopLimitRuntime` / `consumeLoopLimitIteration` / `isLoopDurationExpired` / `describeLoopLimit` / `LoopLimitConfig` / `LoopLimitRuntime`
- 路径：packages/coding-agent/src/modes/loop-limit.ts:57
- 归属：coding-agent 自研

### 轮次预算 `parseTurnBudget`
- 作用：解析用户消息中的 `+Nk`/`+Nm`/`+N!` 单轮输出 token 预算指令
- 关键词：`parseTurnBudget` / `TurnBudget`
- 路径：packages/coding-agent/src/modes/turn-budget.ts:23
- 归属：coding-agent 自研

### 子代理徽标 `getRunningSubagentBadgeRegistry` / `countRunningSubagentBadgeAgents`
- 作用：从 AgentRegistry 获取运行中子代理计数，驱动状态行徽标
- 关键词：`getRunningSubagentBadgeRegistry` / `countRunningSubagentBadgeAgents`
- 路径：packages/coding-agent/src/modes/running-subagent-badge.ts:7
- 归属：coding-agent 自研

### OAuth 手动输入 `OAuthManualInputManager`
- 作用：串行化 OAuth 手动输入，同一时刻仅一个 pending
- 关键词：`OAuthManualInputManager`
- 路径：packages/coding-agent/src/modes/oauth-manual-input.ts:11
- 归属：coding-agent 自研

### 技能命令 `isKnownSkillCommand` / `buildSkillCommandPrompt` / `invokeSkillCommandFromText`
- 作用：`/skill:<name>` 命令识别、构建用户自定义消息载荷、调用会话 promptCustomMessage 派发
- 关键词：`isKnownSkillCommand` / `buildSkillCommandPrompt` / `invokeSkillCommandFromText` / `BuiltSkillCommandPrompt`
- 路径：packages/coding-agent/src/modes/skill-command.ts:37
- 归属：coding-agent 自研

### 扩展运行时装配 `initializeExtensions`
- 作用：为 print/RPC 非交互模式装配扩展运行器的标准动作集
- 关键词：`initializeExtensions` / `InitializeExtensionsOptions` / `ExtensionSendAction`
- 路径：packages/coding-agent/src/modes/runtime-init.ts:39
- 归属：coding-agent 自研

---

## 附录：status-line 子目录完整清单

### 状态行组件 `StatusLineComponent`
- 作用：状态行主渲染——根据设置组装左右段、分隔符、powerline caps
- 关键词：`StatusLineComponent`
- 路径：packages/coding-agent/src/modes/components/status-line/component.ts:245
- 归属：coding-agent 自研

### 状态行段渲染 `renderSegment` / `SEGMENTS` / `ALL_SEGMENT_IDS`
- 作用：各 status-line 段的渲染逻辑（model/path/git/pr/context_pct/cost/session_name/token_rate/...）
- 关键词：`renderSegment` / `SEGMENTS` / `ALL_SEGMENT_IDS`
- 路径：packages/coding-agent/src/modes/components/status-line/segments.ts:655 / :628 / :663
- 归属：coding-agent 自研

### 状态行预设 `STATUS_LINE_PRESETS` / `getPreset`
- 作用：状态行预设定义（default/minimal/compact/full/nerd/ascii/custom）
- 关键词：`STATUS_LINE_PRESETS` / `getPreset` / `PresetDef`
- 路径：packages/coding-agent/src/modes/components/status-line/presets.ts:3 / :104
- 归属：coding-agent 自研

### 状态行分隔符 `getSeparator`
- 作用：根据样式返回分隔符定义（powerline/powerline-thin/slash/pipe/block/none/ascii）
- 关键词：`getSeparator` / `SeparatorDef`
- 路径：packages/coding-agent/src/modes/components/status-line/separators.ts:8 / types.ts:128
- 归属：coding-agent 自研

### Token 速率 `calculateTokensPerSecond`
- 作用：从最近 assistant 消息计算 tok/s
- 关键词：`calculateTokensPerSecond`
- 路径：packages/coding-agent/src/modes/components/status-line/token-rate.ts:42
- 归属：coding-agent 自研

### 上下文阈值 `getContextUsageLevel` / `formatContextUsage` / `getContextUsageThemeColor`
- 作用：上下文用量级别判定（normal/warning/purple/error）+ 格式化
- 关键词：`getContextUsageLevel` / `formatContextUsage` / `getContextUsageThemeColor` / `ContextUsageLevel`
- 路径：packages/coding-agent/src/modes/components/status-line/context-thresholds.ts:31 / :63 / :75
- 归属：coding-agent 自研

### Git 工具 `parseGitHubRepo` / `parseDefaultBranch` / `createPrCacheContext` / `canReuseCachedPr`
- 作用：GitHub repo 解析、默认分支解析、PR 缓存上下文
- 关键词：`parseGitHubRepo` / `parseDefaultBranch` / `createPrCacheContext` / `canReuseCachedPr` / `PrCacheContext`
- 路径：packages/coding-agent/src/modes/components/status-line/git-utils.ts:7 / :17 / :27 / :36 / :22
- 归属：coding-agent 自研

### 状态行类型 `StatusLineSettings` / `SegmentContext` / `StatusLineSegmentOptions` / `CollabStatus` / `RenderedSegment` / `StatusLineSegment` / `RGB`
- 路径：packages/coding-agent/src/modes/components/status-line/types.ts:23 / :50 / :16 / :9 / :114 / :119 / :48
- 归属：coding-agent 自研

---

## 附录：extensions 子目录完整清单

### 扩展控制中心 `ExtensionDashboard`
- 作用：全屏扩展管理面板——provider 标签 + 双栏（inventory 列表 | inspector），鼠标+键盘
- 关键词：`ExtensionDashboard` / `buildTabBarTabs`
- 路径：packages/coding-agent/src/modes/components/extensions/extension-dashboard.ts:66 / :54
- 归属：coding-agent 自研

### 扩展列表 `ExtensionList`
- 作用：扩展 inventory 列表——master switch + kind 分组头 + 项 + 模糊搜索 + 滚动
- 关键词：`ExtensionList` / `ExtensionListCallbacks`
- 路径：packages/coding-agent/src/modes/components/extensions/extension-list.ts:35 / :16
- 归属：coding-agent 自研

### 检查器面板 `InspectorPanel`
- 作用：选中扩展的详情视图——名称/kind 徽章/描述/来源/路径 + kind 特定预览
- 关键词：`InspectorPanel`
- 路径：packages/coding-agent/src/modes/components/extensions/inspector-panel.ts:13
- 归属：coding-agent 自研

### 扩展状态管理 `loadAllExtensions` / `buildSidebarTree` / `flattenTree` / `applyFilter` / `buildProviderTabs` / `filterByProvider` / `applyDisabledExtensionsToState` / `createInitialState` / `toggleProvider` / `refreshState`
- 作用：扩展控制中心的状态管理——加载所有 capability、构建树、过滤、provider 禁用/启用持久化
- 路径：packages/coding-agent/src/modes/components/extensions/state-manager.ts:48 / :325 / :388 / :411 / :468 / :525 / :541 / :576 / :598 / :611
- 归属：coding-agent 自研

### 扩展类型 `ExtensionKind` / `Extension` / `ExtensionState` / `TreeNode` / `FlatTreeItem` / `ProviderTab` / `DashboardState` / `DashboardCallbacks` / `makeExtensionId` / `parseExtensionId` / `sourceFromMeta`
- 路径：packages/coding-agent/src/modes/components/extensions/types.ts:9 / :35 / :24 / :74 / :94 / :108 / :122 / :149 / :161 / :168 / :180
- 归属：coding-agent 自研
