# @little-house-studio/context-components

上下文工厂：消息、会话记录、工作集、压法原语。不依赖传统方案包。

传统方案（`@little-house-studio/context`）用这些零件配好默认拼装和线性压缩。要自己搭，只引本包。

```ts
import {
  createContextParts,
  createAssembly,
  createFoldPipeline,
  createMessageTree,
  defineSlot,
} from "@little-house-studio/context-components";

const parts = createContextParts({
  sessionDir,
  features: { search: false, archive: false },
  slots: [
    defineSlot({ name: "system", order: 10, provide: () => "you are …" }),
    defineSlot({ name: "history", order: 100, prefix: false, provide: (ctx) => ctx.history }),
  ],
  folds: [],
});

parts.assembly.insert({ name: "extra", order: 20, provide: () => "…" });
const messages = parts.assembly.assemble(ctx);
```

子路径：`@little-house-studio/context-components/factory`。
