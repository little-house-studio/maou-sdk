## 使用指引

- `use_computer` 控制本机桌面原生 App（Finder、TextEdit、系统设置等）。网页用 `use_browser`。
- 先 `permissions` 看辅助功能 / 屏幕录制是否已授权。
- 推荐：`activate app='访达'` → `snapshot` → 用返回的 `[N]` 做 `click`/`type`/`set-value`，并带上 `snapshot`。
- 路线默认 `auto`：能读控件树就走 AXPress / AXSetValue；树空或没权限时降级截图 + 坐标键鼠。可锁 `ax` / `pixels`。
- `screenshot` / `record` 是观察；`record` 抽短帧，不是常驻录屏。
- 点、打字、热键、写入、激活、录像只在 execute 模式可用。plan 里只许 snapshot / screenshot / apps / windows / permissions。
