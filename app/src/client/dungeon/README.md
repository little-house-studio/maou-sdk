# Dungeon Lab（复古地牢像素测试台）

暖色 8-bit 地牢 + ordered dither + HTML-in-Canvas 实验。

## 架构

| 层 | 说明 |
|----|------|
| **主 canvas** | 纯 2d，**不**挂 `layoutsubtree`，不调用 polyfill API |
| **canvas-ui** | 像素按钮 / HP·MP 条 / 位图字 / 暖色 Bayer dither |
| **DOM HUD** | 右下角可见 QUEST LOG（始终可用） |
| **poly canvas** | 左下独立小 canvas，可选 `drawElementImage` 采样 DOM |

> 以前把 polyfill 和游戏画在同一 canvas 上会导致主场景发黑；现已拆开。

## 视觉

- **复古地牢**：深褐石板 / 琥珀火把 / 羊皮纸字
- **禁止**紫青品红霓虹赛博风
- dither 调色板：near-black → stone → torch amber → parchment

## 操作

- **WASD / 方向键**：移动
- 底部 **ATK / ITEM / MAP / REST**：CanvasUI 像素按钮
- 侧栏开关：Bayer dither、DOM HUD

## 开发

```bash
pnpm --filter @little-house-studio/app dev
```
