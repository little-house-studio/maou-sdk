# canvas-ui 完整案例

本页（顶栏 **Canvas UI**）是 `src/client/canvas-ui` 滤镜/UI 库的 **living demo**。

## 三个页签

| Tab | 演示 |
|-----|------|
| **GPU Filter** | `ThreeFilterPipeline` — 3D 雕塑 + Bayer/ASCII |
| **Canvas HUD** | `CanvasUi` — 像素 panel/button/bar |
| **API** | 代码片段 + `applyOrderedDither` CPU 预览 |

## 库路径

```
src/client/canvas-ui/
  index.ts              # 公共导出
  ui.ts / font.ts / draw.ts / theme.ts
  dither/
    three-filter.ts     # GPU 高性能滤镜
    cpu-ordered.ts      # Canvas2D dither
    ascii-atlas.ts
    bayer.ts
```

## 操作

- GPU：↑↓ / J K 切作品，1–4 切滤镜模式
- HUD：点击 ATK / ITEM / REST
