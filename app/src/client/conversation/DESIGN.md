# 上下文列

三层互不进对方的实现。`conversation/` 只出结构与合同；刻度条组件仍在 `drafts/AskScrollRail.tsx`，只读合同。

1. **消息树** `WireThreadView`  
   只画回合。粘性用 `UserStick`（点击跳回流位置）和本回合圆（贴在用户框下，`--user-stick-h`）。`.wire-loop-spine` 从用户框左边一路贯到最后一轮底，末端向右折，不跟粘性框走。提问落点用 `askAnchorProps` / `clipAskPreview`。不挂滚动条，不拥有 scroll 容器。

2. **滚动台** `ThreadBoard`  
   只拥有滚动口（`.wire-thread-rail-host` + `.wire-context-scroll`）。不读消息类型，不插刻度条。

3. **刻度条** `AskScrollRail`  
   只认 `[data-ask-anchor]` + 文档流 `offsetTop`。不量粘性视觉框，不 `querySelector` 消息角色，不 `closest` 舞台 class。

`ConversationPane` 拼 trail / 台 / 许可 / 输入；把 `rail` 放在 `.wire-thread-stage` 上（与滚动口兄弟），预览气泡才不会被 `overflow: hidden` 裁掉。Host 把 `scrollRef` 和 `rail` 交给 Pane，不交给消息树。
