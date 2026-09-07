# WebUI slots

薄壳只开洞，功能包往已声明座位投稿。未声明的名字不能 `register`。

- `SlotCore`：纯账本。父级卸载，子树一起塌。
- `SlotRegistry`：`register` + 晚绑定 `inject`。插件 `apply` 只碰注册表。
- 组件是纯函数：数据来自 props / inject，不 import runtime。
- 座位树（`map.ts`）：壳层 topbar / body / bottom / overlay；body 内 center + `aside.left.tab` / `aside.left.pane` / `aside.right.tab` / `aside.right.pane`。页签是 list，面板是 keyed，同一 `id`/`key`。扩展用 `registerAsideTab` 一次挂上图标和面板；宿主只记当前打开的 tab id。左栏智能体/会话仍在 `sidebar.*`（侧栏页签的 paneChildren）。选中色由 `data-shell-region` 焦点区切换；对话列 trail / messages / permit / composer（chain）/ overlay；输入卡 queue / bar / footer；输入条 overlay / left / plan / approval-mode / model / usage / right。
- 对话列实现分层见 `conversation/DESIGN.md`：消息树 / 滚动台 / 刻度条。
- Host：`host/live-slots.tsx` 往已声明座位投稿。左右栏内置页签和扩展都走 `registerAsideTab`（座位未声明时晚绑定）。模块顶层 `registerSlotPlugin({ id, apply })`，宿主建表时一并 apply；也可以 `createLiveHostSlots([plugin])`。
- I/O：`ports/`。面板只读 `useAppPorts()`，不直接 `fetch`。
