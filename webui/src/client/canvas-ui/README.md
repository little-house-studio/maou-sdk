# canvas-ui

像素 HUD 原语 + **高性能** Bayer / ASCII 滤镜（CPU Canvas2D + GPU three.js）。

## 安装（本仓库内）

```ts
import {
  CanvasUi,
  GALLERY_THEME,
  applyOrderedDither,
  ThreeFilterPipeline,
} from "../canvas-ui";
```

## API 一览

### 1. Canvas2D UI

| API | 说明 |
|-----|------|
| `new CanvasUi(theme?)` | 像素面板 / 按钮 / 血条 |
| `ui.panel / button / bar` | 绘制 |
| `ui.setPointer / setClickHandler` | 命中 |
| `pixelText` | 位图字 |
| `applyOrderedDither(ctx, w, h)` | CPU 有序抖动 |

### 2. three.js GPU 滤镜（推荐 realtime）

```ts
const filter = new ThreeFilterPipeline(renderer, scene, camera, {
  cellW: 8,
  cellH: 12,
  color: true,
});
filter.setMode("dither" | "ascii" | "both" | "off");
filter.setCellSize(8);
filter.render(); // 每帧
```

路径：`scene → RT → fullscreen shader → screen`（无 `getImageData`）。

## 完整案例

WebUI 顶栏 **Canvas UI** → 库演示台（3D 滤镜 + 2D HUD + API）。
