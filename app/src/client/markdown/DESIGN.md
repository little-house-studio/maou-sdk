# Markdown 文档工作台（大型独立模块）

路径：`webui/src/client/markdown/` · 后端：`webui/src/server/markdown/`

## 架构

```
MarkdownWorkbench
├── FunctionBar          顶栏：对齐 / 保存 / 新建
├── FileTree             项目 .md
├── TitleTree            #/##/### 点击 → 画布仅显示该层
├── DocumentCanvas       块渲染（段落/列表树/任务/代码折叠/引用/表格）
├── ModeToolbar          底栏悬浮：浏览 | 批注多选 | 源码
├── FloatBubble          选中悬浮：快速备注 + 对齐
├── ContextMenu          右键场景菜单
└── CopilotPanel         右侧占位（diff 绿/红 · 同意/放弃/继续聊）
```

### 解析 / Diff

- `parser/parse-md.ts`：章节 + 块 AST + 行号  
- `parser/inline.ts`：粗/斜/删/代码/链接  
- `parser/diff.ts`：行级 LCS diff（对齐/Copilot）

### 批注

- 多选块/节点，同色同备注组  
- 输出格式：`把[path里面的（行）'原文'、…]备注`

### 对齐

- 顶栏「对齐」→ `POST /api/chat` 主 Agent（附批注 + 可选正文）

### Copilot（占位）

- 项目级会话 / 工具 / `/goal` 待接 agent 实例  

## 目录

```
markdown/
  MarkdownWorkbench.tsx
  api.ts  styles.css  index.ts  DESIGN.md
  parser/  canvas/  title-tree/  file-tree/  editor/
  annotate/  ui/  copilot/  doc-outline/
server/markdown/
  fs-api.ts  routes.ts  index.ts
```
