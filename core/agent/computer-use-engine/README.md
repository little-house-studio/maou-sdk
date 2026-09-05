# @little-house-studio/computer-use-engine

本机桌面控制引擎。与 `terminal-engine` / `opencli-engine` 同层：返回纯数据，不依赖 `@little-house-studio/agent`。

- 优先走 macOS Accessibility 控件树（AXorcist + 自有 helper）。
- `auto` 下树空或无 Accessibility 权限时，按配置降级到 ScreenCaptureKit 截图/抽帧 + `InputDriver` 坐标键鼠。
- 浏览器不在本包。Win/Linux 只预留 `isAvailable()`。

选型：`MAOU_COMPUTER_USE` → `agent.json` `computerUse.mode` → `~/.maou/config.json` `computerUse.mode` → `auto`。
