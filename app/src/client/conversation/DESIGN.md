# 上下文列

三层互不进对方的实现。`conversation/` 只出结构与合同；组件实现在 `wire/thread/`（消息树 `WireThreadView`、刻度条 `AskScrollRail`），只读合同。

1. **消息树** `WireThreadView`（`wire/thread/`）  
   只画回合。粘性用 `UserStick`（点击跳回流位置）和本回合圆（贴在用户框下，`--user-stick-h`）。`.wire-loop-spine` 从用户框左边一路贯到最后一轮底，末端向右折，不跟粘性框走。提问落点用 `askAnchorProps` / `clipAskPreview`。新提问进场用 `is-enter`（`nextEnterIds` / `useEnterIds`）。不挂滚动条，不拥有 scroll 容器。

2. **滚动台** `ThreadBoard`  
   只拥有滚动口（`.wire-thread-rail-host` + `.wire-context-scroll`）。滚动口铺满中栏，正文用左右 padding 收列。不读消息类型，不插刻度条。

3. **刻度条** `AskScrollRail`（`wire/thread/`）  
   只认 `[data-ask-anchor]` + 文档流 `offsetTop`。不量粘性视觉框，不 `querySelector` 消息角色，不 `closest` 舞台 class。

`ConversationPane` 拼 trail / 台 / 许可 / 输入；把 `rail` 放在 `.wire-thread-stage` 上（与滚动口兄弟），预览气泡才不会被 `overflow: hidden` 裁掉。Host 把 `scrollRef` 和 `rail` 交给 Pane，不交给消息树。
