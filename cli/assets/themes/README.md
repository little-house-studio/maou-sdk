# 主题配色（themes）

与画廊资源（`assets/gallery/`、`gallery-images.json`）**完全分开**。

## 目录

| 路径 | 用途 |
|------|------|
| `cli/assets/themes/<name>.json` | 包内内置配色 |
| `~/.maou/themes/<name>.json` | 用户自定义（同名覆盖内置） |
| `~/.maou/cli-ui.json` | 记住当前选用主题 `{ "theme": "tau-ceti" }` |

## 加载

```bash
# 按主题名
maou coding --theme tau-ceti

# 按文件路径
maou coding --theme ~/.maou/themes/my-dark.json
```

TUI 内：`Ctrl+,` → **配色方案**。

## JSON 结构

```json
{
  "id": "tau-ceti",
  "name": "Tau Ceti",
  "defaults": {
    "hover": {
      "mode": "lighten",
      "amount": 0.14,
      "fallback": "#404040"
    }
  },
  "palette": {
    "acid": { "base": "#C7FF20", "hover": "#D4FF4A" },
    "black": "#101010"
  },
  "colors": {
    "bg": "#101010",
    "accent": { "base": "#C7FF20", "hover": "#D4FF4A" },
    "fg": "#C5C5C5"
  },
  "nav": {
    "defaults": { "fg": "#FFFFFF", "fgHover": "#FFFFFF" },
    "order": ["agent", "sessions", "terminal", "todo", "inbox", "notice", "settings"],
    "items": {
      "agent": {
        "label": "agent",
        "short": "A",
        "bg": "#FF741D",
        "bgHover": "#FF8A3D",
        "fg": "#000000"
      },
      "terminal": {
        "label": "终端",
        "bg": "#4A4A4A"
      }
    }
  }
}
```

### 颜色写法

- 字符串：`"#RRGGBB"` → 只有 base，hover 走 `defaults.hover`
- 对象：`{ "base": "#…", "hover": "#…" }` → 可单独指定悬浮色

### 默认悬浮（未定义 hover 时）

1. 若写了 `defaults.hover.mode: "lighten"` → 对 base 提亮 `amount`
2. 否则 / 失败 → 用 `defaults.hover.fallback`

Nav 项同理：可只写 `bg`，自动生成 `bgHover`。
