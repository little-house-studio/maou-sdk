# @little-house-studio/cli — Maou CLI

RPG 风格的终端 AI 对话界面。Ink + React 构建，直连 `@little-house-studio/llm`（同进程，非 HTTP）。

## 运行
```bash
maou                      # 启动（默认 vampire 主题）
maou --theme cyber        # 赛博主题
# 配置：~/.maou/llm-config.json（或环境变量 MAOU_LLM_CONFIG 指定路径）
```

## 界面
- **顶栏**：MAOU logo + Vampire 表情（随回复情绪变）+ 当前模型徽章
- **左侧栏**：菜单/会话信息
- **中区**：流式对话（消息 + 思考过程 + 工具调用卡片）
- **右 HUD**：3D 旋转水晶 + Token 血条 + 成本曲线（盲文 sparkline）+ 统计
- **输入框**：支持鼠标点击定位光标
- **状态栏**：模式 + 快捷键 + 流式状态

## 快捷键
| 键 | 功能 |
|---|---|
| `↵` | 发送 |
| `Esc` | 中断流式 / 关弹窗 |
| `Ctrl+K` | 命令面板 |
| `Ctrl+M` | 选模型 |
| `Ctrl+N` | 新对话 |
| `Ctrl+B` / `Ctrl+G` | 切换侧栏 / HUD |
| `Tab` | 切换焦点面板 |
| `` ` `` (反引号) | 开/关鼠标（**关闭时可拖选复制**，默认关） |
| 鼠标点击 | 聚焦面板 / 输入框光标定位（需先开鼠标） |
| 滚轮 / `↑↓`(焦点在对话) | 滚动对话历史 |
| `Ctrl+C` | 退出 |

> **拖选复制**：默认不开鼠标上报，终端原生选区/复制可用。按 `` ` `` 开启鼠标后才接管点击/滚轮（开启时若想复制再按 `` ` `` 关掉）。

## 响应式布局（底层）
`hooks/useTerminalSize.ts` 提供断点（narrow/normal/wide）；窄屏自动折叠侧栏/HUD。所有布局以此为底层自适应。

## 组件库（`components/`）
| 组件 | 用途 |
|---|---|
| `Panel` / `Focus` | 边框容器 / 聚焦流光框（边框沿渐变流动） |
| `Dialog` | **不透明**弹窗（每格填底色 + 投影，不透底）+ 标题/页脚/选中高亮 |
| `Gradient` | `GradientText`/`GradientBar`/`GradientBlock`/`GradientField` 渐变填充 |
| `Scrollable` | `ScrollView` 滚轮/方向键滚动视口 + 滚动条（`overflow:hidden` + 负偏移） |
| `Collapsible` | 折叠/展开动画容器（`useTween` 缓动 + 裁剪） |
| `Markdown` | Markdown + 轻量 HTML(`<b><i><code><a>`) → 终端富文本（卡片内容渲染） |
| `Chat` / `Hud` / `InputBox` | 消息流/工具卡片 · 侧栏/HUD/状态栏 · 点击定位输入框 |

## 功能验收 Demo
```bash
pnpm dev:demo     # 17 页交互式验收（← → 翻页，数字 1-9,0 跳页，q 退出）
pnpm test:demo    # 无头冒烟测试（假 TTY 驱动全 17 页 + 弹窗不透明断言）
```
17 页覆盖：响应式布局 / Gauge / Sparkline / 渐变 / 3D 线框 / AsciiArt / 图片→ASCII / Markdown-HTML 卡片 / 消息流 / 可滚动对话 / 可折叠侧栏 / 聚焦流光 / 点击定位光标 / 不透明弹窗 / 鼠标事件 / 动画主题 / 总览。

## 图形能力（自建 char-canvas 层）
- `canvas/primitives.ts`：盲文亚像素（2×4/格）、块字符填充、Gauge 血条、Sparkline 彩色曲线、3D 旋转线框（立方体/水晶）
- `image/ascii.ts`：`asciiFromImage(path, opts)` 图片→ASCII（block/braille/ramp/half 四模式 + truecolor 着色 + 宽高比修正）

```ts
import { asciiFromImage } from "@little-house-studio/cli/image";
const { lines, colors } = asciiFromImage("./avatar.png", { width: 40, mode: "block", color: true });
```

## 架构
- `theme.ts` 主题 · `state/store.ts` zustand 状态 · `sdk/index.ts` SDK 接线
- `components/` Panel/Chat/Hud/Modals/InputBox/graphics
- `input/mouse.ts` SGR 鼠标解析 · `app.tsx` 主应用 · `index.tsx` 入口
- 详见 `PLAN.md`（完整设计规划）
