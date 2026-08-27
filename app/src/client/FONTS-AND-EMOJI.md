# WebUI 字体与表情

## 字体分工

| 场景 | 字体 | 说明 |
|------|------|------|
| **默认 / 设置 / 表单 / 消息** | HarmonyOS Sans SC（鸿蒙） | 可读性优先 |
| **像素壳**（顶栏 wordmark、dock 标签、审批拨杆、portfolio / dungeon HUD） | Fusion Pixel 12 | 仅装饰性 UI |
| **代码块** | 系统等宽（SF Mono / Menlo / Consolas…） | 不用像素 |
| **终端 xterm** | Fusion Pixel Mono | 终端仍像素风 |
| **表情** | 系统 Color Emoji 栈 | 见下 |

## 表情 / 图标

- 组件：`ui-emoji.tsx`（Unicode 语义映射）
- CSS：`--font-emoji` → Apple Color Emoji / Segoe UI Emoji / **Noto Color Emoji** / Twemoji Mozilla
- **可商用**：Unicode 字符本身无授权费；系统字体按 OS 许可展示
- 若将来改为 **Twemoji SVG**：图形 [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)（需署名），代码 MIT——比捆绑不明像素表情字体更清晰

未采用「第三方像素表情 TTF」的原因：多数许可不清或字库不全；系统 emoji + 可选 Twemoji 更稳妥。

## 类名

- `.font-pixel` / `.ui-pixel`：强制像素
- `.ui-emoji`：强制 emoji 字体栈
