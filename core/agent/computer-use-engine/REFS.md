# 参考落点

实现对照的开源接口（clone 在仓库根 `.refs/`，不提交）。

## AXorcist（`aa07d72`）

- 权限：`AXPermissionHelpers.hasAccessibilityPermissions()`，未授权文案指向系统设置 → 辅助功能。
- 控件：`Element.application(for:)`、`children()`、`role/title/value/frame`、`press()`、`setValue`。
- 像素输入：`InputDriver.click/type/scroll/hotkey`（CGEvent）。

## Peekaboo `see`

- 一次观察产出 `snapshot_id` + 扁平 `ui_elements`（role / title / value / frame / actionable）。
- 后续 `click`/`type` 带同一 snapshot 内编号；AX 优先，`AXPress`，不抢后台窗口焦点。
- 截图像素走 ScreenCaptureKit；`capture live` 对应本引擎 `observe record` 抽帧。
- 本引擎 snapshot id 形如 `cu1_` + 32 hex，存在进程内缓存，不跑 Peekaboo daemon。
