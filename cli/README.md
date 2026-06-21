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
| 鼠标点击 | 聚焦面板 / 输入框光标定位 |
| `Ctrl+C` | 退出 |

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
