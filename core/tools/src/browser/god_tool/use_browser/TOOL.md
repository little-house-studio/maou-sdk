## 使用指引

- use_browser 控制真实浏览器，适合需要交互的场景：登录、填表、点击、截图等。
- 常用 action 流程：open 打开页面 → find 查找元素 → click/type/fill 操作 → extract 提取数据。
- target 支持数字引用 [N]（页面元素编号）和 CSS 选择器。
- 长操作链建议分步执行，每步确认结果后再继续。
- session 参数管理多标签页，不同任务用不同 session 隔离。
- eval 执行的 JS 会被 IIFE 包裹，只读操作安全，写操作需谨慎。
- 截图（screenshot）适合确认页面状态或向用户展示结果。
- 不需要交互的静态网页用 read_web 即可，无需启动浏览器。
