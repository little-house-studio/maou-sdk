# WebUI slots

薄壳只开洞，功能包往已声明座位投稿。未声明的名字不能 `register`。

- `SlotCore`：纯账本。父级卸载，子树一起塌。
- `SlotRegistry`：`register` + 晚绑定 `inject`。插件 `apply` 只碰注册表。
- 组件是纯函数：数据来自 props / inject，不 import runtime。
- 座位树（`map.ts`）：壳层 topbar / body / bottom / overlay；body 内 sidebar / center / files / activity；左右活动条在 LeftAside / RightAside；左栏智能体/会话上下分体；选中色由 `data-shell-region` 焦点区切换；对话列 trail / messages / permit / composer（chain）/ overlay；输入卡 queue / bar / footer；输入条 overlay / left / plan / approval-mode / model / usage / right。
- 对话列实现分层见 `conversation/DESIGN.md`：消息树 / 滚动台 / 刻度条。
- Host：`host/live-slots.tsx` / `host/draft-slots.tsx` 往已声明座位投稿。
- I/O：`ports/`。面板只读 `useAppPorts()`，不直接 `fetch`。
